const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {JSDOM}=require("jsdom"),script=n=>fs.readFileSync(path.join(__dirname,"../reader",n),"utf8");
const tick=()=>new Promise(r=>setTimeout(r,0));
function page(url="https://chatgpt.com/c/synthetic",html=""){
  const dom=new JSDOM(html,{url,pretendToBeVisual:true,runScripts:"outside-only"}),w=dom.window,roots=[],messages=[],observers=[],errors=[];
  const Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(fn){super(fn);observers.push(this);}};
  w.addEventListener("error",e=>errors.push(e.error?.message||e.message));
  const attach=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(o){const root=attach.call(this,o);roots.push(root);return root;};
  const listeners=[];let connections=0;
  w.chrome={runtime:{id:"synthetic-extension",sendMessage:async m=>{messages.push(m);return m.kind==="source-state"?{state:"save"}:m.kind==="surface-tab"?{view:"outline"}:{ok:true};},
    onMessage:{addListener:f=>listeners.push(f)},connect(){connections++;return {onMessage:{addListener(){}},onDisconnect:{addListener(){}},disconnect(){}};}}};
  w.ReaderVisible=m=>({body:m.body});w.FastTextExporter={};
  w.eval(fs.readFileSync(path.join(__dirname,"../extension/source-dom.js"),"utf8"));
  for(const n of ["routes.js","glyphs.js","progress.js","progress-view.js","page-index.js","outline-tree.js"])w.eval(script(n));
  w.ReaderPageIndex.observeLayout=()=>{};w.ReaderPageIndex.layout=()=>({height:900,edge:800,top:0,compact:false});
  return {w,roots,messages,listeners,connections:()=>connections,close:()=>{
    for(const observer of observers)observer.disconnect();w.close();assert.deepEqual(errors,[],"No runtime exceptions may be hidden by a passing assertion.");
  }};
}
const invoke=n=>n.onclick({isTrusted:true});
test("project homepage and project-chat hints are distinct from custom GPTs, shares and malformed paths",()=>{
  const p=page();try{
    const r=p.w.ReaderRoutes;
    assert.equal(r.projectHome("/g/g-p-alpha/project"),"g-p-alpha");
    assert.equal(r.projectHome("/g/g-p-alpha/"),"g-p-alpha");
    assert.equal(r.projectHome("/g/g-p-alpha/c/chat-one"),"");
    assert.equal(r.project("/g/g-p-alpha/c/chat-one"),"g-p-alpha");
    assert.equal(r.chat("/g/g-p-alpha/c/chat-one"),"chat-one");
    for(const value of ["/g/g-custom/c/chat-one","/share/chat-one","/g/g-p-alpha/c/","/g/g-p-alpha/c/a/extra","/g/g-p-alpha%2fc/chat-one"])
      assert.equal(r.project(value),"",value);
    assert.equal(r.eligible("/g/g-p-alpha/project"),true);assert.equal(r.eligible("/share/chat-one"),false);
  }finally{p.close();}
});
test("project homepage offers only Import to Reader and opens the center without discovery, session or Reader queries",async()=>{
  const p=page("https://chatgpt.com/g/g-p-alpha/project");try{
    let captures=0;p.w.eval(script("source-control.js"));
    p.w.ReaderSourceControl({pathId:()=>p.w.ReaderRoutes.chat(p.w.location.pathname),capture:()=>{captures++;},cancel(){}});
    const root=p.roots[0];await tick();
    assert.match(root.querySelector(".main").textContent,/Import to Reader/);
    assert.equal(root.querySelector(".toggle").hidden,true);
    assert.equal(p.messages.length,0);assert.equal(p.connections(),0);assert.equal(captures,0);
    invoke(root.querySelector(".main"));await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(p.messages)),[{kind:"open-center",path:"/g/g-p-alpha/project"}]);
    p.w.history.pushState({},"","/g/g-p-alpha/c/chat-one");p.w.dispatchEvent(new p.w.PopStateEvent("popstate"));await tick();
    assert.match(root.querySelector(".main").textContent,/Save to Reader/);assert.equal(root.querySelector(".toggle").hidden,false);
    assert.equal(p.connections(),1);assert.equal(captures,0);
    p.w.history.pushState({},"","/share/chat-one");p.w.dispatchEvent(new p.w.PopStateEvent("popstate"));
    assert.equal(root.host.isConnected,false);
  }finally{p.close();}
});
async function workspace(url,html,session={user:{id:"synthetic-user"},account:{id:"synthetic-workspace"}}){
  const p=page(url,html);let fetches=0;
  p.w.TextEncoder=TextEncoder;Object.defineProperty(p.w,"crypto",{value:require("node:crypto").webcrypto});
  p.w.fetch=async()=>{fetches++;return Response.json(session);};
  p.w.eval(script("workspace.js"));p.w.ReaderWorkspace({capture:()=>{throw Error("not authorized");},busy:()=>false});
  const discover=()=>new Promise(resolve=>p.listeners[0]({kind:"reader-batch-discover"},{id:p.w.chrome.runtime.id},resolve));
  return {...p,discover,fetches:()=>fetches};
}
test("project-chat discovery keeps a project hint and own membership, ignores body links and never upgrades partial scope",async()=>{
  const p=await workspace("https://chatgpt.com/g/g-p-alpha/c/own",`<title>Own chat - ChatGPT</title><nav>
    <a href="/g/g-p-alpha/project">Named project</a><a href="/c/own">Own generic link</a>
    <a href="/g/g-p-beta/c/other">Other conversation</a></nav><main><a href="/c/body-link">Not a directory entry</a></main>`);
  try{
    assert.equal(p.fetches(),0);
    const data=await p.discover();
    assert.equal(data.hint,"project:g-p-alpha");assert.equal(data.complete,false);assert.equal(data.rows.length,2);
    assert.equal(data.rows.find(r=>r.id==="own").group,"project:g-p-alpha");assert.equal(data.groups["project:g-p-alpha"],"Named project");
    assert.equal(data.groups["project:g-p-beta"],undefined,"A conversation title must not masquerade as the project label.");
    assert.match(data.scope,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(data),/synthetic-user|synthetic-workspace/);
  }finally{p.close();}
});
test("project-home visible directory discovery cannot resolve conflicting project claims or guess a missing workspace",async()=>{
  const p=await workspace("https://chatgpt.com/g/g-p-alpha/project",`<nav>
    <a href="/g/g-p-alpha/c/shared">First</a><a href="/g/g-p-beta/c/shared">Conflicting</a>
    <a href="/g/g-p-alpha/c/shared">Repeated first claim</a></nav><main>
    <a href="/g/g-p-alpha/c/visible">Visible directory row</a><div data-message-id="private-body"><a href="/c/quoted">Quoted link</a></div></main>`,{user:{id:"synthetic-user"}});
  try{
    const data=await p.discover();
    assert.equal(data.complete,false);assert.equal(data.scope,null);assert.equal(data.rows.length,2);
    assert.equal(data.rows.find(r=>r.id==="shared").group,"unknown");
    assert.equal(data.rows.find(r=>r.id==="visible").group,"project:g-p-alpha");
  }finally{p.close();}
});
test("a localized project-home slug names bare project chats by stable ID; conflicting or cross-site labels are not suggested",async()=>{
  const id="g-p-"+"0123456789abcdef".repeat(2);
  const p=await workspace("https://chatgpt.com/",`<nav><a href="/g/${id}-%E6%B5%B7%E6%B4%8B/project">海洋</a>
    <a href="/g/${id}/c/chat">A conversation, not a project title</a><a href="https://elsewhere.example/g/${id}/project">False</a></nav>`);
  try{
    const r=p.w.ReaderRoutes,data=await p.discover();assert.equal(data.groups["project:"+id],"海洋");
    assert.equal(data.rows[0].group,"project:"+id);
    for(const slug of ["%2Fprivate","%23","%00","bad%"])assert.equal(r.projectHome(`/g/${id}-${slug}/project`),"");
    const a=p.w.document.createElement("a");a.href=`/g/${id}/project`;a.textContent="Another name";p.w.document.querySelector("nav").append(a);
    assert.equal((await p.discover()).groups["project:"+id],null);
  }finally{p.close();}
});
test("source project entry opens the same workspace without a new tab and preserves live-document authorization",async()=>{
  const id="a".repeat(32),tab={id:7,url:"https://chatgpt.com/g/g-p-alpha/project",active:true},created=[],sent=[];
  const listeners=[],c=vm.createContext({URL,URLSearchParams,crypto:require("node:crypto").webcrypto,Date,
    ReaderClient:{trust:Promise.resolve()},source:s=>s.id===id&&s.frameId===0&&s.documentId==="original",
    chrome:{runtime:{id,getURL:n=>`chrome-extension://${id}/${n}`,onMessage:{addListener:f=>listeners.push(f)}},
      tabs:{get:async()=>tab,sendMessage:async(t,m,o)=>{sent.push({t,m,o});return {current:o.documentId==="original",ok:true};},create:async v=>{created.push(v);return v;},onRemoved:{addListener(){}}},
      action:{onClicked:{addListener(){}}}}});
  vm.runInContext(script("routes.js"),c);vm.runInContext(script("surfaces.js"),c);
  const sender={id,frameId:0,documentId:"original",url:tab.url,tab},send=s=>new Promise(r=>listeners[0]({kind:"open-center",path:"/g/g-p-alpha/project"},s,r));
  assert.equal((await send(sender)).ok,true);assert.equal(created.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))),{t:7,m:{kind:"reader-open-import"},o:{documentId:"original"}});
  const allowed=sent.length;await send({...sender,documentId:"replaced"});assert.equal(sent.length,allowed);assert.equal(created.length,0);
});
test("attachment navigation mounts a fixed page and reaches every file without accumulating earlier pages",async()=>{
  const p=page();try{
    const rows=Array.from({length:150},(_,i)=>({id:"m"+i,role:i%2?"assistant":"user",title:"Message "+i,headings:[],files:[{name:"asset-"+i+".pdf",id:"f"+i,type:"file"}]}));
    p.w.eval(script("overlay.js"));p.w.ReaderOverlay({busy:()=>false,read:async()=>({rows,complete:true,loadBody:async()=>"Question"})});
    const root=p.roots[0];invoke(root.querySelector(".handle"));await tick();await tick();invoke(root.querySelectorAll("nav button")[1]);
    const ids=()=>[...root.querySelectorAll(".result")].map(n=>n.dataset.mid),all=[...ids()];
    assert.equal(ids().length,64);
    invoke([...root.querySelectorAll(".list button")].find(n=>n.textContent==="Next files"));assert.equal(ids().length,64);all.push(...ids());
    invoke([...root.querySelectorAll(".list button")].find(n=>n.textContent==="Next files"));assert.equal(ids().length,22);all.push(...ids());
    assert.equal(new Set(all).size,150);assert.deepEqual(all,rows.map(r=>r.id));
    invoke([...root.querySelectorAll(".list button")].find(n=>n.textContent==="Previous files"));assert.equal(ids()[0],"m64");
    invoke(root.querySelectorAll("nav button")[0]);invoke(root.querySelectorAll("nav button")[1]);assert.equal(ids().length,64);assert.equal(ids()[0],"m64");
  }finally{p.close();}
});
test("full question preview is loaded only on demand, preserves >2 MiB exact text and releases it on blur",async()=>{
  const p=page();try{
    const full="提问 🪐\n"+"long line\n".repeat(230000)+"UNIQUE QUESTION TAIL",calls=[];
    const rows=[p.w.ReaderPageIndex.metadata({id:"q",role:"user",body:full,headings:[],files:[]})];
    assert.equal(Object.hasOwn(rows[0],"body"),false);assert.equal(rows[0].title.length,220);
    p.w.eval(script("overlay.js"));p.w.ReaderOverlay({busy:()=>false,read:async()=>({rows,complete:true,loadBody:async(id,signal)=>{calls.push({id,signal});return full;}})});
    const root=p.roots[0];invoke(root.querySelector(".handle"));await tick();await tick();
    assert.equal(calls.length,0);const entry=root.querySelector(".entry");entry.focus();await tick();
    assert.equal(calls.length,1);assert.equal(root.querySelector(".question-preview .body").textContent,full);
    root.querySelector(".question-preview .body").focus();assert.ok(root.querySelector(".question-preview"));
    const box=root.querySelector(".question-preview"),remove=box.remove.bind(box);let removals=0;
    box.remove=()=>{assert.equal(++removals,1,"Synchronous focusout must not remove the preview a second time.");
      box.querySelector(".body").dispatchEvent(new p.w.FocusEvent("focusout",{bubbles:true,relatedTarget:null}));remove();};
    root.querySelector(".question-preview .body").dispatchEvent(new p.w.KeyboardEvent("keydown",{key:"Escape",bubbles:true,composed:true}));
    assert.equal(root.activeElement,entry);assert.equal(root.querySelector(".question-preview"),null);assert.equal(calls.length,1);
    root.querySelector("header .icon").focus();entry.focus();await tick();assert.equal(calls.length,2);
    root.querySelector("header .icon").focus();assert.equal(root.querySelector(".question-preview"),null);
    assert.equal(calls[0].signal.aborted,true);assert.equal(entry.hasAttribute("aria-describedby"),false);
  }finally{p.close();}
});
test("late preview callbacks cannot recreate text after blur, list replacement or route change",async()=>{
  const p=page();try{
    let finish,signal;
    p.w.eval(script("overlay.js"));p.w.ReaderOverlay({busy:()=>false,read:async()=>({rows:[{id:"q",role:"user",title:"Short metadata",headings:[],files:[]}],complete:true,
      loadBody:(_id,s)=>{signal=s;return new Promise(r=>{finish=r;});}})});
    const root=p.roots[0];invoke(root.querySelector(".handle"));await tick();await tick();root.querySelector(".entry").focus();
    invoke(root.querySelectorAll("nav button")[1]);assert.equal(signal.aborted,true);
    finish("late private question");await tick();assert.equal(root.querySelector(".question-preview"),null);assert.doesNotMatch(root.textContent,/late private question/);
    p.w.history.pushState({},"","/share/no-overlay");p.w.dispatchEvent(new p.w.PopStateEvent("popstate"));assert.equal(root.host.isConnected,false);
  }finally{p.close();}
});
