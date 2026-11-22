/* global ReaderArchive, READER_ORIGIN */
const rpc=async(op,fields={})=>{const r=await chrome.runtime.sendMessage({kind:"host-rpc",op,...fields});if(r?.error)throw Error(r.error);return r?.value};
const typed=(method,payload)=>({method,headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
const uuid=s=>typeof s==="string"&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(s);
async function api(device,path,opts={}){
  const token=await rpc("access",{device});
  const r=await fetch(READER_ORIGIN+"/api/extension/v1/"+path,{...opts,credentials:"omit",redirect:"error",cache:"no-store",
    headers:{...opts.headers,Authorization:"Bearer "+token}});
  if(!r.ok){const e=Error("Reader HTTP "+r.status);e.status=r.status;throw e;}return r;
}
async function ledger(key,patch){
  await navigator.locks.request("reader-jobs",async()=>{
    const jobs=await rpc("jobs"),job=jobs.find(j=>j.key===key);
    if(job)Object.assign(job,patch);else jobs.push({key,...patch});
    const done=jobs.filter(j=>!j.active&&j.phase!=="review"&&j.phase!=="upload-unknown").slice(-12);
    await rpc("saveJobs",{jobs:jobs.filter(j=>j.active||j.phase==="review"||j.phase==="upload-unknown"||done.includes(j))});
  });
}
const root=navigator.storage.getDirectory(),live=new Set(),busy=new Set(),downloads=new Map();
async function erase(key){if(uuid(key))await (await root).removeEntry(key,{recursive:true}).catch(()=>{});}
const initialized=(async()=>{for await(const [k] of await root)if(uuid(k))await erase(k);})();
async function progress(job,decision){
  if(busy.has(job.key))return;busy.add(job.key);
  try{
    if(await rpc("device")!==job.device)return;
    if(job.phase==="reading"&&!live.has(job.key)){
      await ledger(job.key,{phase:"capture-interrupted",active:false});return;
    }
    let iid=job.iid;
    if(!iid){
      const result=await (await api(job.device,"requests/"+job.key)).json();iid=result.id;
      if(!iid){await ledger(job.key,{phase:"upload-unknown",active:false});return;}
      await ledger(job.key,{iid});
    }
    const s=await (await api(job.device,"imports/"+iid)).json();
    if(s.status==="committed"&&uuid(s.conversation_id)){
      await ledger(job.key,{phase:"done",active:false,cid:s.conversation_id,title:String(s.title||"").slice(0,512),review:null});return;
    }
    if(s.review){
      if(!decision&&(s.review.partial||s.review.live_share||s.review.action==="conflict")){
        await ledger(job.key,{phase:"review",active:false,review:s.review});return;
      }
      if(decision&&decision.receipt!==s.review.receipt){await ledger(job.key,{phase:"review",active:false,review:s.review});return;}
      await api(job.device,`imports/${iid}/commit`,typed("POST",decision||{receipt:s.review.receipt}));
      await ledger(job.key,{phase:"queued",active:true,review:null});return;
    }
    const failed=["failed","cancelled","canceled","resolving","needs_grouping"].includes(s.status);
    await ledger(job.key,{phase:failed?"attention":s.wait?"resource-wait":"processing",active:!failed,percent:s.progress});
  }catch(e){await ledger(job.key,{phase:e.status===401||e.status===403?"reconnect":"check",active:false});}
  finally{busy.delete(job.key);}
}
async function tick(){for(const j of await rpc("jobs"))if(j.active&&!live.has(j.key))await progress(j);}
setInterval(()=>tick().catch(()=>{}),2500);
chrome.runtime.onConnect.addListener(port=>{
  if(!port.name.startsWith("reader:")||!uuid(port.name.slice(7)))return;
  const sender=port.sender,u=new URL(sender.url);
  if(!sender.tab||sender.frameId!==0||u.origin!=="https://chatgpt.com")return;
  const key=crypto.randomUUID();let t,dir,rows,current,assetPath,meta,count=0,total=0,finished=false,working=false,closed=false;
  const assets=new Map();let delivered=false,noticed=false;
  async function clean(reason){
    await Promise.allSettled([rows,current].filter(Boolean).map(w=>w.abort()));await erase(key);live.delete(key);
    if(t&&!delivered&&!noticed&&await rpc("device")===t.device){
      noticed=true;await ledger(key,{device:t.device,phase:reason==="quota"?"storage-full":"capture-interrupted",active:false});
    }
  }
  port.onDisconnect.addListener(()=>{closed=true;if(!working&&!finished)void clean().catch(()=>{});});
  port.onMessage.addListener(async m=>{
    if(working||finished){port.disconnect();return;}working=true;
    try{
      if(!t){
        if(m.op!=="hello")throw Error("Capture not authorized.");
        t=await rpc("ticket",{ticket:port.name.slice(7),tab:sender.tab.id,doc:sender.documentId,path:u.pathname});
        live.add(key);await ledger(key,{device:t.device,phase:"reading",active:true});
        await initialized;dir=await (await root).getDirectoryHandle(key,{create:true});
        rows=await (await dir.getFileHandle("rows",{create:true})).createWritable();
      }else if(m.op==="header"&&!meta&&u.pathname.endsWith("/"+m.id)&&["tree","list"].includes(m.lineage)){
        meta={id:m.id,title:String(m.title).slice(0,512),lineage:m.lineage};
      }else if(m.op==="asset"&&meta&&!current&&typeof m.path==="string"&&/^assets\/[\p{L}\p{N}_.-]{1,200}$/u.test(m.path)&&!assets.has(m.path)&&assets.size<2000){
        assetPath=m.path;const handle=await dir.getFileHandle("asset-"+assets.size,{create:true});assets.set(assetPath,handle);current=await handle.createWritable();
      }else if(m.op==="chunk"&&current&&typeof m.data==="string"&&m.data.length<=262144){
        const data=Uint8Array.from(atob(m.data),x=>x.charCodeAt(0));if((total+=data.length)>100*1024*1024)throw Error("Private beta package size limit (100 MiB)");
        await current.write(data);
      }else if(m.op==="endAsset"&&current){await current.close();current=null;
      }else if(m.op==="message"&&meta&&!current){
        const row=m.row;if(!row||typeof row.body!=="string"||row.body.length>2*1024*1024||++count>50000||!Array.isArray(row.assets)||row.assets.some(p=>!assets.has(p)))throw Error("Invalid source message");
        const line=JSON.stringify(row)+"\n";if((total+=new TextEncoder().encode(line).length)>100*1024*1024)throw Error("Package too large");
        await rows.write(line);
      }else if(m.op==="finish"&&meta&&count&&!current){
        if(!Array.isArray(m.images)||m.images.some(p=>!assets.has(p)))throw Error("Invalid image reference");
        meta.partial=!!m.partial;meta.images=m.images;await rows.close();rows=null;
        const space=await navigator.storage.estimate();
        if(space.quota&&space.quota-(space.usage||0)<total*2+1048576)throw Error("Not enough browser temporary storage. Nothing was sent.");
        async function* readRows(){
          const file=await (await dir.getFileHandle("rows")).getFile(),stream=file.stream().pipeThrough(new TextDecoderStream());
          let buf="";for await(const s of stream){buf+=s;let n;while((n=buf.indexOf("\n"))>=0){yield JSON.parse(buf.slice(0,n));buf=buf.slice(n+1);}}
          if(buf)throw Error("Incomplete message spool");
        }
        const zip=await ReaderArchive.build(dir,meta,readRows,assets);
        if(closed||await rpc("device")!==t.device)throw Error("Source tab or account changed.");
        delivered=true;await ledger(key,{device:t.device,phase:"uploading",active:true,losses:m.losses});
        const form=new FormData();form.append("files",zip,"reader.zip");if(t.project)form.append("target_project_id",t.project);
        try{
          const result=await (await api(t.device,"imports",{method:"POST",headers:{"Idempotency-Key":key},body:form})).json();
          await ledger(key,{iid:result.id,phase:"received",active:true});
        }catch(e){await ledger(key,{phase:e.status&&e.status<500?"upload-rejected":"upload-unknown",active:!e.status||e.status>=500});throw e;}
        finally{live.delete(key);}
        finished=true;await erase(key);
      }else throw Error("Invalid transfer sequence");
      if(!closed)port.postMessage({ok:true});
    }catch(e){if(!closed)port.postMessage({error:e.message});closed=true;await clean(e.name==="QuotaExceededError"||e.message.includes("temporary storage")?"quota":null);port.disconnect();}
    finally{working=false;if(closed&&!finished)await clean();}
  });
});
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m.kind==="tick"&&s.id===chrome.runtime.id&&!s.tab){tick().catch(()=>{});return;}
  if(s.url!==chrome.runtime.getURL("panel.html")||m.kind!=="panel-host")return;
  (async()=>{
    const device=await rpc("device");if(!device||device!==m.device)throw Error("Reader account changed.");
    if(m.op==="check"){
      const job=(await rpc("jobs")).find(j=>j.key===m.key&&j.device===device);if(!job)throw Error("Task not found.");
      await progress(job,m.decision);
    }else if(m.op==="download"&&uuid(m.aid)){
      const r=await api(device,`artifacts/${m.aid}/claim`,typed("POST",{session_id:crypto.randomUUID()}));
      const {claim}=await r.json();if(!uuid(claim))throw Error("Invalid download lease");
      const resp=await api(device,`artifacts/${m.aid}/download?claim=${claim}`);
      const key=crypto.randomUUID();await initialized;const dir=await (await root).getDirectoryHandle(key,{create:true});
      try{
        const f=await dir.getFileHandle("context.zip",{create:true});await resp.body.pipeTo(await f.createWritable());
        if(await rpc("device")!==device)throw Error("Reader account changed.");
        const url=URL.createObjectURL(await f.getFile());
        try{const id=await rpc("download",{url});downloads.set(id,{key,url});}
        catch(e){URL.revokeObjectURL(url);throw e;}
      }catch(e){await erase(key);throw e;}
    }else throw Error("Unknown operation");
    reply({ok:true});
  })().catch(e=>reply({error:e.message}));return true;
});
chrome.runtime.onMessage.addListener((m,s)=>{
  if(m.kind==="download-ended"&&s.id===chrome.runtime.id&&!s.tab&&downloads.has(m.id)){
    const {key,url}=downloads.get(m.id);downloads.delete(m.id);URL.revokeObjectURL(url);void erase(key);
  }
});
