const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),root=path.resolve(__dirname,".."),tick=()=>new Promise(r=>setTimeout(r,0));
async function fixture({busy=()=>false,read=async()=>({rows:[],complete:true,loadBody:async()=>""}),capture=async()=>{},position,pagePath="/c/synthetic-workspace"}={}){
  const dom=new JSDOM("<main></main>",{url:"https://chatgpt.com"+pagePath,runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
  const shadows=[],attach=w.Element.prototype.attachShadow,observers=[],events=[],messages=[];
  w.Element.prototype.attachShadow=function(o){const r=attach.call(this,o);shadows.push(r);return r;};
  const MO=w.MutationObserver;w.MutationObserver=class extends MO{constructor(fn){super(fn);observers.push(this);}};
  w.chrome={runtime:{getURL:p=>"chrome-extension://synthetic/"+p,getManifest:()=>({version:"0.3.0"}),
    connect:()=>({onMessage:{addListener(){}},onDisconnect:{addListener(){}},disconnect(){}}),
    sendMessage:async m=>{messages.push(m);if(m.kind==="launcher-position")return {position:await position};
      return m.kind==="frame-ticket"?{ticket:"a".repeat(36)}:m.kind==="source-state"?{state:"save"}:{view:"outline"};},
    onMessage:{addListener:fn=>events.push(fn)}}};
  for(const name of ["extension/source-dom.js",...["routes","glyphs","progress","progress-view","surface-state","page-index","outline-tree","launcher","overlay","source-control"].map(n=>"reader/"+n+".js")])
    w.eval(fs.readFileSync(path.join(root,name),"utf8"));
  w.ReaderPageIndex.layout=()=>({height:900,edge:820,top:0,compact:false});
  w.ReaderPageIndex.observeLayout=fn=>fn({height:900,edge:820,top:0,bottom:80,compact:false});
  w.ReaderOverlay({busy,read});
  let captures=0;
  w.ReaderSourceControl({pathId:()=>w.ReaderRoutes.chat(w.location.pathname),capture:async()=>{captures++;await capture();},cancel(){}});
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

function launcherFixture(f,button,box,width=180){
  const rect=()=>({left:parseFloat(box.style.getPropertyValue("--launcher-x"))||40,top:parseFloat(box.style.getPropertyValue("--launcher-y"))||80,width,height:44});
  box.getBoundingClientRect=rect;
  button.setPointerCapture=()=>{};button.hasPointerCapture=()=>true;button.releasePointerCapture=()=>{};
  const fire=(type,x,y,extra={})=>button["on"+type]({isTrusted:true,isPrimary:true,button:0,pointerId:9,detail:1,
    clientX:x,clientY:y,preventDefault(){},stopPropagation(){},...extra});
  return {rect,fire,writes:()=>f.messages.filter(m=>m.kind==="launcher-position"&&m.position)};
}
test("dragging the folded hamburger moves the single save strip without activating it; click and keyboard still open it",async()=>{
  const f=await fixture();try{
    const [nav,save]=f.shadows,key=save.querySelector(".open-workspace"),area=launcherFixture(f,key,save.host);
    area.fire("pointerdown",42,83);area.fire("pointermove",182,143);area.fire("pointerup",182,143);area.fire("click",182,143);
    await tick();assert.deepEqual(area.rect(),{left:180,top:140,width:180,height:44});
    assert.equal(area.writes().length,1);assert.ok(nav.querySelector(".frame").hidden);assert.equal(f.captures(),0);
    area.fire("pointerdown",185,143);area.fire("pointerup",187,144);area.fire("click",187,144);await tick();
    assert.ok(save.host.hasAttribute("data-docked"));f.w.ReaderCloseOverlay();
    assert.equal(area.rect().left,180);
    area.fire("keydown",0,0,{key:"ArrowLeft"});await tick();assert.ok(area.rect().left<180);
    area.fire("click",0,0,{detail:0});await tick();assert.ok(save.host.hasAttribute("data-docked"));assert.equal(f.captures(),0);
  }finally{f.close();}
});

test("cancelled drag and lost capture restore the prior position; delayed restore cannot overwrite a committed drag",async()=>{
  let resolve;const restore=new Promise(r=>{resolve=r;});
  const f=await fixture({position:restore});try{
    const [,save]=f.shadows,key=save.querySelector(".open-workspace"),area=launcherFixture(f,key,save.host);
    for(const kind of ["pointercancel","lostpointercapture"]){
      area.fire("pointerdown",42,82);area.fire("pointermove",90,110);area.fire(kind,90,110);
      assert.equal(area.rect().left,40);assert.equal(area.writes().length,0);
    }
    area.fire("pointerdown",42,82);area.fire("pointermove",9000,-1000);area.fire("pointerup",9000,-1000);
    resolve({x:0.4,y:0.7});await tick();
    assert.ok(area.rect().left+180<=f.w.innerWidth);assert.ok(area.rect().left>f.w.innerWidth/2);assert.ok(area.rect().top>=0);
    assert.equal(area.writes().length,1);
  }finally{resolve(null);f.close();}
});

test("the home-page handle restores the same preference and stays in the visual viewport after resize",async()=>{
  const f=await fixture({pagePath:"/",position:{x:1,y:1}});try{
    const [nav]=f.shadows,handle=nav.querySelector(".handle"),area=launcherFixture(f,handle,handle,44);
    Object.defineProperty(f.w,"visualViewport",{value:{offsetLeft:70,offsetTop:85,width:320,height:260}});
    f.w.dispatchEvent(new f.w.Event("resize"));
    assert.equal(handle.hidden,false);assert.deepEqual(area.rect(),{left:338,top:293,width:44,height:44});
    area.fire("pointerdown",340,295,{isTrusted:false});area.fire("pointermove",180,150);area.fire("pointerup",180,150);
    area.fire("pointerdown",340,295,{button:2});area.fire("pointermove",180,150);area.fire("pointerup",180,150);
    assert.equal(area.writes().length,0);
    area.fire("pointerdown",340,295);area.fire("pointerup",150,135);area.fire("click",150,135);await tick();
    assert.equal(nav.querySelector(".frame").hidden,true);assert.equal(area.writes().length,1);
    area.fire("click",0,0,{detail:0});await tick();assert.equal(nav.querySelector(".frame").hidden,false);
  }finally{f.close();}
});

test("a route change or docking during a drag never persists an abandoned position",async()=>{
  for(const action of ["route","dock"]){
    const f=await fixture();try{
      const [,save]=f.shadows,key=save.querySelector(".open-workspace"),area=launcherFixture(f,key,save.host);
      area.fire("pointerdown",42,83);area.fire("pointermove",140,220);
      if(action==="route"){
        f.w.history.pushState({},"","/c/next-synthetic");f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
      }else await f.w.ReaderOpenWorkspace("outline");
      area.fire("pointerup",180,230);await tick();
      assert.equal(area.writes().length,0);
      if(action==="dock")f.w.ReaderCloseOverlay();
      assert.equal(save.host.hasAttribute("data-launcher-position"),false);
    }finally{f.close();}
  }
});

test("a confirmed mounted entry can preempt indexing and late results cannot replace its partial outline",async()=>{
  let resolve,signal,reads=0;
  const f=await fixture({read:ctl=>{reads++;signal=ctl.signal;return new Promise(done=>{resolve=done;});}});try{
    const nav=f.shadows[0],index=f.w.ReaderPageIndex,jumped=[];
    index.domRows=()=>[{id:"mounted",role:"user",body:"Mounted question",headings:[],files:[]}];
    index.jump=async(_rows,target)=>{jumped.push(target.id);return {ok:true,kind:"message"};};
    const pending=f.w.ReaderOpenWorkspace("outline");await tick();
    await f.w.ReaderOpenWorkspace("outline");assert.equal(reads,1);
    const entry=nav.querySelector(".outline-node");entry.onclick({isTrusted:true,target:entry,stopPropagation(){}});await tick();
    assert.equal(signal.aborted,true);assert.deepEqual(jumped,["mounted"]);
    resolve({rows:[{id:"late",role:"user",title:"Late replacement",headings:[],files:[]}],complete:true,loadBody:async()=>""});await pending;
    assert.match(nav.querySelector(".list").textContent,/Mounted question/);assert.doesNotMatch(nav.querySelector(".list").textContent,/Late replacement/);
    assert.match(nav.querySelector(".status").textContent,/Partial outline/);
  }finally{resolve?.({rows:[],complete:true,loadBody:async()=>""});f.close();}
});

test("failure during mounted outline setup relinquishes Stop and a successful reload clears the error",async()=>{
  const f=await fixture();try{
    const nav=f.shadows[0],index=f.w.ReaderPageIndex;index.domRows=()=>{throw Error("synthetic unavailable");};
    await f.w.ReaderOpenWorkspace("outline");const [stop,retry]=nav.querySelectorAll(".feedback button");
    assert.equal(stop.hidden,true);assert.equal(retry.hidden,false);assert.match(nav.querySelector(".status").textContent,/Retry/);
    index.domRows=()=>[];retry.onclick({isTrusted:true});await tick();
    assert.equal(nav.querySelector(".status").textContent,"");assert.equal(retry.hidden,true);
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
