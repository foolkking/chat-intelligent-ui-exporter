const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),root=path.resolve(__dirname,".."),tick=()=>new Promise(r=>setTimeout(r,0));
async function fixture({busy=()=>false,read=async()=>({rows:[],complete:true,loadBody:async()=>""}),capture=async()=>{}}={}){
  const dom=new JSDOM("<main></main>",{url:"https://chatgpt.com/c/synthetic-workspace",runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
  const shadows=[],attach=w.Element.prototype.attachShadow,observers=[],events=[],messages=[];
  w.Element.prototype.attachShadow=function(o){const r=attach.call(this,o);shadows.push(r);return r;};
  const MO=w.MutationObserver;w.MutationObserver=class extends MO{constructor(fn){super(fn);observers.push(this);}};
  w.chrome={runtime:{getURL:p=>"chrome-extension://synthetic/"+p,getManifest:()=>({version:"0.3.0"}),
    connect:()=>({onMessage:{addListener(){}},onDisconnect:{addListener(){}},disconnect(){}}),
    sendMessage:async m=>{messages.push(m);return m.kind==="frame-ticket"?{ticket:"a".repeat(36)}:m.kind==="source-state"?{state:"save"}:{view:"outline"};},
    onMessage:{addListener:fn=>events.push(fn)}}};
  for(const name of ["extension/source-dom.js",...["routes","glyphs","progress","progress-view","surface-state","page-index","outline-tree","overlay","source-control"].map(n=>"reader/"+n+".js")])
    w.eval(fs.readFileSync(path.join(root,name),"utf8"));
  w.ReaderPageIndex.layout=()=>({height:900,edge:820,top:0,compact:false});
  w.ReaderPageIndex.observeLayout=fn=>fn({height:900,edge:820,top:0,bottom:80,compact:false});
  w.ReaderOverlay({busy,read});
  let captures=0;
  w.ReaderSourceControl({pathId:()=>"synthetic-workspace",capture:async()=>{captures++;await capture();},cancel(){}});
  await tick();return {w,shadows,messages,events,captures:()=>captures,close(){observers.forEach(o=>o.disconnect());w.close();}};
}
test("one save control physically moves between folded strip and workspace without duplicating actions",async()=>{
  const f=await fixture();try{
    const [nav,save]=f.shadows;
    assert.equal(save.host.parentElement,f.w.document.body);assert.equal(nav.querySelector(".handle").hidden,true);
    const actualMain=save.querySelector(".main");
    save.querySelector(".open-workspace").onclick({isTrusted:true});await tick();
    assert.equal(nav.querySelector(".frame").hidden,false);
    assert.equal(save.host.parentElement,nav.querySelector(".save-slot"));
    assert.equal(save.querySelector(".main"),actualMain);assert.equal(save.querySelector(".open-workspace").hidden,true);
    assert.equal(save.host.hasAttribute("data-docked"),true);
    f.w.ReaderCloseOverlay();assert.equal(save.host.parentElement,f.w.document.body);
    assert.equal(save.querySelector(".main"),actualMain);assert.equal(save.host.hasAttribute("data-docked"),false);
    assert.equal(f.captures(),0,"Opening the workspace does not start a save");
  }finally{f.close();}
});
test("import and library frames survive view switches and collapse; route changes revoke their local presentation",async()=>{
  const f=await fixture();try{
    const [nav]=f.shadows;
    await f.w.ReaderOpenWorkspace("import");const imported=nav.querySelector('iframe[data-view="import"]');
    assert.ok(imported);await f.w.ReaderOpenLibrary();const library=nav.querySelector('iframe[data-view="library"]');
    assert.ok(library);assert.equal(imported.isConnected,true);assert.equal(imported.hidden,true);
    f.w.ReaderCloseOverlay();assert.equal(imported.isConnected,true);assert.equal(library.isConnected,true);
    await f.w.ReaderOpenWorkspace("import");assert.equal(nav.querySelector('iframe[data-view="import"]'),imported);
    assert.equal(imported.hidden,false);assert.equal(f.messages.filter(m=>m.kind==="frame-ticket").length,2);
    f.w.history.pushState({},"","/c/another-synthetic");
    f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));await tick();
    assert.equal(imported.isConnected,false);assert.equal(library.isConnected,false);
  }finally{f.close();}
});
test("opening navigation during capture does not start a duplicate whole-source read",async()=>{
  let reads=0;
  const f=await fixture({busy:()=>true,read:async()=>{reads++;return {rows:[],complete:true,loadBody:async()=>""};}});
  try{
    await f.w.ReaderOpenWorkspace("outline");
    assert.equal(reads,0);
    assert.equal(f.shadows[0].querySelector(".frame").hidden,false);
    assert.match(f.shadows[0].querySelector(".status").textContent,/save|保存/);
  }finally{f.close();}
});
test("starting the real save control stops background outline work but preserves the open workspace and task",async()=>{
  let controller,resolveRead,resolveSave,capturing=false;
  const f=await fixture({busy:()=>capturing,
    read:ctl=>{controller=ctl;return new Promise(resolve=>{resolveRead=resolve;});},
    capture:()=>{capturing=true;return new Promise(resolve=>{resolveSave=resolve;});}});
  try{
    const opened=f.w.ReaderOpenWorkspace("outline");await tick();
    const [nav,save]=f.shadows;
    save.querySelector(".main").onclick({isTrusted:true});await tick();
    assert.equal(controller.signal.aborted,true);
    assert.equal(nav.querySelector(".frame").hidden,false);
    assert.equal(save.host.parentElement,nav.querySelector(".save-slot"));
    assert.equal(f.captures(),1);
    assert.equal(save.querySelector(".main").disabled,true);
    resolveRead({rows:[],complete:true,loadBody:async()=>""});await opened;
    assert.match(nav.querySelector(".status").textContent,/save|保存/,"A late outline callback cannot erase the capture notice.");
    f.w.ReaderCloseOverlay();await f.w.ReaderOpenWorkspace("outline");
    assert.equal(f.captures(),1,"Disclosure never starts another save");
    resolveSave();await tick();
  }finally{resolveRead?.({rows:[],complete:true,loadBody:async()=>""});resolveSave?.();await tick();await tick();f.close();}
});
