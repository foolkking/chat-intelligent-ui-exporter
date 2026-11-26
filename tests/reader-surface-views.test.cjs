// Worker ACL/state tests use synthetic tabs/documents only, never a browser.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const id="a".repeat(32),base="chrome-extension://"+id+"/",json=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture({batch=false,sidePanel=true}={}){
  const listeners=[],sent=[],created=[],opened=[],calls=[],session={},local={},pages=new Map([
    [1,{id:1,windowId:8,url:"https://chatgpt.com/c/synthetic",active:true,doc:"source-doc"}],
    [2,{id:2,windowId:9,url:"https://other.example.test/",active:true,doc:"other-doc"}]]);
  let action,hold,discovery,removed,sideError=false,beforeRequest,afterSet;
  const store=data=>({async get(keys){return keys===null?{...data}:Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]));},
    async set(patch){Object.assign(data,patch);await afterSet?.(patch);},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}});
  const c=vm.createContext({URL,URLSearchParams,Date,crypto:require("node:crypto").webcrypto,
    READER_ORIGIN:"https://reader.example.test",ReaderClient:{trust:Promise.resolve(),request:async(_id,url)=>{
      calls.push(url);const value=await beforeRequest?.(url);
      return {json:async()=>value||(url==="capabilities"?{capture:true,resumable_capture:true,import_profile:"reader-chat-v1"}:{id:null})};}},
    navigator:{locks:{request:async(_name,fn)=>fn()}},host:async()=>calls.push("host"),sourceKey:async()=>"synthetic-key",pendingSave:()=>false,
    saveUuid:s=>typeof s==="string"&&/^[\da-f-]{36}$/.test(s),
    source:s=>s.id===id&&s.frameId===0&&!!s.documentId&&s.url?.startsWith("https://chatgpt.com/"),
    chrome:{runtime:{id,getURL:name=>base+name,onMessage:{addListener:fn=>listeners.push(fn)}},
      storage:{session:store(session),local:store(local)},action:{onClicked:{addListener:fn=>{action=fn;}}},
      ...(sidePanel?{sidePanel:{open:args=>{opened.push(args);return sideError?Promise.reject(Error("unavailable")):Promise.resolve();}}}:{}),
      tabs:{get:async tab=>{calls.push("tab:"+tab);return pages.get(tab);},query:async()=>{calls.push("query");return [...pages.values()];},
        sendMessage:async(tab,message,options)=>{
          sent.push({tab,message,options});const page=pages.get(tab);
          if(message.kind==="reader-surface-path"){
            if(hold)await hold.promise;
            return {current:page?.doc===options.documentId&&new URL(page.url).pathname===message.path};
          }
          if(message.kind==="reader-batch-discover")return discovery||{path:"/c/synthetic",nonce:"00000000-0000-4000-8000-000000000001",scope:"synthetic-scope",rows:[],groups:{},complete:false};
          if(message.kind==="reader-batch-check")return {current:true};
          return {ok:true,started:true};
        },
        create:async args=>{created.push(args);return args;},onRemoved:{addListener:fn=>{removed=fn;}}}}});
  for(const file of ["routes.js","surfaces.js",...(batch?["batch-worker.js"]:[])])
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../reader",file),"utf8"),c);
  const top={id,tab:pages.get(1),frameId:0,documentId:"source-doc",url:pages.get(1).url};
  const child=(doc="import-doc")=>({id,tab:pages.get(1),frameId:3,documentId:doc,url:base+"frame.html#unused"});
  const send=(message,sender=top)=>new Promise(resolve=>{
    for(const listener of listeners){const result=listener(message,sender,resolve);if(result===true)return;}
    resolve(undefined);
  });
  const grant=async(view="import",doc=view+"-doc")=>{
    const ticket=await send({kind:"frame-ticket",path:"/c/synthetic",view});
    return {ticket:ticket.ticket,reply:await send({kind:"frame-claim",ticket:ticket.ticket},child(doc)),sender:child(doc)};
  };
  return {c,session,local,pages,sent,created,opened,calls,top,child,send,grant,action:tab=>action(pages.get(tab)),
    hold:gate=>{hold=gate;},discovery:response=>{discovery=response;},sideError:()=>{sideError=true;},removed:tab=>removed(tab),
    beforeRequest:fn=>{beforeRequest=fn;},afterSet:fn=>{afterSet=fn;}};
}
test("source open-center requests import on that exact live document with no new tab or private reply",async()=>{
  const f=fixture();assert.deepEqual(json(await f.send({kind:"open-center",path:"/c/synthetic"})),{ok:true});
  assert.deepEqual(f.created,[]);assert.deepEqual(json(f.sent.at(-1)),{tab:1,message:{kind:"reader-open-import"},options:{documentId:"source-doc"}});
  f.pages.get(1).doc="replacement";f.sent.length=0;
  assert.deepEqual(json(await f.send({kind:"open-center",path:"/c/synthetic"})),{});
  assert.equal(f.sent.some(x=>x.message.kind==="reader-open-import"),false);assert.deepEqual(f.created,[]);
});
test("tickets bind an allowlisted view and claims return only ok/view/tab",async()=>{
  const f=fixture();
  for(const view of ["import","library"]){
    const g=await f.grant(view);assert.deepEqual(json(g.reply),{ok:true,view,tab:1});
    assert.equal(f.session["frame:"+view+"-doc"].view,view);
    assert.deepEqual(json(await f.send({kind:"frame-claim",ticket:g.ticket},f.child("replay"))),{});
  }
  for(const view of ["center.html","../../host.html","https://other.test/","",null,{}])
    assert.deepEqual(json(await f.send({kind:"frame-ticket",path:"/c/synthetic",view})),{});
});
test("library and import frames coexist for the same source; issuing another view does not revoke either",async()=>{
  const f=fixture(),a=await f.grant("import"),b=await f.grant("library");
  assert.ok(f.session["frame:import-doc"]);assert.ok(f.session["frame:library-doc"]);
  const host={id,url:base+"host.html"};
  for(const doc of ["import-doc","library-doc"])assert.equal(await f.send({kind:"panel-allowed",tab:1,doc},host),true);
  assert.deepEqual(json(await f.send({kind:"frame-view",view:"library"},a.sender)),{ok:true});
  assert.deepEqual(json(f.sent.at(-1)),{tab:1,message:{kind:"reader-open-library"},options:{documentId:"source-doc"}});
  await f.send({kind:"open-center"},b.sender);assert.equal(f.sent.at(-1).message.kind,"reader-open-import");
  assert.deepEqual(f.created,[]);
});
test("view navigation refuses forged, query-selecting, top-level, foreign and replaced-parent senders",async()=>{
  const f=fixture(),g=await f.grant();
  const patches=[{id:"b".repeat(32)},{frameId:0},{documentId:"unknown"},{url:base+"frame.html?page=center.html"},{url:base+"center.html"},
    {url:"https://chatgpt.com/frame.html"},{tab:{id:2}},{documentLifecycle:"cached"}];
  for(const patch of patches){
    const before=f.sent.length;assert.deepEqual(json(await f.send({kind:"frame-view",view:"library"},{...g.sender,...patch})),{});
    assert.equal(f.sent.slice(before).some(x=>x.message.kind==="reader-open-library"),false);
  }
  assert.deepEqual(json(await f.send({kind:"frame-view",view:"host.html"},g.sender)),{});
  f.pages.get(1).doc="new-parent";
  assert.deepEqual(json(await f.send({kind:"frame-view",view:"library"},g.sender)),{});
  assert.deepEqual(f.created,[]);
});
test("background tab hiding does not revoke a live-parent import frame; real navigation does",async()=>{
  const f=fixture(),g=await f.grant();
  f.pages.get(1).active=false;
  assert.deepEqual(json(await f.send({kind:"frame-view",view:"library"},g.sender)),{ok:true});
  f.pages.get(1).url="https://chatgpt.com/c/other";
  assert.deepEqual(json(await f.send({kind:"frame-view",view:"library"},g.sender)),{});
});
test("non-ChatGPT toolbar opens native sidePanel synchronously, with fixed center fallback only on failure",async()=>{
  const f=fixture(),pending=f.action(2);assert.deepEqual(json(f.opened),[{windowId:9}]);
  await pending;assert.deepEqual(f.created,[]);assert.equal(f.sent.length,0);
  f.sideError();await f.action(2);assert.deepEqual(json(f.created),[{url:base+"center.html"}]);
  const missing=fixture({sidePanel:false});await missing.action(2);assert.deepEqual(json(missing.created),[{url:base+"center.html"}]);
});
test("ChatGPT toolbar stays on its source and closing a private frame replies with no private data",async()=>{
  const f=fixture();await f.action(1);assert.deepEqual(f.created,[]);assert.deepEqual(f.opened,[]);
  const g=await f.grant();assert.deepEqual(json(await f.send({kind:"frame-close"},g.sender)),{});
  assert.deepEqual(json(f.sent.at(-1)),{tab:1,message:{kind:"reader-collapse"},options:{documentId:"source-doc"}});
});
test("batch requests await import-frame authorization, reject library/source senders and retain standalone center compatibility",async()=>{
  const f=fixture({batch:true}),g=await f.grant(),library=await f.grant("library"),gate=deferred();f.hold(gate);f.calls.length=0;
  const pending=f.send({kind:"batch-tabs"},g.sender);await new Promise(r=>setImmediate(r));
  assert.equal(f.calls.includes("query"),false);gate.resolve();await pending;assert.equal(f.calls.includes("query"),true);
  f.hold(null);
  for(const sender of [library.sender,f.top,{...g.sender,url:base+"frame.html?page=center.html"},{...g.sender,documentId:"unknown"}]){
    f.calls.length=0;const reply=await f.send({kind:"batch-tabs"},sender);
    assert.equal(f.calls.includes("query"),false);assert.ok(!reply?.tabs);
  }
  assert.ok((await f.send({kind:"batch-tabs"},{id,frameId:0,url:base+"center.html?tab=1"})).tabs);
  assert.ok((await f.send({kind:"batch-tabs"},{id,url:base+"center.html"})).tabs,"Native extension panel context has no source tab.");
});
test("a parent replaced while discovery awaits cannot publish a catalogue into the old import frame",async()=>{
  const f=fixture({batch:true}),g=await f.grant();
  f.discovery({path:"/c/synthetic",nonce:"00000000-0000-4000-8000-000000000001",scope:"synthetic-scope",
    get rows(){f.pages.get(1).doc="replaced";return [];}});
  const r=await f.send({kind:"batch-discover",tab:1},g.sender);
  assert.ok(!r?.catalog);assert.equal(Object.keys(f.session).filter(k=>k.startsWith("catalog:")).length,0);
});
test("import-frame batch capture preserves Reader account ownership before any host/API admission",async()=>{
  const f=fixture({batch:true}),g=await f.grant();
  f.local.device={id:"current-device",user:"current-user",origin:"https://reader.example.test"};
  f.local.batchPlan={id:"p",device:"old-device",user:"old-user",source:{kind:"web"},items:[]};f.calls.length=0;
  assert.equal((await f.send({kind:"batch-capture",plan:"p",key:"item"},g.sender))?.error,"owner-changed");
  assert.equal(f.calls.includes("host"),false);assert.equal(f.calls.includes("capabilities"),false);
});
test("issuing tickets retains both live views but removes old-route/document grants and expires unclaimed tickets",async()=>{
  const f=fixture();await f.grant("import");await f.grant("library");
  f.session["surface:expired"]={...f.session["frame:import-doc"],expires:0};
  const retained=f.session["frame:import-doc"];retained.expires=0;
  const ticket=await f.send({kind:"frame-ticket",path:"/c/synthetic",view:"library"});
  assert.ok(ticket.ticket);assert.equal(f.session["surface:expired"],undefined);
  assert.equal(f.session["frame:import-doc"],retained,"claimed frames outlive the single-use admission TTL");
  assert.deepEqual(json(await f.send({kind:"frame-view",view:"library"},f.child())),{ok:true});
  f.pages.get(1).doc="replacement";
  const current={...f.top,documentId:"replacement"};
  assert.ok((await f.send({kind:"frame-ticket",path:"/c/synthetic",view:"import"},current)).ticket);
  assert.equal(f.session["frame:import-doc"],undefined);assert.equal(f.session["frame:library-doc"],undefined);
  assert.equal(f.session["surface:"+ticket.ticket],undefined);
  await f.removed(1);assert.equal(Object.keys(f.session).length,0);
});
test("a claimed document cannot consume a second grant to rebind its fixed content view",async()=>{
  const f=fixture(),g=await f.grant("library","shared-doc");
  const next=await f.send({kind:"frame-ticket",path:"/c/synthetic",view:"import"});
  assert.deepEqual(json(await f.send({kind:"frame-claim",ticket:next.ticket},g.sender)),{});
  assert.equal(f.session["frame:shared-doc"].view,"library");
  assert.equal((await f.send({kind:"frame-claim",ticket:next.ticket},f.child("separate-import"))).view,"import");
});
test("batch center rejects foreign/topology forgeries and lists only eligible ChatGPT tabs",async()=>{
  const f=fixture({batch:true});
  for(const patch of [{id:"b".repeat(32)},{tab:{id:1},frameId:3},{frameId:3},{documentLifecycle:"cached"},
    {url:base+"host.html"},{url:"https://chatgpt.com/center.html"}]){
    f.calls.length=0;const r=await f.send({kind:"batch-tabs"},{id,url:base+"center.html",...patch});
    assert.ok(!r?.tabs);assert.equal(f.calls.includes("query"),false);
  }
  const r=await f.send({kind:"batch-tabs"},{id,url:base+"center.html"});
  assert.deepEqual(json(r),{tabs:[{id:1,title:"ChatGPT"}]});
});
function planFor(f){
  const device={id:"current-device",user:"current-user",origin:"https://reader.example.test"};
  f.local.device=device;f.local.jobs=[];
  f.local.batchPlan={id:"plan",device:device.id,user:device.user,origin:device.origin,
    source:{kind:"web",scope:"scope",catalog:"catalogue"},attachments:true,
    items:[{key:"item",id:"chat",group:"unknown",title:"Synthetic",project:null}]};
  f.session["catalog:catalogue"]={tab:1,path:"/c/synthetic",scope:"scope",nonce:"nonce",rows:[{id:"chat",group:"unknown"}]};
}
test("an import-frame capture can start once without disclosing a ticket or private plan in its reply",async()=>{
  const f=fixture({batch:true}),g=await f.grant();planFor(f);
  assert.deepEqual(json(await f.send({kind:"batch-capture",plan:"plan",key:"item"},g.sender)),{ok:true});
  assert.equal(f.sent.filter(s=>s.message.kind==="reader-batch-capture").length,1);
  assert.equal(f.local.jobs.length,1);assert.equal(f.local.jobs[0].key,"item");
});
test("parent, account or fixed-plan changes during receipt lookup stop capture before host/admission",async()=>{
  for(const kind of ["parent","device","user","origin","plan","cancelled","project"]){
    const f=fixture({batch:true}),g=await f.grant(),entered=deferred(),release=deferred();planFor(f);
    f.beforeRequest(async url=>{if(url==="requests/item"){entered.resolve();await release.promise;}});
    const pending=f.send({kind:"batch-capture",plan:"plan",key:"item"},g.sender);await entered.promise;
    if(kind==="parent")f.pages.get(1).doc="replaced";
    else if(["device","user","origin"].includes(kind))
      f.local.device={...f.local.device,[kind==="device"?"id":kind]:"changed"};
    else{
      const next=structuredClone(f.local.batchPlan);
      if(kind==="plan")next.id="replacement";else next.items[0][kind]=kind==="cancelled"?true:"other-project";
      f.local.batchPlan=next;
    }
    release.resolve();const r=await pending;
    assert.ok(r.error,kind);assert.equal(f.calls.includes("host"),false,kind);
    assert.equal(f.sent.some(s=>s.message.kind==="reader-batch-capture"),false,kind);
    assert.equal(Object.keys(f.session).some(k=>k.startsWith("ticket:")),false,kind);
  }
});
test("a changed parent during catalogue persistence cannot receive the catalogue or leave a reusable record",async()=>{
  const f=fixture({batch:true}),g=await f.grant();
  f.afterSet(patch=>{if(Object.keys(patch).some(k=>k.startsWith("catalog:")))f.pages.get(1).doc="changed";});
  const r=await f.send({kind:"batch-discover",tab:1},g.sender);
  assert.ok(!r.catalog);assert.equal(Object.keys(f.session).some(k=>k.startsWith("catalog:")),false);
});
test("account changes during ticket persistence erase unused admission and never dispatch source capture",async()=>{
  const f=fixture({batch:true}),g=await f.grant();planFor(f);
  f.afterSet(patch=>{if(Object.keys(patch).some(k=>k.startsWith("ticket:")))f.local.device={...f.local.device,id:"changed"};});
  const r=await f.send({kind:"batch-capture",plan:"plan",key:"item"},g.sender);
  assert.equal(r.error,"owner-changed");assert.equal(Object.keys(f.session).some(k=>k.startsWith("ticket:")),false);
  assert.equal(f.sent.some(s=>s.message.kind==="reader-batch-capture"),false);assert.deepEqual(f.local.jobs,[]);
});
test("wake supports both granted frames and native/top center but never a source, ungranted child or replaced document",async()=>{
  const f=fixture({batch:true}),event={addListener(){}};
  Object.assign(f.c,{importScripts(){}});
  Object.assign(f.c.chrome.runtime,{onInstalled:event,onStartup:event,getContexts:async()=>{f.calls.push("host-context");return [{}];}});
  Object.assign(f.c.chrome,{alarms:{onAlarm:event},downloads:{onChanged:event}});
  f.c.chrome.storage.onChanged=event;
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../reader/background.js"),"utf8"),f.c);
  const library=await f.grant("library"),imported=await f.grant();
  for(const sender of [library.sender,imported.sender,{id,url:base+"center.html"},{id,frameId:0,url:base+"center.html?tab=1"}]){
    f.calls.length=0;assert.deepEqual(json(await f.send({kind:"wake"},sender)),{ok:true});assert.ok(f.calls.includes("host-context"));
  }
  for(const sender of [f.top,{...imported.sender,documentId:"unknown"},{id,frameId:2,tab:{id:1},url:base+"center.html"},{id:"foreign",url:base+"center.html"}]){
    f.calls.length=0;assert.deepEqual(json(await f.send({kind:"wake"},sender)),{});assert.equal(f.calls.includes("host-context"),false);
  }
  f.pages.get(1).doc="replacement";f.calls.length=0;
  assert.deepEqual(json(await f.send({kind:"wake"},imported.sender)),{});assert.equal(f.calls.includes("host-context"),false);
});
