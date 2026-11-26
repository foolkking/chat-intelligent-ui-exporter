// Isolated content world. No Reader credentials, storage permission use or external message bridge here.
(() => {
  // Generated labels in stored Markdown must not change the source digest when
  // the same account switches browser language. Interface language is separate.
  globalThis.ChatExportI18n.setLocale("en");
  const pathId=()=>location.pathname.match(/^\/(?:g\/[\w-]+\/)?c\/([\w-]+)\/?$/)?.[1];
  const leaf=ReaderPageIndex.leaf;
  const source=globalThis.ChatExportSourceDOM, generating=source.generating;
  const text=(cn,en)=>navigator.language.startsWith("zh")?cn:en;
  let cancelCapture=null;
  const idOK=s=>typeof s==="string"&&/^[\w-]{1,128}$/.test(s);
  function wire(ticket,onProgress,onDisconnect){
    const port=chrome.runtime.connect({name:"reader:"+ticket});let pending=null,dead=false;
    port.onDisconnect.addListener(()=>{dead=true;onDisconnect();pending?.reject(Error("Reader connection closed"));});
    port.onMessage.addListener(m=>{if(m.op==="progress"){onProgress(m.step);return;}if(pending){const p=pending;pending=null;m.error?p.reject(Error(m.error)):p.resolve(m);}});
    return {observe:step=>{if(!dead)port.postMessage({op:"observe",step});},
      send:m=>new Promise((resolve,reject)=>{if(dead||pending)return reject(Error("Transfer interrupted"));pending={resolve,reject};port.postMessage(m)}),
      close:()=>{dead=true;pending?.reject(Error(text("读取已取消","Capture cancelled")));pending=null;port.disconnect();}};
  }
  async function capture(onStart,excerpt=false,batch=null,onProgress=()=>{}){
    const id=batch?.id||pathId(),route=location.pathname,controller=new AbortController(),version=ReaderPageIndex.sample();
    const check=()=>{controller.signal.throwIfAborted();batch?.check();if(location.pathname!==route||!batch&&(generating()||version!==ReaderPageIndex.sample()))throw Error(text("对话或分支发生变化，请重新保存。","Conversation or branch changed. Save again."));};
    cancelCapture=()=>controller.abort();
    check();if(batch)await batch.assert();
    const start=batch||await chrome.runtime.sendMessage({kind:excerpt?"start-append":"start",path:route});check();
    if(!start?.ticket){const e=Error(text("未开始保存。请在侧栏核对目标、连接和实例是否支持网页保存。","Save did not start. Check destination, connection and capture support in the panel."));
      e.displayState=start?.state||(["reconnect","unavailable"].includes(start?.error)?start.error:null);throw e;}
    onStart(start.attempt);
    const port=wire(start.ticket,onProgress,()=>controller.abort());
    const reporter=ReaderProgress.throttle(step=>{onProgress(step);port.observe(step);});
    cancelCapture=()=>{controller.abort();port.close();};
    const guard=()=>{try{check();}catch{cancelCapture?.();}};
    const watch=new MutationObserver(()=>{if(generating()||location.pathname!==route)guard();});watch.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["data-current-node-id","data-testid"]});
    addEventListener("popstate",guard);const clock=setInterval(guard,500);
    const request=sourceRequest(controller,check,step=>reporter.update(step),batch?.validate);
    try{
      await port.send({op:"hello"});
      reporter.update({stage:"source",pages:1});
      const api=globalThis.FastTextExporter,data=await readBranch(id,controller,request,check,step=>reporter.update(step),!!batch);
      check();if(!batch)verifyVisible(data);
      const lineage=data.source==="conversation-tree"?"tree":"list";
      let messages;
      // Keep selection metadata only. The Blob-backed provider owns full
      // bodies, which are read for search/preview or one selected message.
      if(excerpt){messages=[];for await(const m of data.rows()){
        source.remember(m);check();messages.push({id:m.id,role:m.role,title:ReaderExcerpt.snippet(ReaderVisible(m,api).body)});
      }}
      const preview=async(m,signal)=>{signal?.throwIfAborted();check();const row=await data.row(m.id);signal?.throwIfAborted();check();
        if(!row)throw Error("Source message unavailable");return ReaderVisible(row,api).body;};
      const selectionOptions={extended:start.extendedSelection===true};
      const chosen=excerpt?await ReaderExcerpt.choose(messages,data.title,preview,controller.signal,selectionOptions):null;
      check();
      const selection=chosen?ReaderExcerpt.selected(messages,chosen,lineage==="tree",selectionOptions):null;
      const items=selection?(async function*(){for(const entry of selection){
        check();const row=await data.row(entry.row.id);if(!row)throw Error("Source message unavailable");
        yield {row,question:entry.question};
      }})():null;
      await port.send({op:"header",id,title:data.title,lineage:excerpt?"list":lineage});
      await sendMessages({api,data,id,excerpt,items,selectedCount:selection?.length,request,controller,check,port,textOnly:!!start.textOnly,reporter,batch});
      if(excerpt){check();const r=await chrome.runtime.sendMessage({kind:"open-append",path:route,attempt:start.attempt});
        if(!r?.ok)throw Error(text("已交给 Reader，可在资料库任务中继续。","Received by Reader. Continue from library tasks."));}
    }catch(e){
      if(excerpt&&e.name==="AbortError"&&!controller.signal.aborted)await port.send({op:"cancel-selection"}).catch(()=>{});
      throw e;
    }finally{reporter.close();watch.disconnect();clearInterval(clock);removeEventListener("popstate",guard);controller.abort();port.close();}
  }
  // Read only the explicitly opened conversation using the existing bounded Fork adapter.
  function sourceRequest(controller,check,report=()=>{},validateSession){
    let sourceBytes=0,sourcePages=0;
    return async(input,opts={})=>{
      check();const u=new URL(input,location.origin),local=u.origin===location.origin;
      if(u.protocol!=="https:"||u.username||u.password||(!local&&!/(?:^|\.)(?:oaiusercontent\.com|oaistatic\.com|openai\.com)$/.test(u.hostname)))throw Error("Unsupported media origin");
      const response=await fetch(u,{...opts,...(!local?{credentials:"omit",headers:{}}:{}),cache:"no-store",redirect:"error",signal:controller.signal,referrerPolicy:"no-referrer"});
      async function readerFile(pages){
        if(!response.body)throw Error(text("来源没有返回对话正文。","The source returned no conversation body."));
        const total=contentLength(response.headers);let done=0;
        report({stage:"source",pages,done,total,sourceBytes,sourcePages});
        const stream=response.body.pipeThrough(new TransformStream({transform(bytes,out){
          controller.signal.throwIfAborted();done+=bytes.byteLength;sourceBytes+=bytes.byteLength;
          report({stage:"source",pages,done,total,sourceBytes,sourcePages});out.enqueue(bytes);
        }}));
        const file=await new Response(stream).blob();sourcePages++;
        report({stage:"source",pages,done,total,sourceBytes,sourcePages});return file;
      }
      return {ok:response.ok,status:response.status,headers:response.headers,body:response.body,
        json:async()=>{const value=await response.json();if(local&&u.pathname==="/api/auth/session"&&validateSession)await validateSession(value);return value;},
        blob:()=>response.blob(),readerFile};
    };
  }
  function contentLength(headers){return !headers?.get("Content-Encoding")?Number(headers?.get("Content-Length"))||undefined:undefined;}
  function readBranch(id,controller,request,check,report,batch=false){const marker=batch?undefined:leaf();return FastTextExporter.loadConversation({id,leafId:marker,fetch:request,
    signal:controller.signal,retainRaw:false,sourcePaths:true,readerSource:ReaderSourceFile.conversation(id,marker,check,report)});}
  function verifyVisible(data){
    if(!source.verify(data))throw Error(text("无法确认当前分支。","Current branch could not be verified."));
  }
  async function sendMessages({api,data,id,excerpt,items,selectedCount,request,controller,check,port,textOnly,reporter,batch}){
      const sourceWarnings=data.warnings?.length||0;
      const paths=new Map(),images=new Set(),losses={files:0,interactions:sourceWarnings,links:0};let partial=losses.interactions>0;
      const slots=Number(navigator.deviceMemory)>=4?2:1;
      let messageCount=0,fileCount=0,textBytes=0,assetBytes=0,filesStarted=0,filesSucceeded=0,filesFailed=0;
      const discovered=new Set(),encoder=new TextEncoder();
      const counters=()=>({messageCount,textBytes,assetBytes,filesStarted,filesSucceeded,filesFailed,filesDiscovered:discovered.size});
      const observe=value=>reporter.update({...counters(),...value});
      async function prepareResource(ref,info,m){
        const identity=info.sandbox?m.id+":"+ref:ref;
        if(paths.has(identity))return {identity};
        if(!discovered.has(identity)){discovered.add(identity);filesStarted++;}
        observe({stage:"asset",files:filesStarted,done:0});
        const options={conversationId:id,fetch:request,signal:controller.signal,concurrency:1,streamMedia:true};
        const file=info.sandbox?(await api.downloadSandboxFiles({...options,items:[{messageId:m.id,path:ref}]}))[0]:
          (await api.downloadFiles({...options,ids:[ref]}))[0];
        if(!file?.stream)return {identity};
        const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity));
        const prefix=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("").slice(0,20);
        return {identity,prefix,file};
      }
      async function writeResource({identity,prefix,file},info){
        if(paths.has(identity)){await file?.stream.cancel();return paths.get(identity);}
        if(!file){paths.set(identity,null);partial=true;losses.files++;filesFailed++;observe({stage:"asset",files:filesStarted,done:0});return null;}
        const reader=file.stream.getReader(),total=contentLength(file.headers),first=[];let done=0,opened=false;
        observe({stage:"asset",files:++fileCount,done,total});
        const failed=()=>{paths.set(identity,null);partial=true;losses.files++;filesFailed++;observe({stage:"asset",files:fileCount,done,total});};
        async function next(){try{const part=await reader.read();if(!part.done)assetBytes+=part.value.byteLength;return part;}catch(e){
          controller.signal.throwIfAborted();if(opened)await port.send({op:"dropAsset"});failed();return null;}}
        try{
          let prefixSize=0,part;
          do{part=await next();if(!part)return null;if(!part.done){first.push(part.value);prefixSize+=part.value.length;}}
          while(!part.done&&prefixSize<12);
          let ext=file.ext||"bin";
          if(!info.name&&ext==="bin")ext=await api.sniffImage(new Blob(first.map(x=>x.subarray(0,12))).slice(0,12));
          const rawname=(info.name||`${file.fileId}.${ext}`).replace(/[^\p{L}\p{N}_.-]/gu,"_").slice(-100);
          const path="assets/"+prefix+"-"+rawname;await port.send({op:"asset",path});opened=true;
          async function write(chunk){for(let pos=0;pos<chunk.length;pos+=196608){
            check();const bytes=chunk.subarray(pos,pos+196608);
            let s="";for(let k=0;k<bytes.length;k+=8192)s+=String.fromCharCode(...bytes.subarray(k,k+8192));
            await port.send({op:"chunk",data:btoa(s)});done+=bytes.length;observe({stage:"asset",files:fileCount,done,total});
          }}
          for(const bytes of first)await write(bytes);
          while(!part.done){part=await next();if(!part)return null;if(!part.done)await write(part.value);}
          if(total!==undefined&&total!==done){await port.send({op:"dropAsset"});failed();return null;}
          await port.send({op:"endAsset"});paths.set(identity,path);if(info.image)images.add(path);
          filesSucceeded++;observe({stage:"asset",files:fileCount,done,total});return path;
        }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      }
      for await(const entry of items??data.rows()){
        observe({stage:"messages",done:messageCount,total:selectedCount});
        const m=items?entry.row:entry;
        source.remember(m);
        check();if(!idOK(m.id))throw Error("Invalid message identity");
        const visible=globalThis.ReaderVisible(m,api);let body=visible.body;const assets=new Set(), jobs=new Map();
        if(visible.missing)partial=true;
        for(const a of m.images||[])jobs.set("asset:"+a.fileId,{ref:a.fileId,image:true});
        for(const a of m.attachments||[])jobs.set("attachment:"+a.fileId,{ref:a.fileId,name:a.name});
        for(const a of m.tables||[])jobs.set("datatable:"+a.fileId,{ref:a.fileId,name:(a.title||"table")+".csv"});
        for(const link of body.matchAll(/\]\(sandbox:(\/mnt\/data\/[^()\s]+)\)/g))jobs.set("sandbox:"+link[1],{ref:link[1],name:link[1].split("/").pop(),sandbox:true});
        const entries=[...jobs];
        for(let i=0;i<entries.length;i+=slots){
          const group=entries.slice(i,i+slots);
          if(textOnly){for(const [src] of group)body=body.split("]("+src+")").join("] [text only]");continue;}
          if(group.some(([,v])=>!paths.has(v.sandbox?m.id+":"+v.ref:v.ref)))
            observe({stage:"asset",files:fileCount+1,done:0});
          const files=await Promise.all(group.map(([,v])=>prepareResource(v.ref,v,m)));
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
        const row={id:m.id,...(!excerpt?{sourcePath:m.sourcePath}:entry.question?{question:entry.question}:{}),role:m.role,at:Number.isFinite(m.createTime)?new Date(m.createTime*1000).toISOString():null,assets:[...assets]};
        await port.send({op:"message-start",row});
        for(let pos=0;pos<body.length;){
          let end=Math.min(body.length,pos+65536);
          if(end<body.length&&body.charCodeAt(end-1)>=0xd800&&body.charCodeAt(end-1)<=0xdbff)end--;
          check();await port.send({op:"text",value:body.slice(pos,end)});pos=end;
        }
        await port.send({op:"message-end"});messageCount++;
        // Encode in the same bounded chunks as transport; do not allocate a
        // second full UTF-8 copy for a multi-megabyte reply merely to count it.
        for(let pos=0;pos<body.length;){
          let end=Math.min(body.length,pos+65536);
          if(end<body.length&&body.charCodeAt(end-1)>=0xd800&&body.charCodeAt(end-1)<=0xdbff)end--;
          textBytes+=encoder.encode(body.slice(pos,end)).byteLength;pos=end;
        }
        observe({stage:"messages",done:messageCount,total:selectedCount});
      }
      // A lazy provider discovers warnings while rows are consumed; a parsed
      // provider already supplied them above. Count both exactly once.
      losses.interactions+=Math.max(0,(data.warnings?.length||0)-sourceWarnings);
      partial||=losses.interactions>0;
      observe({stage:"messages",done:messageCount,total:messageCount,filesTotal:discovered.size,unresolvedResources:losses.files});
      reporter.flush();check();if(batch)await batch.assert();else verifyVisible(data);await port.send({op:"finish",partial,losses,images:[...images]});
  }
  const save=async(onStart,excerpt,batch,onProgress)=>{if(cancelCapture)throw Error("Capture in progress.");
    try{await capture(onStart,excerpt,batch,onProgress);}finally{cancelCapture=null;}};
  globalThis.ReaderWorkspace?.({capture:save,busy:()=>!!cancelCapture});
  ReaderOverlay({busy:()=>!!cancelCapture,read:async(controller,onProgress=()=>{})=>{
    const route=location.pathname,id=pathId();if(!id)throw Error("No conversation");
    const version=ReaderPageIndex.sample(),check=()=>{controller.signal.throwIfAborted();if(route!==location.pathname||version!==ReaderPageIndex.sample())throw Error("Source changed");};
    const data=await readBranch(id,controller,sourceRequest(controller,check,onProgress),check,onProgress);check();verifyVisible(data);
    const rows=[];let count=0,lastYield=performance.now();
    for await(const m of data.rows()){
      source.remember(m);
      check();rows.push(...ReaderPageIndex.fromBranch({messages:[m]}).map(ReaderPageIndex.metadata));
      if(++count%32===0)onProgress({stage:"index",done:count});
      if(performance.now()-lastYield>12){await new Promise(r=>setTimeout(r,0));lastYield=performance.now();}
    }
    onProgress({stage:"index",done:count});
    return {rows,complete:!data.warnings?.length,loadBody:async(id,signal)=>{
      signal?.throwIfAborted();check();const row=await data.row(id);signal?.throwIfAborted();check();
      if(!row)throw Error("Message unavailable");return ReaderVisible(row,FastTextExporter).body||"";
    }};
  }});
  ReaderSourceControl({pathId,capture:save,cancel:()=>cancelCapture?.()});
})();
