/* global ReaderArchive, READER_ORIGIN */
const rpc=async(op,fields={})=>{const r=await chrome.runtime.sendMessage({kind:"host-rpc",op,...fields});if(r?.error)throw Error(r.error);return r?.value};
const typed=(method,payload)=>({method,headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
const uuid=s=>typeof s==="string"&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(s);
async function api(device,path,opts={}){
  const token=await rpc("access",{device});
  let r;
  try{r=await fetch(READER_ORIGIN+"/api/extension/v1/"+path,{...opts,credentials:"omit",redirect:"error",cache:"no-store",
    headers:{...opts.headers,Authorization:"Bearer "+token}});}
  catch(e){if(e.name==="TypeError")e.code="NETWORK_UNAVAILABLE";throw e;}
  if(await rpc("device")!==device)throw Error("Reader account changed.");
  if(!r.ok){const e=Error("Reader HTTP "+r.status);e.status=r.status;
    const after=r.headers.get("Retry-After");
    if(after){const at=/^\d+$/.test(after)?Date.now()+Number(after)*1000:Date.parse(after);
      if(Number.isSafeInteger(at))e.retryAt=at;}
    try{const {detail}=await r.json();e.code=ReaderProgress.diagnostic({category:"unknown",code:detail?.code})?.code;}catch{}
    throw e;}
  // Validate the actual server boundary, including requests made by the
  // resumable uploader after a lost chunk/finish response.
  if(path.startsWith("requests/")){
    const value=await r.clone().json().catch(()=>null);
    if(!value||!Object.hasOwn(value,"id")||value.id!==null&&!uuid(value.id))
      throw Object.assign(Error("Invalid request receipt"),{code:"UPLOAD_RECEIPT_INVALID"});
  }
  if(await rpc("device")!==device)throw Error("Reader account changed.");
  return r;
}
async function ledger(key,patch,owner){
  await navigator.locks.request("reader-jobs",async()=>{
    const jobs=await rpc("jobs"),job=jobs.find(j=>j.key===key);
    // A delayed progress flush cannot recreate a discarded job or cross accounts.
    if(owner&&(!job||job.device!==owner||await rpc("device")!==owner))return;
    patch={...patch};
    if(patch.phase&&job?.nextCheckAt&&!Object.hasOwn(patch,"nextCheckAt"))patch.nextCheckAt=null;
    if(patch.step)patch.step=ReaderProgress.snapshot(patch.step);
    const stats=ReaderProgress.accumulate(ReaderProgress.accumulate(job?.stats,patch.stats),patch.step);
    if("percent" in patch)Object.assign(stats,ReaderProgress.accumulate(stats,{serverProgress:patch.percent}));
    if(job?.stats||Object.keys(stats).length||patch.phase==="reading")patch.stats=stats;
    if("diagnostic" in patch)patch.diagnostic=ReaderProgress.diagnostic(patch.diagnostic);
    if(["reading","uploading"].includes(patch.phase)&&!Number.isSafeInteger(job?.startedAt))patch.startedAt=Date.now();
    // An inactive stop freezes elapsed time; resuming the same task keeps its
    // first start. A received package is still active, not a saved conversation.
    if(patch.active===true)patch.finishedAt=null;
    else if(patch.active===false)patch.finishedAt=Number.isSafeInteger(job?.finishedAt)?job.finishedAt:Date.now();
    if(job)Object.assign(job,patch);else jobs.push({key,...patch});
    const batch=await rpc("batch");
    const keep=j=>j.active||j.packageReady||ReaderProgress.scheduledCheck(j)||j.phase==="review"||j.phase==="upload-unknown"||!!batch?.id&&j.batch===batch.id;
    const done=jobs.filter(j=>!keep(j)).slice(-12);
    await rpc("saveJobs",{jobs:jobs.filter(j=>keep(j)||done.includes(j))});
  });
}
const root=navigator.storage.getDirectory(),live=new Set(),downloads=new Map(),captures=new Map();
async function erase(key){if(uuid(key))await (await root).removeEntry(key,{recursive:true}).catch(()=>{});}
async function eraseUnretained(key,device){
  await navigator.locks.request("reader-local-"+key,{ifAvailable:true},async lock=>{
    if(!lock)return;
    // A local packager may have sealed its file while this cleanup waited.
    // Only the ledger read inside the same OPFS lock can authorize deletion.
    const jobs=await rpc("jobs");
    if(device!==undefined&&await rpc("device")!==device)return;
    if(live.has(key)||[...downloads.values()].some(d=>d.key===key)||
      jobs.some(j=>j.key===key&&j.packageReady&&(device===undefined||j.device===device)))return;
    await erase(key);
  });
}
const initialized=(async()=>{
  for await(const [key] of await root)if(uuid(key))await eraseUnretained(key);
})();
async function forgetDetachedDevice(){
  const current=await rpc("device");
  for(const [port,owner] of captures)if(owner()&&owner()!==current)port.disconnect();
  await initialized;
  for await(const [key] of await root){
    if(await rpc("device")!==current)return;
    if(uuid(key))await eraseUnretained(key,current);
  }
}
function displayProgress(key,device,port,initial){
  let stats=ReaderProgress.accumulate({},initial),writes=Promise.resolve(),failure,closed=false,stage;
  const store=ReaderProgress.throttle(step=>{
    writes=writes.then(async()=>{await ledger(key,{step,stats:step},device);failure=null;}).catch(e=>{failure=e;});
  },900);
  const ui=ReaderProgress.throttle(step=>{try{port?.postMessage({op:"progress",step});}catch{}store.update(step);});
  const drain=async()=>{await writes;if(failure)throw failure;};
  return {update(value){
    if(closed)return;
    const step=ReaderProgress.snapshot(value);if(!step)return;
    stage=step.stage;
    if(step.stage==="package"&&Number.isSafeInteger(step.done))step.packageBytes=step.done;
    stats=ReaderProgress.accumulate(stats,step);ui.update({...step,...stats});
  },get stage(){return stage;},flush(){ui.flush();store.flush();return drain();},
  close(){if(!closed){ui.flush();store.flush();ui.close();store.close();closed=true;}return drain();}};
}
async function deliver(job,file,report){
  report.update({stage:"upload",packageBytes:file.size});
  await report.flush();
  await ledger(job.key,{phase:"uploading",active:true,diagnostic:null},job.device);
  const res=await ReaderUpload({key:job.key,file,binding:job.binding,request:(p,opts)=>api(job.device,p,opts),report:report.update,retryLimit:2,
    onRetry:()=>ledger(job.key,{diagnostic:{category:"network",stage:"upload",code:"NETWORK_UNAVAILABLE",recovery:"retry_existing"}},job.device)});
  if(!uuid(res.id))throw Object.assign(Error("Unconfirmed upload receipt"),{code:"UPLOAD_RECEIPT_UNCONFIRMED"});
  await report.flush();
  if(await rpc("device")!==job.device)return;
  await ledger(job.key,{iid:res.id,packageReady:false,binding:null,stats:{uploadBytes:file.size},diagnostic:null,
    phase:job.mode==="append"?"append-ready":"received",active:job.mode!=="append",
    ...(job.mode==="append"?{settledAt:Date.now()}:{})},job.device);
  if(await rpc("device")!==job.device)return;
  await erase(job.key);
}
function uploadFailure(e){
  if(e.status===413)return "instance-limit";
  if(e.status===507)return "server-storage";
  if(e.status===401||e.status===403)return "reconnect";
  if(e.code==="READER_TRANSFER_PENDING")return "other-transfer";
  if(e.status===422||e.status===404)return "upload-rejected";
  return "upload-paused";
}
function failureDiagnostic(e,stage){
  const category=e.name==="QuotaExceededError"?"local-storage":e.name==="AbortError"?"cancelled":
    e.code==="NETWORK_UNAVAILABLE"?"network":e.status===401?"auth":e.status===403?"permission":
    e.status===413?"limit":e.status===507?"server-storage":e.status===409?"conflict":
    e.status===404||e.name==="NotFoundError"?"unavailable":
    e.status===422||["UPLOAD_RECEIPT_INVALID","UPLOAD_OFFSET_INVALID","UPLOAD_RECEIPT_UNCONFIRMED"].includes(e.code)?"protocol":
    e.status>=500||e.status===429?"server":"unknown";
  return ReaderProgress.diagnostic({category,stage,status:e.status,code:e.code});
}
// These durable attempts are for an already authorized handoff. The existing
// upload protocol reconciles its key/offset on every attempt. A content review,
// invalid receipt, ownership change or user cancellation never starts a retry.
const checkDelays=[5000,30000];
function nextCheck(job,error){
  const used=job.autoChecks??0;
  if(!Number.isInteger(used)||used<0||used>=checkDelays.length)return {nextCheckAt:null};
  if(error?.code&&error.code!=="NETWORK_UNAVAILABLE")return {nextCheckAt:null};
  if(error&&(error.status!=null?![408,429,500,502,503,504].includes(error.status):error.code!=="NETWORK_UNAVAILABLE"))return {nextCheckAt:null};
  return {nextCheckAt:Math.max(Date.now()+checkDelays[used],error?.retryAt||0)};
}
// Called only while the per-item OPFS/operation lock is held.
async function advance(job,decision,resume=false,retry=false){
  const record=patch=>ledger(job.key,patch,job.device);
  try{
    if(await rpc("device")!==job.device)return;
    if(job.packageReady){
      const previous=await (await api(job.device,"requests/"+job.key)).json();
      if(!previous||!Object.hasOwn(previous,"id")||previous.id!==null&&!uuid(previous.id))throw Object.assign(Error("Invalid receipt"),{code:"UPLOAD_RECEIPT_INVALID"});
      if(await rpc("device")!==job.device)return;
      if(uuid(previous.id)){await record({iid:previous.id,packageReady:false,binding:null,
        stats:{uploadBytes:job.binding?.size},diagnostic:null,active:job.mode!=="append",
        phase:job.mode==="append"?"append-ready":"received"});if(await rpc("device")===job.device)await erase(job.key);return;}
      if(!resume){await record({phase:"upload-paused",active:false,...(job.active&&job.phase==="uploading"?nextCheck(job):{})});return;}
      const report=displayProgress(job.key,job.device,null,job.stats);
      try{await initialized;const dir=await (await root).getDirectoryHandle(job.key);
        const file=await (await dir.getFileHandle("import.zip")).getFile();
        await deliver(job,file,report);}
      catch(e){try{await report.close();}catch(problem){e=problem;}await record({phase:e.name==="NotFoundError"?"capture-interrupted":uploadFailure(e),active:false,
        diagnostic:failureDiagnostic(e,"upload"),...nextCheck(job,e),
        ...(e.name==="NotFoundError"?{packageReady:false,binding:null}:{})});}
      finally{await report.close().catch(()=>{});}return;
    }
    if(job.phase==="reading"&&!live.has(job.key)){
      await record({phase:"capture-interrupted",active:false,
        diagnostic:job.diagnostic||{category:"source",stage:ReaderProgress.snapshot(job.step)?.stage||"source",code:"CAPTURE_INTERRUPTED"}});return;
    }
    let iid=job.iid;
    if(!iid){
      const result=await (await api(job.device,"requests/"+job.key)).json();
      if(!result||!Object.hasOwn(result,"id")||result.id!==null&&!uuid(result.id))throw Object.assign(Error("Invalid receipt"),{code:"UPLOAD_RECEIPT_INVALID"});
      iid=result.id;
      if(iid==null){await record({phase:"upload-unknown",active:false,...nextCheck(job)});return;}
      if(!uuid(iid))throw Object.assign(Error("Invalid receipt"),{code:"UPLOAD_RECEIPT_INVALID"});
      await record({iid});
    }
    let s=await (await api(job.device,"imports/"+iid)).json();
    if(await rpc("device")!==job.device)return;
    if(retry&&job.mode!=="append"&&s.mode!=="selective_append"&&["failed","paused"].includes(s.status)){
      const caps=await (await api(job.device,"capabilities")).json();
      if(!caps.import_retry)throw Error("Reader does not support retrying this import.");
      await api(job.device,"imports/"+iid+"/retry",typed("POST",{}));
      s=await (await api(job.device,"imports/"+iid)).json();
    }
    if(job.mode==="append"||s.mode==="selective_append"){
      // A device only delivers an excerpt. It can never confirm the destination,
      // consent to a live share, or invoke the ordinary full-import commit.
      if(job.mode!=="append"||s.mode!=="selective_append"||!uuid(iid))throw Error("Source receipt mismatch");
      await record({iid,...ReaderProgress.appendReceipt(s),review:null});return;
    }
    if(s.review){
      if(!decision&&(s.review.partial||s.review.live_share||s.review.action==="conflict")){
        await record({phase:"review",active:false,review:s.review,diagnostic:null});return;
      }
      if(decision&&decision.receipt!==s.review.receipt){await record({phase:"review",active:false,review:s.review,diagnostic:null});return;}
      await api(job.device,`imports/${iid}/commit`,typed("POST",decision||{receipt:s.review.receipt}));
      await record({phase:"queued",active:true,review:null,diagnostic:null});return;
    }
    await record(ReaderTransferState(s));
  }catch(e){await record({phase:e.status===401||e.status===403?"reconnect":"check",active:false,
    diagnostic:failureDiagnostic(e,job.packageReady?"upload":"server"),...nextCheck(job,e)});}
}
async function progress(snapshot,decision,resume=false,retry=false,background=false){
  await initialized;
  return navigator.locks.request("reader-local-"+snapshot.key,{ifAvailable:!resume},async lock=>{
    if(!lock||await rpc("device")!==snapshot.device)return;
    const job=(await rpc("jobs")).find(j=>j.key===snapshot.key&&j.device===snapshot.device);
    if(!job||job.phase==="cancelled"||live.has(job.key))return;
    if(background&&!job.active){
      if(!ReaderProgress.scheduledCheck(job)||job.nextCheckAt>Date.now())return;
      const used=job.autoChecks??0;
      if(!Number.isInteger(used)||used<0||used>=checkDelays.length){await ledger(job.key,{nextCheckAt:null},job.device);return;}
      job.autoChecks=used+1;
      // Reserve the attempt inside the per-item lock before any network I/O.
      // On host restart the next bounded attempt can still pick up a lost reply.
      await ledger(job.key,{autoChecks:job.autoChecks,...nextCheck(job)},job.device);
      resume=!!job.packageReady;
    }
    return advance(job,decision,resume,retry);
  });
}
async function tick(){
  for(const j of await rpc("jobs"))if(!live.has(j.key)&&(j.active||ReaderProgress.scheduledCheck(j)&&j.nextCheckAt<=Date.now()))
    await progress(j,undefined,false,false,true);
}
setInterval(()=>tick().catch(()=>{}),2500);
chrome.runtime.onConnect.addListener(port=>{
  if(!port.name.startsWith("reader:")||!uuid(port.name.slice(7)))return;
  const sender=port.sender,u=new URL(sender.url);
  if(!sender.tab||sender.frameId!==0||u.origin!=="https://chatgpt.com")return;
  let key=crypto.randomUUID(),t,dir,archive,current,assetPath,meta,count=0,finished=false,working=false,closed=false,report,writing=false,assetIndex=0;
  captures.set(port,()=>t?.device);
  const assets=new Map(),usedAssets=new Set();let lastSelectedUser=null,delivered=false,noticed=false,sourceStop,stopped;
  async function clean(reason,error){
    try{await report?.close();}catch(problem){error||=problem;}
    await Promise.allSettled([archive,current].filter(Boolean).map(w=>w.abort()));
    if(!delivered||t&&await rpc("device")!==t.device)await erase(key);live.delete(key);
    if(t&&!delivered&&!noticed&&await rpc("device")===t.device){
      const diag=reason==="quota"?failureDiagnostic(error,report?.stage||"source"):sourceStop||
        (error?failureDiagnostic(error,report?.stage||"source"):{category:reason==="cancel"?"cancelled":"source",stage:report?.stage||"source",
          code:reason==="cancel"?"CAPTURE_CANCELLED":"CAPTURE_INTERRUPTED"});
      noticed=true;await ledger(key,{device:t.device,phase:diag.category==="cancelled"?"cancelled":reason==="quota"?"storage-full":"capture-interrupted",active:false,
        diagnostic:diag},t.device);
    }
  }
  const finishStop=()=>stopped||=(async()=>{finished=true;await clean();try{port.postMessage({op:"source-stopped"});}catch{}})();
  port.onDisconnect.addListener(()=>{closed=true;captures.delete(port);if(!working&&!finished)void (sourceStop?finishStop():clean()).catch(()=>{});});
  port.onMessage.addListener(async m=>{
    if(m.op==="observe"){if(report&&!delivered&&!closed)report.update(m.step);return;}
    if(m.op==="source-stop"){
      if(closed&&!sourceStop)return; // Do not replace a host-originated terminal failure.
      if(finished||delivered){try{port.postMessage({op:"source-stopped"});}catch{}return;}
      if(!t&&!working)return;
      sourceStop??=ReaderProgress.sourceDiagnostic(m.diagnostic,report?.stage||"source");closed=true;
      if(!working)await finishStop();return;
    }
    if(closed)return;
    if(working||finished){port.disconnect();return;}working=true;
    try{
      if(!t){
        if(m.op!=="hello")throw Error("Capture not authorized.");
        t=await rpc("ticket",{ticket:port.name.slice(7),tab:sender.tab.id,doc:sender.documentId});
        if(!uuid(t.attempt)||!t.sourceKey)throw Error("Capture expired.");
        key=t.attempt;live.add(key);await ledger(key,{device:t.device,sourceKey:t.sourceKey,mode:t.mode==="append"?"append":"save",phase:"reading",active:true,diagnostic:null,...(t.batch?{batch:t.batch}:{})});
        await initialized;dir=await (await root).getDirectoryHandle(key,{create:true});
        report=displayProgress(key,t.device,port);report.update({stage:"source",pages:1});
      }else if(m.op==="cancel-selection"&&t.mode==="append"&&!meta&&!count&&!delivered){finished=true;await clean("cancel");
      }else if(m.op==="header"&&!meta&&(t.sourceId||t.path.replace(/\/$/,"").split("/").at(-1))===m.id&&["tree","list"].includes(m.lineage)){
        if(t.mode==="append"&&m.lineage!=="list")throw Error("Sparse content is not a complete branch");
        meta={id:m.id,title:String(m.title).slice(0,512),lineage:m.lineage,excerpt:t.mode==="append"};
        archive=await ReaderArchive.writer(dir,meta);
      }else if(m.op==="asset"&&meta&&!current&&!writing&&typeof m.path==="string"&&/^assets\/[\p{L}\p{N}_.-]{1,200}$/u.test(m.path)&&!assets.has(m.path)){
        assetPath=m.path;const handle=await dir.getFileHandle("asset-"+assetIndex++,{create:true});assets.set(assetPath,handle);current=await handle.createWritable();
      }else if(m.op==="chunk"&&current&&typeof m.data==="string"&&m.data.length<=262144){
        const data=Uint8Array.from(atob(m.data),x=>x.charCodeAt(0));
        await current.write(data);
      }else if(m.op==="dropAsset"&&current){await current.abort();current=null;const h=assets.get(assetPath);
        assets.delete(assetPath);await dir.removeEntry(h.name);
      }else if(m.op==="endAsset"&&current){await current.close();current=null;
      }else if(m.op==="message-start"&&meta&&!current&&!writing){
        const row=m.row;if(!row||!Array.isArray(row.assets)||row.assets.some(p=>!assets.has(p)))throw Error("Invalid source message");
        // Only the worker's one-use capability-bound ticket enables the range
        // contract. Never accept this permission from a source-page message.
        if(t.mode==="append"&&t.extendedSelection!==true&&count>=250)throw Error("Select up to 250 messages for one reviewed append.");
        if(t.mode==="append"){
          if(row.sourcePath||!["user","assistant"].includes(row.role)||row.question!=null&&
            (row.role!=="assistant"||row.question!==lastSelectedUser))throw Error("Unselected source relationship");
          if(row.role==="user")lastSelectedUser=row.id;
          for(const path of row.assets)usedAssets.add(path);
        }
        await archive.begin(row);writing=true;
      }else if(m.op==="text"&&writing&&typeof m.value==="string"&&m.value.length<=65536){await archive.text(m.value);
      }else if(m.op==="message-end"&&writing){await archive.end();writing=false;count++;
      }else if(m.op==="finish"&&meta&&count&&!current&&!writing){
        if(!Array.isArray(m.images)||m.images.some(p=>!assets.has(p)))throw Error("Invalid image reference");
        if(t.mode==="append"&&usedAssets.size!==assets.size)throw Error("Only selected resources can be sent");
        meta.partial=!!m.partial;meta.images=m.images;report.update({stage:"package",done:0});
        const zip=await archive.finish(assets,report.update);archive=null;
        if(closed||await rpc("device")!==t.device||t.mode==="append"&&!await rpc("source-current",{tab:t.tab,doc:t.doc,path:t.path}))throw Error("Source tab or account changed.");
        for await(const [name] of dir)if(name!=="import.zip")await dir.removeEntry(name);
        if(closed)throw Error("Source closed before package handoff.");
        const job={key,mode:t.mode,device:t.device,binding:{size:zip.size,sha256:meta.zipDigest,project:t.project||null,excerpt:t.mode==="append"}};
        await ledger(key,{...job,phase:"uploading",active:true,partial:meta.partial,losses:m.losses,packageReady:true});delivered=true;
        try{
          await deliver(job,zip,report);
        }catch(e){try{await report.close();}catch(problem){e=problem;}
          await ledger(key,{phase:uploadFailure(e),active:false,diagnostic:failureDiagnostic(e,"upload"),...nextCheck(job,e)},t.device);throw e;}
        finally{live.delete(key);}
        finished=true;await report.close();
      }else throw Error("Invalid transfer sequence");
      if(!closed)port.postMessage({ok:true});
    }catch(e){const quota=e.name==="QuotaExceededError";if(!closed)port.postMessage({error:quota?(navigator.language.startsWith("zh")?"浏览器临时空间不足。":"Browser temporary storage is full."):e.message});closed=true;await clean(quota?"quota":null,e);port.disconnect();}
    finally{working=false;if(sourceStop)await finishStop();else if(closed&&!finished)await clean();}
  });
});
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m.kind==="reader-device-changed"&&s.id===chrome.runtime.id&&!s.tab){
    forgetDetachedDevice().catch(()=>{});return;
  }
  if(m.kind==="tick"&&s.id===chrome.runtime.id&&!s.tab){tick().catch(()=>{});return;}
  if(m.kind!=="panel-host"||s.id!==chrome.runtime.id)return;
  (async()=>{
    const standalone=s.url===chrome.runtime.getURL("panel.html")&&(!s.tab||s.frameId===0);
    // Match the worker's centerPage boundary; native extension panels need not
    // have a tab/frameId. A web-embedded private view still needs its parent grant.
    let center=false;
    try{const u=new URL(s.url);center=(s.documentLifecycle===undefined||s.documentLifecycle==="active")&&
      (s.frameId===0||!s.tab&&s.frameId===undefined)&&u.protocol==="chrome-extension:"&&u.hostname===chrome.runtime.id&&u.pathname==="/center.html";}catch{}
    if(!standalone&&!center&&!(s.url?.split("#")[0]==="chrome-extension://"+chrome.runtime.id+"/frame.html"&&s.frameId>0&&
       await chrome.runtime.sendMessage({kind:"panel-allowed",tab:s.tab.id,doc:s.documentId})))throw Error("Open Reader again.");
    const device=await rpc("device");if(!device||device!==m.device)throw Error("Reader account changed.");
    if(m.op==="check"||m.op==="retry"){
      const job=(await rpc("jobs")).find(j=>j.key===m.key&&j.device===device);if(!job)throw Error("Task not found.");
      await progress(job,m.decision,true,m.op==="retry");
    }else if(m.op==="discard"){
      await initialized;
      await navigator.locks.request("reader-local-"+m.key,async()=>{
        if(await rpc("device")!==device)throw Error("Reader account changed.");
        const j=(await rpc("jobs")).find(x=>x.key===m.key&&x.device===device);
        if(!j?.packageReady||j.active||live.has(j.key))throw Error("Transfer is active.");
        const receipt=await (await api(device,"requests/"+j.key)).json();
        if(receipt.id){await advance(j);return;}
        try{await api(device,"transfers/"+j.key,{method:"DELETE"});}catch(e){if(e.status!==404)throw e;}
        await ledger(j.key,{phase:"cancelled",active:false,packageReady:false,binding:null,diagnostic:null});await erase(j.key);
      });
    }else if((m.op==="download"||m.op==="skill")&&uuid(m.aid)){
      let resp,filename;
      if(m.op==="skill"){
        resp=await api(device,"context/skill?locale="+(m.locale==="zh-CN"?"zh-CN":"en"));
        if(resp.headers.get("Content-Type")?.includes("application/json")){
          if((await resp.json()).builtin!=="/skills/context-acquisition.zip")throw Error("Skill unavailable.");
          resp=await fetch(READER_ORIGIN+"/skills/context-acquisition.zip",{credentials:"omit",redirect:"error",referrerPolicy:"no-referrer"});
        }
        if(!resp.ok||resp.headers.get("Content-Type")?.includes("text/html"))throw Error("Skill unavailable.");
        filename="context-acquisition.zip";
      }else{
        const r=await api(device,`artifacts/${m.aid}/claim`,typed("POST",{session_id:crypto.randomUUID()}));
        const claim=await r.json();if(!uuid(claim.claim))throw Error("Invalid download lease");
        filename=claim.filename;resp=await api(device,`artifacts/${m.aid}/download?claim=${claim.claim}`);
        if(!filename){const match=/filename\*=utf-8''([^;]+)/i.exec(resp.headers.get("Content-Disposition")||"");
          filename=match?decodeURIComponent(match[1]):"conversation.context.zip";}
      }
      const key=crypto.randomUUID();await initialized;const dir=await (await root).getDirectoryHandle(key,{create:true});
      try{
        const f=await dir.getFileHandle("context.zip",{create:true});await resp.body.pipeTo(await f.createWritable());
        if(await rpc("device")!==device)throw Error("Reader account changed.");
        const file=await f.getFile(),magic=new Uint8Array(await file.slice(0,4).arrayBuffer());
        if(magic.join(",")!=="80,75,3,4")throw Error("ZIP unavailable.");
        const url=URL.createObjectURL(file);
        try{const id=await rpc("download",{url,filename,skill:m.op==="skill"});downloads.set(id,{key,url});}
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
