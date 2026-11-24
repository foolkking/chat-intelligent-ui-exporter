// Isolated content world. No Reader credentials, storage permission use or external message bridge here.
(() => {
  // Generated labels in stored Markdown must not change the source digest when
  // the same account switches browser language. Interface language is separate.
  globalThis.ChatExportI18n.setLocale("en");
  const pathId=()=>location.pathname.match(/^\/(?:g\/[\w-]+\/)?c\/([\w-]+)\/?$/)?.[1];
  const leaf=()=>[...document.querySelectorAll("[data-message-id]")].filter(n=>!n.closest('[hidden],[aria-hidden="true"]')).at(-1)?.dataset.messageId;
  const generating=()=>!!document.querySelector('[data-testid="stop-button"],[data-talvt-turn-state="in_progress"],button[aria-label="Stop generating"],button[aria-label="停止生成"]');
  const text=(cn,en)=>navigator.language.startsWith("zh")?cn:en;
  let cancelCapture=null;
  const idOK=s=>typeof s==="string"&&/^[\w-]{1,128}$/.test(s);
  function wire(ticket){
    const port=chrome.runtime.connect({name:"reader:"+ticket});let pending=null,dead=false;
    port.onDisconnect.addListener(()=>{dead=true;pending?.reject(Error("Reader connection closed"));});
    port.onMessage.addListener(m=>{if(pending){const p=pending;pending=null;m.error?p.reject(Error(m.error)):p.resolve(m);}});
    return {send:m=>new Promise((resolve,reject)=>{if(dead||pending)return reject(Error("Transfer interrupted"));pending={resolve,reject};port.postMessage(m)}),
      close:()=>{dead=true;pending?.reject(Error(text("读取已取消","Capture cancelled")));pending=null;port.disconnect();}};
  }
  async function capture(onStart,excerpt=false){
    const id=pathId(),route=location.pathname,initialLeaf=leaf(),controller=new AbortController();let budget=32*1024*1024;
    const check=()=>{controller.signal.throwIfAborted();if(location.pathname!==route||generating()||initialLeaf&&leaf()&&initialLeaf!==leaf())throw Error(text("对话或分支发生变化，请重新保存。","Conversation or branch changed. Save again."));};
    cancelCapture=()=>controller.abort();
    check();const start=await chrome.runtime.sendMessage({kind:excerpt?"start-append":"start",path:route});check();
    if(!start?.ticket){const e=Error(text("未开始保存。请在侧栏核对目标、连接和实例是否支持网页保存。","Save did not start. Check destination, connection and capture support in the panel."));
      e.displayState=start?.state||(["reconnect","unavailable"].includes(start?.error)?start.error:null);throw e;}
    onStart(start.attempt);
    const port=wire(start.ticket);
    cancelCapture=()=>{controller.abort();port.close();};
    const guard=()=>{try{check();}catch{cancelCapture?.();}};
    const watch=new MutationObserver(guard);watch.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["data-message-id","data-testid"]});
    addEventListener("popstate",guard);const clock=setInterval(guard,500);
    // Only the existing Fork adapter may use this scoped fetch; Reader receives no source credentials.
    const request=async(input,opts={})=>{
      check();const u=new URL(input,location.origin),local=u.origin===location.origin;
      if(u.protocol!=="https:"||u.username||u.password||(!local&&!/(?:^|\.)(?:oaiusercontent\.com|oaistatic\.com|openai\.com)$/.test(u.hostname)))throw Error("Unsupported media origin");
      const response=await fetch(u,{...opts,...(!local?{credentials:"omit",headers:{}}:{}),redirect:"error",signal:controller.signal,referrerPolicy:"no-referrer"});
      async function bounded(max){
        if(!response.body||Number(response.headers.get("Content-Length"))>max)throw Error("Source exceeds the capture limit");
        const reader=response.body.getReader(),parts=[];let used=0;
        try{while(true){const r=await reader.read();if(r.done)break;used+=r.value.length;if(used>max)throw Error("Source exceeds the capture limit");parts.push(r.value);}}
        finally{await reader.cancel().catch(()=>{});}
        return new Blob(parts,{type:response.headers.get("Content-Type")||""});
      }
      return {ok:response.ok,status:response.status,headers:response.headers,
        json:async()=>{const b=await bounded(Math.min(budget,8*1024*1024));budget-=b.size;return JSON.parse(await b.text())},
        blob:()=>bounded(16*1024*1024)};
    };
    try{
      await port.send({op:"hello"});
      const api=globalThis.FastTextExporter,data=await api.loadConversation({id,leafId:initialLeaf,fetch:request,
        signal:controller.signal,retainRaw:false,maxMessages:50000,sourcePaths:true});
      const lineage=data.source==="conversation-tree"?"tree":"list";
      const chosen=excerpt?await ReaderExcerpt.choose(data.messages,data.title,m=>ReaderVisible(m,api).body,controller.signal):null;
      check();
      const items=chosen?ReaderExcerpt.selected(data.messages,chosen,lineage==="tree"):null;
      await port.send({op:"header",id,title:data.title,lineage:excerpt?"list":lineage});
      const paths=new Map(),images=new Set(),losses={files:0,interactions:data.warnings?.length||0,links:0};let partial=losses.interactions>0;
      const slots=Number(navigator.deviceMemory)>=4?2:1;
      async function prepareResource(ref,info,m){
        const identity=info.sandbox?m.id+":"+ref:ref;
        if(paths.has(identity))return {identity};
        const file=info.sandbox?(await api.downloadSandboxFiles({items:[{messageId:m.id,path:ref}],conversationId:id,fetch:request,signal:controller.signal,concurrency:1}))[0]:
          (await api.downloadFiles({ids:[ref],conversationId:id,fetch:request,signal:controller.signal,concurrency:1}))[0];
        if(!file?.blob)return {identity};
        const rawname=(info.name||file.path?.split("/").pop()||"file").replace(/[^\p{L}\p{N}_.-]/gu,"_").slice(-100);
        const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity));
        const prefix=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,20);
        return {identity,path:"assets/"+prefix+"-"+rawname,blob:file.blob};
      }
      async function writeResource({identity,path,blob},info){
        if(paths.has(identity))return paths.get(identity);
        if(!blob){partial=true;losses.files++;return null;}
        await port.send({op:"asset",path});
        for(let pos=0;pos<blob.size;pos+=196608){
          check();const bytes=new Uint8Array(await blob.slice(pos,pos+196608).arrayBuffer());
          let s="";for(let k=0;k<bytes.length;k+=8192)s+=String.fromCharCode(...bytes.subarray(k,k+8192));
          await port.send({op:"chunk",data:btoa(s)});
        }
        await port.send({op:"endAsset"});paths.set(identity,path);if(info.image)images.add(path);return path;
      }
      for(const entry of items??data.messages){
        const m=items?entry.row:entry;
        check();if(!idOK(m.id))throw Error("Invalid message identity");
        const visible=globalThis.ReaderVisible(m,api);let body=visible.body;const assets=new Set(), jobs=new Map();
        if(visible.missing)partial=true;
        for(const a of m.images||[])jobs.set("asset:"+a.fileId,{ref:a.fileId,image:true});
        for(const a of m.attachments||[])jobs.set("attachment:"+a.fileId,{ref:a.fileId,name:a.name});
        for(const a of m.tables||[])jobs.set("datatable:"+a.fileId,{ref:a.fileId,name:(a.title||"table")+".csv"});
        for(const link of body.matchAll(/\]\(sandbox:(\/mnt\/data\/[^()\s]+)\)/g))jobs.set("sandbox:"+link[1],{ref:link[1],name:link[1].split("/").pop(),sandbox:true});
        const entries=[...jobs];
        for(let i=0;i<entries.length;i+=slots){
          const group=entries.slice(i,i+slots),files=await Promise.all(group.map(([,v])=>prepareResource(v.ref,v,m)));
          for(let k=0;k<group.length;k++){
            const [src,info]=group[k],target=await writeResource(files[k],info);const link="]("+src+")";
            if(target){if(!body.includes(link))body+="\n\n["+(info.image?"Image":"File")+"]("+src+")";body=body.split(link).join("]("+target+")");assets.add(target);}
            else body=body.split(link).join("] [unavailable]");
          }
        }
        if(m.needsAssets||visible.missing||m.needsUI&&!m.dil){partial=true;if(m.needsAssets)losses.files++;if(visible.missing||m.needsUI&&!m.dil)losses.interactions++;}
        // Do not persist expiring media links or cause Reader clients to load external pixels.
        body=body.replace(/!\[([^\]]*)\]\(https?:\/\/[^)\s]+\)/gi,(_,alt)=>{partial=true;losses.links++;return `[${alt||"Image"} unavailable]`;})
          .replace(/https?:\/\/[^\s)<>]*(?:[?&](?:x-amz-signature|x-goog-signature|sig|access_token)=)[^\s)<>]*/gi,()=>{partial=true;losses.links++;return "[temporary link omitted]";});
        await port.send({op:"message",row:{id:m.id,...(!excerpt?{sourcePath:m.sourcePath}:entry.question?{question:entry.question}:{}),role:m.role,at:Number.isFinite(m.createTime)?new Date(m.createTime*1000).toISOString():null,body,assets:[...assets]}});
      }
      check();await port.send({op:"finish",partial,losses,images:[...images]});
      if(excerpt){check();const r=await chrome.runtime.sendMessage({kind:"open-append",path:route,attempt:start.attempt});
        if(!r?.ok)throw Error(text("已交给 Reader，可在侧栏任务中继续。","Received by Reader. Continue from side-panel tasks."));}
    }catch(e){
      if(excerpt&&e.name==="AbortError"&&!controller.signal.aborted){
        // A user cancelling before choosing is not an interrupted upload.
        await port.send({op:"cancel-selection"}).catch(()=>{});
      }
      if(/limit|too large|too many|too long|exceeds/i.test(e.message)){
        await port.send({op:"limit"}).catch(()=>{});
        throw Error(text("超出单次采集上限，未发送。可在 Reader 手动导入来源文件。","This conversation exceeds the capture limit and was not sent. Import the source file in Reader."));
      }
      throw e;
    }finally{watch.disconnect();clearInterval(clock);removeEventListener("popstate",guard);controller.abort();port.close();}
  }
  ReaderSourceControl({pathId,capture:async (onStart,excerpt)=>{try{await capture(onStart,excerpt);}finally{cancelCapture=null;}},cancel:()=>cancelCapture?.()});
})();
