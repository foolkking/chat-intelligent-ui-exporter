// Synthetic evidence. User-run E1–E4 remain a separate acceptance gate.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),repo=path.resolve(__dirname,"..");
function fixture(html,url="https://chatgpt.com/g/g-p-alpha/project"){
  const dom=new JSDOM(html,{url,runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
  w.Element.prototype.getClientRects=function(){return this.isConnected?[{top:40,bottom:80,left:0,right:400,width:400,height:40}]:[];};
  for(const file of ["reader/routes.js","extension/source-dom.js","reader/page-index.js"])w.eval(fs.readFileSync(path.join(repo,file),"utf8"));
  return {w,close:()=>w.close()};
}
test("project names outside nav/aside, labelled buttons and the project home title have explicit evidence",()=>{
  const f=fixture(`<div role="navigation"><a href="/g/g-p-beta/project" aria-labelledby="pname"><svg></svg></a><span id="pname">Beta study</span>
    <button data-project-id="g-p-gamma" data-project-name="Gamma study"></button></div><main><h1>Alpha study</h1>
    <div data-response-body><a href="/g/g-p-forged/project">Forged body link</a></div></main>`);
  try{
    const c=f.w.ReaderRoutes.projectCatalogue(f.w.document,f.w.location.pathname);
    assert.equal(c.groups["project:g-p-alpha"],"Alpha study");
    assert.equal(c.groups["project:g-p-beta"],"Beta study");
    assert.equal(c.groups["project:g-p-gamma"],"Gamma study");
    assert.equal(c.groups["project:g-p-forged"],undefined);
    assert.equal(c.complete,false);assert.equal(c.evidence["project:g-p-alpha"].source,"project-heading");
  }finally{f.close();}
});
test("verified project-name cache isolates owners, preserves conflicts and replaces names on a later rename",()=>{
  const f=fixture("");try{
    const cache=f.w.ReaderRoutes.projectNameCache();
    const value=name=>({groups:{"project:g-p-alpha":name},evidence:{"project:g-p-alpha":{source:"project-link",confidence:"explicit"}}});
    assert.equal(cache.merge("a",value("Old"),10).groups["project:g-p-alpha"],"Old");
    assert.equal(cache.merge("a",value("New"),11).groups["project:g-p-alpha"],"New");
    assert.equal(cache.merge("a",value(null),12).groups["project:g-p-alpha"],null);
    assert.equal(cache.merge("b",{groups:{},evidence:{}},13).groups["project:g-p-alpha"],undefined);
    assert.equal(cache.merge(null,value("Unverified"),14).groups["project:g-p-alpha"],"Unverified");
    assert.equal(cache.merge("a",{groups:{},evidence:{}},15).groups["project:g-p-alpha"],undefined);
  }finally{f.close();}
});
test("only the active conversation timeline supplies identities; native turn keys are not message IDs",()=>{
  const f=fixture(`<div data-app-action-timeline-scroll role="presentation"><div data-message-id="stale" data-message-author-role="user">Old</div></div>
    <div data-app-action-timeline-scroll role="region"><div data-thread-find-target="conversation" data-chatgpt-conversation-selection-target="current">
    <div data-turn-key="native-turn"><div data-chatgpt-search-unit-key="fallback:0:user" data-chatgpt-search-message-ids="q">
    <div data-user-message-bubble="true">Question</div></div><div data-content-search-unit-key="fallback:1:assistant" data-chatgpt-search-message-ids="a"><div data-response-body>Answer</div></div>
    </div></div></div>`,"https://chatgpt.com/c/current");
  try{
    const s=f.w.ChatExportSourceDOM;
    s.remember({id:"q",role:"user"});s.remember({id:"a",role:"assistant"});
    assert.equal(s.verify({ids:new Set(["q","a"])}),true);
    assert.deepEqual(Array.from(s.mounted(),s.idOf),["q","a"]);
    assert.deepEqual(Array.from(s.identities()),["q","a"]);
    assert.equal(s.timeline().getAttribute("role"),"region");
  }finally{f.close();}
});
test("chapter targets carry semantic ancestry and occurrence, not only a mutable ordinal",()=>{
  const f=fixture("");try{
    const sections=f.w.ReaderPageIndex.sections({id:"a",headings:[{text:"Alpha",level:2},{text:"Result",level:3},{text:"Beta",level:2},{text:"Result",level:3}]});
    assert.equal(sections[3].target.chapter.text,"Result");
    assert.equal(sections[3].target.chapter.occurrence,1);
    assert.deepEqual(Array.from(sections[3].target.chapter.parents),["Beta"]);
  }finally{f.close();}
});
test("names only supplement a proven identity; missing, conflict, newer revisions, TTL and isolation remain distinct",()=>{
  const f=fixture("");try{
    const rr=f.w.ReaderRoutes,key="project:g-p-delta",cache=rr.projectNameCache();
    const claim=(name,source="project-link",at)=>({groups:name===undefined?{}:{[key]:name},evidence:{[key]:{source,at}}});
    cache.merge("one",claim("Old"),10);
    assert.equal(cache.merge("one",claim(undefined,"missing"),12).evidence[key].source,"workspace-cache");
    cache.merge("one",claim("New"),16);
    assert.equal(cache.merge("one",claim("Old","project-document",12),17).groups[key],"New");
    assert.equal(cache.merge("two",claim(undefined,"missing"),18).groups[key],undefined);
    assert.equal(cache.merge("one",claim(null,"conflict"),20).groups[key],null);
    assert.equal(cache.merge("one",claim(undefined,"missing"),21).groups[key],null);
    assert.equal(cache.merge("one",claim(undefined,"missing"),21+13*3600*1000).groups[key],undefined);
  }finally{f.close();}
});
test("missing project name hydrates from one proved project page, not a chat title; account changes invalidate the reply",async()=>{
  const f=fixture('<nav><a href="/g/g-p-delta/c/example">A chat, not its project</a></nav>',"https://chatgpt.com/");
  try{
    const {w}=f,seen=[],listeners=[];
    Object.defineProperty(w,"crypto",{value:require("node:crypto").webcrypto});w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
    w.chrome={runtime:{id:"ext",onMessage:{addListener:fn=>listeners.push(fn)}}};
    let owner="one",change=false;
    w.fetch=async(url,options)=>{
      if(url==="/api/auth/session")return Response.json({user:{id:owner},account:{id:"workspace"}});
      seen.push(url);assert.equal(options.redirect,"error");assert.equal(options.credentials,"same-origin");
      const r=new Response('<link rel=canonical href="/g/g-p-delta/project"><main><h1>Delta study</h1></main>',{headers:{"Content-Type":"text/html"}});
      Object.defineProperty(r,"url",{value:url.href});if(change)owner="two";return r;
    };
    w.eval(fs.readFileSync(path.join(repo,"reader/workspace.js"),"utf8"));w.ReaderWorkspace({busy:()=>false});
    const send=m=>new Promise(ok=>listeners[0](m,{id:"ext"},ok)),read=()=>send({kind:"reader-batch-discover"});
    const d=await read(),key="project:g-p-delta",probe=(source,group)=>send({kind:"reader-batch-names",scope:source.scope,nonce:source.nonce,path:source.path,
      revision:source.namesRevision,missing:group,recheck:true});
    assert.equal(d.groups[key],undefined);assert.equal(seen.length,0);
    await probe(d,"project:g-p-foreign");assert.equal(seen.length,0);
    const result=await probe(d,key);assert.equal(result.groups[key],"Delta study");assert.equal(result.evidence[key].source,"project-document");
    await probe(d,key);assert.equal(seen.length,1,"no continuous project-page fetch");
    w.document.querySelector("nav").insertAdjacentHTML("beforeend",'<a href="/g/g-p-delta/project">Name after mount</a>');
    assert.equal((await probe(d,key)).groups[key],"Name after mount");
    w.document.querySelector("nav").lastChild.remove();change=true;
    assert.equal((await probe(d,key)).error,"source-changed");assert.equal(seen.length,2);
  }finally{f.close();}
});
test("native scroll capability is scoped, cancellable, and corroborated by a mounted native key distinct from the message ID",async()=>{
  const f=fixture('<main data-app-action-timeline-scroll role="region"><div data-chatgpt-conversation-selection-target="current"><article data-turn-key="entry:one"><p data-message-id="q">Q</p></article></div></main>',"https://chatgpt.com/c/current");
  try{
    const {w}=f,doc=w.document,scope=doc.querySelector("[data-chatgpt-conversation-selection-target]"),row=scope.firstElementChild,q=row.firstElementChild;
    const entries=[{turnKey:"entry:one",turn:{messageIds:["q"]}},{turnKey:"entry:two",turn:{messageIds:["answer"]}}];
    let requested=0,pause=false,wrong=false,signalSeen;
    const api={getRowElement:k=>[...scope.children].find(n=>n.getAttribute("data-turn-key")===k),
      scrollToKey(key,pick,options){
        requested++;signalSeen=options.signal;assert.equal(key,"entry:two");
        if(pause)return new Promise(resolve=>options.signal.addEventListener("abort",resolve,{once:true}));
        const answer=doc.createElement("article");answer.setAttribute("data-turn-key",wrong?"impostor":key);
        answer.innerHTML='<p data-chatgpt-search-message-ids="answer">A</p>';scope.append(answer);assert.equal(pick(answer),answer.firstElementChild);
      }};
    const props={conversationId:"current",entries,turnListApi:api};q.__reactFiber$synthetic={memoizedProps:props};
    for(const name of ["native-scroll-main","native-scroll"])w.eval(fs.readFileSync(path.join(repo,"reader/"+name+".js"),"utf8"));
    const run=(trial=false,ctl=new w.AbortController())=>w.ReaderNativeScroll.prepare("answer",ctl.signal,{trial});
    assert.equal(await run(),"unverified");assert.equal(requested,0);
    props.conversationId="different";assert.equal(await run(true),"unsupported");props.conversationId="current";
    entries.push(entries[1]);assert.equal(await run(true),"ambiguous");entries.pop();
    assert.equal(await run(true),"requested");assert.equal(requested,1);scope.lastChild.remove();
    assert.equal(await run(),"requested");assert.equal(requested,2);scope.lastChild.remove();
    pause=true;const ctl=new w.AbortController(),task=run(false,ctl);ctl.abort();assert.equal(await task,"cancelled");assert.equal(signalSeen.aborted,true);
    pause=false;wrong=true;const bad=run();assert.equal(await bad,"not-loaded");
    props.turnListApi=null;props.ref={current:{scrollToMessage:()=>assert.fail("not cancellable")}};
    assert.equal(await run(true),"uncancellable");
  }finally{f.close();}
});
test("native URL trial keeps the project path, other parameters, fragment and original tab; reports no raw identifier",async()=>{
  const f=fixture("", "https://chatgpt.com/g/g-p-delta/c/current?mode=study#keep");
  try{
    const {w}=f;w.TextEncoder=TextEncoder;Object.defineProperty(w,"crypto",{value:require("node:crypto").webcrypto});
    const state={complete:true,branch:"original-branch",rows:[{id:"answer-at-end",role:"assistant"}]};
    w.ReaderNavigationDiagnostics={model:()=>state};w.eval(fs.readFileSync(path.join(repo,"reader/site-diagnostics.js"),"utf8"));
    const original=w.location.href;let opened;w.open=(...args)=>{opened=args;};
    const ticket=await w.ReaderSiteCheck.route(1);
    assert.deepEqual(opened,["https://chatgpt.com/g/g-p-delta/c/current?mode=study&message=answer-at-end#keep","_blank","noopener,noreferrer"]);
    assert.equal(w.location.href,original);assert.doesNotMatch(JSON.stringify(ticket),/original-branch|current|answer-at-end|chatgpt/);
    w.history.replaceState(null,"",opened[0]);state.branch="edited";
    const result=await w.ReaderSiteCheck.routeResult(ticket);
    assert.equal(result.sameTarget,true);assert.equal(result.sameBranch,false);assert.equal(result.stable,false);
    assert.doesNotMatch(JSON.stringify(result),/original-branch|answer-at-end|chatgpt/);
    state.branch="original-branch";w.history.replaceState(null,"",original);
    w.setTimeout=cb=>{cb();return 1;};const node=w.document.body;
    w.ReaderPageIndex.inspectLanding=()=>({node,visibleStart:true,top:500,error:0});
    const canonicalized=await w.ReaderSiteCheck.routeResult(ticket);
    assert.equal(canonicalized.queryRetained,false);assert.equal(canonicalized.sameBranch,true);assert.equal(canonicalized.stable,true);
    let samples=0;
    w.ReaderPageIndex.inspectLanding=()=>++samples===9?null:{node,visibleStart:true,top:500,error:0};
    const late=await w.ReaderSiteCheck.routeResult(ticket);
    assert.equal(late.stable,false,"a body withdrawn during the last wait is not a stable native URL landing");
    assert.equal(late.rendered,false);
    w.ReaderPageIndex.inspectLanding=()=>null;
    assert.equal((await w.ReaderSiteCheck.routeResult(ticket)).stable,false,"matching model without a rendered destination is not a landing");
  }finally{f.close();}
});
test("project row selects its primary label, and raw UUID controls only match an independently discovered route",()=>{
  const key="ab".repeat(16),other="cd".repeat(16),f=fixture(`<nav><a href="/g/g-p-${key}/project"><span class=truncate>Actual project</span>
    <button aria-label="Menu">Options</button></a><button data-project-id="${key}" data-project-name="Actual project"></button>
    <button data-project-id="${other}" data-project-name="Unbound"></button></nav>`);
  try{
    const c=f.w.ReaderRoutes.projectCatalogue(f.w.document,f.w.location.pathname);
    assert.equal(c.groups["project:g-p-"+key],"Actual project");assert.equal(c.groups["project:g-p-"+other],undefined);
  }finally{f.close();}
});
test("a route-bound project metadata pair can name a collapsed directory; generic or foreign metadata cannot",()=>{
  const f=fixture('<head><link rel=canonical href="/g/g-p-alpha/project"><meta property="og:title" content="Reading lab"><title>Reading lab - ChatGPT</title></head>');
  try{
    const d=f.w.document,get=()=>f.w.ReaderRoutes.projectCatalogue(d,f.w.location.pathname).groups["project:g-p-alpha"];
    assert.equal(get(),"Reading lab");d.querySelector("link").href="/g/g-p-other/project";assert.equal(get(),undefined);
    d.querySelector("link").href="/g/g-p-alpha/project";d.title="A selected conversation";assert.equal(get(),undefined);
    d.title=d.querySelector("meta").content="ChatGPT";assert.equal(get(),undefined);
  }finally{f.close();}
});
test("optional native geometry gets one write only after its origin agrees with a connected identified row",async()=>{
  for(const mismatch of [false,true]){
    const f=fixture('<div data-app-action-timeline-scroll role=region style="overflow-y:auto"><main data-chatgpt-conversation-selection-target=current><article data-turn-key=k1><p data-message-id=m1>One</p></article></main></div>',"https://chatgpt.com/c/current");
    try{
      const w=f.w,region=w.document.querySelector("[role=region]"),scope=region.firstChild,first=scope.firstChild,p=first.firstChild;
      Object.defineProperties(region,{clientHeight:{value:400},scrollHeight:{value:5000}});
      let writes=0;const ctl=new w.AbortController();
      region.scrollTo=({top})=>{writes++;assert.equal(top,2100);scope.insertAdjacentHTML("beforeend",'<article data-turn-key=k2><p data-message-id=m2>Two</p></article>');};
      const api={scrollToKey:()=>{},getRowElement:k=>scope.querySelector(`[data-turn-key="${k}"]`),
        getEntryGeometry:k=>({startPx:k==="k2"?2100:mismatch?430:0})};
      p.__reactFiber$test={memoizedProps:{conversationId:"current",entries:[{turnKey:"k1",turn:{messageIds:["m1"]}},{turnKey:"k2",turn:{messageIds:["m2"]}}],turnListApi:api}};
      for(const name of ["native-scroll-main","native-scroll"])w.eval(fs.readFileSync(path.join(repo,"reader/"+name+".js"),"utf8"));
      const pending=w.ReaderNativeScroll.prepare("m2",ctl.signal,{trial:true});
      if(mismatch){await new Promise(resolve=>setTimeout(resolve,12));ctl.abort();}
      assert.equal(await pending,mismatch?"cancelled":"requested");assert.equal(writes,mismatch?0:1);
    }finally{f.close();}
  }
});
