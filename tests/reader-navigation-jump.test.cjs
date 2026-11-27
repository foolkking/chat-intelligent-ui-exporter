// Real adapter/index code with synthetic geometry and a deterministic frame
// clock. No browser, source service, user session or transcript is accessed.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),repo=path.resolve(__dirname,"..");
function fixture(){
  const dom=new JSDOM("<main></main>",{url:"https://chatgpt.com/c/synthetic-jump",runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window,doc=w.document,scrolls=[],hooks=new Map(),listeners=new Map();let clock=0,frame=0;
  Object.defineProperty(w.performance,"now",{value:()=>clock});
  const timers=new Map(),frames=new Set();let handle=0;
  w.setTimeout=(fn,ms)=>{const id=++handle;timers.set(id,{at:clock+ms,fn});return id;};
  w.clearTimeout=id=>timers.delete(id);
  w.requestAnimationFrame=fn=>{
    const id=++handle;frames.add(id);
    queueMicrotask(()=>{
      if(!frames.delete(id))return;
      clock+=64;frame++;hooks.get(frame)?.();
      for(const [key,timer] of timers)if(timer.at<=clock){timers.delete(key);timer.fn();}
      fn(clock);
    });
    return id;
  };
  w.cancelAnimationFrame=id=>frames.delete(id);
  Object.defineProperty(w,"innerHeight",{value:800,configurable:true});
  Object.defineProperty(doc,"scrollingElement",{value:doc.documentElement});
  const add=doc.addEventListener.bind(doc),remove=doc.removeEventListener.bind(doc);
  doc.addEventListener=(name,fn,options)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);add(name,fn,options);};
  doc.removeEventListener=(name,fn,options)=>{listeners.get(name)?.delete(fn);remove(name,fn,options);};
  const box=(top,height=80,left=0,width=500)=>({x:left,y:top,top,bottom:top+height,left,right:left+width,width,height});
  const roots=new WeakMap();
  w.Element.prototype.getBoundingClientRect=function(){
    if(!this.isConnected||this.closest("[hidden],[data-zero]"))return box(0,0,0,0);
    if(roots.has(this)){
      const v=roots.get(this),parent=this.parentElement?.closest("[data-scroll]");
      return box(v.top+(parent?parent.getBoundingClientRect().top-parent.scrollTop:0),v.height);
    }
    const msg=this.closest("[data-message-id],[data-chatgpt-search-message-ids]"),root=this.closest("[data-scroll]");
    const base=root?.getBoundingClientRect().top||0,offset=root?.scrollTop||0;
    return box(base+Number(msg?.dataset.y||0)+Number(this===msg?0:this.dataset.offset||0)-offset,Number(this.dataset.height||80));
  };
  w.Element.prototype.getClientRects=function(){const r=this.getBoundingClientRect();return r.width&&r.height?[r]:[];};
  w.Range.prototype.getClientRects=function(){return this.startContainer.parentElement.getClientRects();};
  w.Range.prototype.getBoundingClientRect=function(){return this.startContainer.parentElement.getBoundingClientRect();};
  function root({top=0,height=700,size=10000,reverse=false}={}){
    const el=doc.createElement("section"),state={top,height,size};el.dataset.scroll="";el.style.overflowY="auto";
    Object.defineProperties(el,{scrollHeight:{get:()=>state.size},clientHeight:{get:()=>state.height}});
    if(reverse){el.style.display="flex";el.style.flexDirection="column-reverse";}
    el.scrollTo=({top})=>{scrolls.push({root:el,top,frame});const max=state.size-state.height;
      el.scrollTop=reverse?Math.max(-max,Math.min(0,top)):Math.max(0,Math.min(max,top));el.onMove?.();};
    roots.set(el,state);doc.querySelector("main").append(el);return el;
  }
  function message(root,id="a",y=0,html="<p>Answer</p>",role="assistant"){
    const el=doc.createElement("article");el.dataset.messageId=id;el.dataset.messageAuthorRole=role;el.dataset.y=y;
    el.innerHTML=html;root.append(el);return el;
  }
  for(const file of ["extension/source-dom.js","reader/page-index.js"])w.eval(fs.readFileSync(path.join(repo,file),"utf8"));
  const index=w.ReaderPageIndex,source=w.ChatExportSourceDOM;
  const rows=(ids=["a"])=>ids.map(id=>({id,role:"assistant",headings:[],files:[],body:"Answer"}));
  function verify(data){data.forEach(row=>source.remember(row));assert.equal(source.verify({ids:new Set(data.map(r=>r.id))}),true);}
  return {w,doc,index,source,root,message,rows,verify,scrolls,hooks,get frame(){return frame;},get clock(){return clock;},
    input(type,target=doc.body,key,options={}){for(const fn of listeners.get(type)||[])fn({isTrusted:true,type,target,key,composedPath:()=>[target,doc,w],...options});},
    listenerCount:type=>listeners.get(type)?.size||0,close:()=>w.close()};
}
async function locate(f,rows,target={id:"a"},ctl=new AbortController()){
  return f.index.jump(rows,target,ctl.signal);
}
test("combine source chapters with unique mounted structured titles and keep API-only chapters",()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.message(root,"a",0,'<h2>First</h2><div data-heading-level="3">DOM only</div><p><b>Not a title</b></p><h2>Last</h2>');
    const rows=f.rows();rows[0].headings=[{text:"First",level:2},{text:"Source only",level:3},{text:"Last",level:2}];f.verify(rows);
    const merged=f.index.mergeMounted(rows);
    assert.deepEqual(Array.from(merged[0].headings,h=>h.text),["First","Source only","DOM only","Last"]);
    assert.equal(merged[0].sections[2].parent,0);assert.equal(f.index.destination(msg,merged[0],{heading:2}).node,msg.querySelector("[data-heading-level]"));
    f.message(root,"a",100,'<h2>Wrong sibling copy</h2>');assert.equal(f.index.mergeMounted(rows),rows);
  }finally{f.close();}
});
test("non-heading rendering lands on a corroborated unique chapter block, never prose, code, or a duplicate",async()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.message(root,"a",600,'<p>Lead</p><p data-offset="370"><b>Section two</b></p><p>Detail</p>');
    const rows=f.rows();Object.assign(rows[0],{body:"Lead\n\n### Section two\n\nDetail",headings:[{level:3,text:"Section two"}]});f.verify(rows);
    assert.equal((await locate(f,rows,{id:"a",heading:0})).kind,"heading-text");
    const p=msg.children[1];p.insertAdjacentHTML("afterend","<p>Section two</p>");assert.equal(f.index.destination(msg,rows[0],{heading:0}),null);
    p.nextElementSibling.remove();p.innerHTML="<code>Section two</code>";assert.equal(f.index.destination(msg,rows[0],{heading:0}),null);
    p.textContent="Discuss Section two elsewhere";assert.equal(f.index.destination(msg,rows[0],{heading:0}),null);
  }finally{f.close();}
});
test("far history can pass 12 seconds only with advancing identified windows; a stationary boundary is not repeatedly probed",async()=>{
  const f=fixture();try{
    const root=f.root({size:1400}),rows=f.rows(Array.from({length:305},(_,i)=>"m"+i));
    const show=i=>{root.replaceChildren();const y=root.scrollTop+50;f.message(root,"m"+i,y);};
    show(304);f.verify(rows);
    for(const [frame,i] of [[95,204],[180,104],[255,0]])f.hooks.set(frame,()=>show(i));
    const result=await locate(f,rows,{id:"m0"});
    assert.equal(result.ok,true);assert.ok(f.clock>12000&&f.clock<45000);assert.ok(result.probes<20);
  }finally{f.close();}
});
test("new repeated identity containers land on the actual response heading, not the sr-only role marker",async()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.doc.createElement("div");
    msg.dataset.chatgptSearchMessageIds="a a";msg.dataset.y="900";
    msg.innerHTML='<h4 class="sr-only" data-conversation-role="assistant" tabindex="-1" data-height="1">Assistant</h4><div data-response-body><h2 id="actual" data-offset="180">Section</h2><p>Answer</p></div>';
    root.append(msg);
    const rows=[{id:"a",role:"assistant",body:"## Section\n\nAnswer",headings:[{text:"Section",level:2}],files:[]}];
    f.verify(rows);const result=await locate(f,rows,{id:"a",heading:0});
    assert.equal(result.ok,true);assert.equal(result.kind,"heading");assert.ok(f.frame>=8);
    assert.equal(f.source.mounted()[0],msg);assert.equal(f.index.destination(msg,rows[0],{heading:0}).node.id,"actual");
    assert.ok(msg.querySelector("#actual").getBoundingClientRect().top>=11);
  }finally{f.close();}
});
test("a new response container with only its 1px role label rendered cannot certify a message landing",async()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.doc.createElement("div");
    msg.dataset.chatgptSearchMessageIds="a a";msg.dataset.y="900";msg.dataset.height="1";
    msg.innerHTML='<h4 class="sr-only" data-conversation-role="assistant" data-height="1">Assistant</h4><div data-response-body style="display:none"><p>Answer</p></div>';
    root.append(msg);const rows=f.rows();f.verify(rows);
    f.hooks.set(12,()=>{msg.querySelector("[data-response-body]").style.display="block";msg.dataset.height="180";});
    const result=await locate(f,rows);
    assert.equal(result.ok,true);assert.ok(f.frame>=20,"Wait for actual body rendering and stable frames, not a stable screen-reader label.");
  }finally{f.close();}
});
test("message success requires a stable, identified and actually visible destination",async()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.message(root,"a",900),rows=f.rows();f.verify(rows);
    const result=await locate(f,rows);assert.equal(result.ok,true);assert.equal(result.kind,"message");
    assert.ok(f.frame>=8);assert.ok(f.scrolls.length>0);
    const rect=msg.getBoundingClientRect();assert.ok(rect.top>=11&&rect.bottom<700);
  }finally{f.close();}
});
test("verified lower landing stays above the composer and adds an isolated, non-scrolling focus cue",async()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.message(root,"a",1500,'<h2 data-offset="220">Target</h2>'),rows=f.rows();
    rows[0].headings=[{text:"Target",level:2}];f.verify(rows);
    const form=f.doc.createElement("form"),composer=f.doc.createElement("div");composer.id="prompt-textarea";
    composer.dataset.offset="610";form.append(composer);f.doc.body.append(form);
    const version=f.index.sample(),body=msg.outerHTML,focus=f.doc.activeElement;
    const result=await locate(f,rows,{id:"a",heading:0});assert.equal(result.ok,true);
    const rect=msg.firstElementChild.getBoundingClientRect();assert.equal(rect.top,451.5);assert.ok(rect.bottom<598);
    const cue=f.doc.querySelector("[data-reader-navigation-focus]");assert.ok(cue);assert.equal(cue.getAttribute("aria-hidden"),"true");
    assert.equal(cue.shadowRoot,null,"closed shadow decoration must not copy transcript text");
    assert.equal(msg.outerHTML,body);assert.equal(f.index.sample(),version);assert.equal(f.doc.activeElement,focus);
    const writes=f.scrolls.length;
    root.dispatchEvent(new f.w.Event("scroll",{bubbles:false}));
    assert.equal(cue.isConnected,false);assert.equal(f.scrolls.length,writes);
  }finally{f.close();}
});
test("focus is cleared before another jump, on caller cancellation, route changes and transcript edits",async()=>{
  for(const change of ["cancel","route","edit","next"]){
    const f=fixture();try{
      const root=f.root(),msg=f.message(root,"a",1000),rows=f.rows(),ctl=new AbortController();f.verify(rows);
      assert.equal((await locate(f,rows,{id:"a"},ctl)).ok,true);
      assert.ok(f.doc.querySelector("[data-reader-navigation-focus]"));
      if(change==="cancel")ctl.abort();
      if(change==="route")f.w.dispatchEvent(new f.w.PopStateEvent("popstate"));
      if(change==="edit"){msg.firstElementChild.textContent="Edited";await Promise.resolve();}
      if(change==="next")assert.equal((await locate(f,rows,{id:"missing"})).ok,false);
      assert.equal(f.doc.querySelector("[data-reader-navigation-focus]"),null,change);
    }finally{f.close();}
  }
});
test("a replacement scroll root is resolved again while the same target remains mounted",async()=>{
  const f=fixture();try{
    const old=f.root(),msg=f.message(old,"a",900),rows=f.rows();f.verify(rows);let next;
    f.hooks.set(2,()=>{next=f.root({top:30});next.append(msg);old.remove();});
    const result=await locate(f,rows);
    assert.equal(result.ok,true);assert.ok(f.scrolls.some(s=>s.root===next),"The live root, not its detached predecessor, must be scrolled.");
    assert.ok(!f.scrolls.some(s=>s.root===old&&s.frame>=2),"No write is allowed to the detached root.");
  }finally{f.close();}
});
test("initial empty virtual mount waits for identified history instead of returning unmounted",async()=>{
  const f=fixture();try{
    const root=f.root(),rows=f.rows();f.verify(rows);
    f.hooks.set(4,()=>f.message(root,"a",1200));
    assert.equal((await locate(f,rows)).ok,true);
    assert.ok(f.frame>=4);
  }finally{f.close();}
});
test("far jumps wait for a delayed virtual window and then verify the actual target",async()=>{
  const f=fixture();try{
    const root=f.root({size:30000}),rows=f.rows(Array.from({length:30},(_,i)=>"m"+i));
    f.message(root,"m0",0);f.message(root,"m1",1000);f.verify(rows);let queued=false;
    root.onMove=()=>{if(queued)return;queued=true;f.hooks.set(f.frame+6,()=>{
      root.replaceChildren();f.message(root,"m20",20000);f.message(root,"m21",21000);
    });};
    const result=await locate(f,rows,{id:"m20"});assert.equal(result.ok,true);
    assert.ok(result.probes>=1);assert.ok(f.scrolls.length>=1);assert.ok(f.frame>=6);
  }finally{f.close();}
});
test("negative reverse-flex scrollports land on an earlier mounted section, not the zero bottom boundary",async()=>{
  const f=fixture();try{
    const root=f.root({reverse:true}),msg=f.message(root,"a",-6400,'<h2 data-offset="130">Earlier</h2>'),rows=f.rows();
    rows[0].headings=[{text:"Earlier",level:2}];f.verify(rows);
    const result=await locate(f,rows,{id:"a",heading:0});assert.equal(result.ok,true);assert.equal(result.kind,"heading");
    assert.ok(root.scrollTop < -6000);assert.ok(msg.firstElementChild.getBoundingClientRect().top>=11);
  }finally{f.close();}
});
test("a reverse virtual probe from the newest mounted window reaches and verifies an older ID",async()=>{
  const f=fixture();try{
    const root=f.root({reverse:true}),rows=f.rows(Array.from({length:30},(_,i)=>"m"+i));f.message(root,"m29",12);f.verify(rows);
    let remounted=false;root.onMove=()=>{if(!remounted&&root.scrollTop < -100){remounted=true;root.replaceChildren();f.message(root,"m3",-7800);}};
    const result=await locate(f,rows,{id:"m3"});assert.equal(result.ok,true);assert.ok(result.probes>=1);
    assert.ok(root.scrollTop < -7700);assert.ok(f.frame>=8);assert.equal(f.index.visible(),"m3");
  }finally{f.close();}
});
test("a heading that is not rendered yet is awaited, not treated as a permanent missing target",async()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.message(root,"a",1000,""),rows=f.rows();
    rows[0].headings=[{level:2,text:"Ready"}];f.verify(rows);
    f.hooks.set(4,()=>{msg.innerHTML='<h2 data-offset="200">Ready</h2>';});
    const result=await locate(f,rows,{id:"a",heading:0});assert.equal(result.ok,true);assert.equal(result.kind,"heading");
  }finally{f.close();}
});
test("a layout-zero target can materialize later without a false hidden failure",async()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.message(root,"a",1000),rows=f.rows();msg.dataset.zero="";f.verify(rows);
    f.hooks.set(4,()=>delete msg.dataset.zero);assert.equal((await locate(f,rows)).ok,true);
  }finally{f.close();}
});
test("the final awaited frame cannot conceal a route or branch mutation behind success",async()=>{
  for(const change of ["route","branch"]){
    const f=fixture();try{
      const root=f.root(),rows=f.rows();f.message(root,"a",12);f.verify(rows);
      f.doc.querySelector("main").dataset.currentNodeId="n1";
      f.hooks.set(8,()=>{if(change==="route")f.w.history.pushState({},"","/c/synthetic-other");else f.doc.querySelector("main").dataset.currentNodeId="n2";});
      const result=await locate(f,rows);assert.equal(result.ok,false,change);assert.equal(result.reason,"changed",change);
    }finally{f.close();}
  }
});
test("the final awaited frame must revalidate exact heading visibility, not just its message",async()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.message(root,"a",12,"<h2>Ready</h2>"),rows=f.rows();rows[0].headings=[{level:2,text:"Ready"}];f.verify(rows);
    f.hooks.set(8,()=>{msg.querySelector("h2").style.visibility="hidden";});
    assert.equal((await locate(f,rows,{id:"a",heading:0})).ok,false);
  }finally{f.close();}
});
test("geometry moved on the success frame must be stabilized again",async()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.message(root,"a",12),rows=f.rows();f.verify(rows);
    f.hooks.set(8,()=>{msg.dataset.y="1000";});
    const result=await locate(f,rows);assert.equal(result.ok,true);assert.ok(f.frame>8);
    assert.ok(Math.abs(msg.getBoundingClientRect().top-519)<=1,"Re-establish the new lower reading line after motion; merely in-view is insufficient.");
  }finally{f.close();}
});
test("same-ID concurrent visible nodes are ambiguous, never first-match success",async()=>{
  const f=fixture();try{
    const root=f.root(),rows=f.rows();f.message(root,"a",12);f.message(root,"a",200);f.verify(rows);
    assert.equal((await locate(f,rows)).ok,false);
  }finally{f.close();}
});
test("role evidence must agree with the requested metadata before jump success",async()=>{
  const f=fixture();try{
    const root=f.root(),rows=f.rows();f.message(root,"a",12,"<p>Question</p>","user");
    assert.equal((await locate(f,rows)).ok,false);
  }finally{f.close();}
});
test("trusted manual scroll cancels direct jumps and removes temporary listeners without a late write",async()=>{
  const f=fixture();try{
    const root=f.root(),rows=f.rows();f.message(root,"a",1000);f.verify(rows);
    let stoppedAt;f.hooks.set(2,()=>{stoppedAt=f.scrolls.length;f.input("wheel",root);});
    await assert.rejects(locate(f,rows),{name:"AbortError"});
    assert.equal(f.scrolls.length,stoppedAt);assert.equal(f.listenerCount("wheel"),0);assert.equal(f.listenerCount("keydown"),0);
  }finally{f.close();}
});
test("caller cancellation during deferred rendering produces no late scroll or success",async()=>{
  const f=fixture();try{
    const root=f.root(),rows=f.rows(),ctl=new AbortController();f.message(root,"a",1000);f.verify(rows);
    let stoppedAt;f.hooks.set(2,()=>{stoppedAt=f.scrolls.length;ctl.abort();});
    await assert.rejects(locate(f,rows,{id:"a"},ctl),{name:"AbortError"});assert.equal(f.scrolls.length,stoppedAt);
  }finally{f.close();}
});
test("visible position never returns an offscreen overscan row in another root",()=>{
  const f=fixture();try{
    const old=f.root({top:-2000}),current=f.root();f.message(old,"old",0);f.message(current,"current",20);
    assert.equal(f.index.visible(),"current");
  }finally{f.close();}
});
test("nested scrollports must reveal the inner port through its live outer container",async()=>{
  const f=fixture();try{
    const outer=f.root({size:10000}),inner=f.root({top:1100,height:400,size:5000});outer.append(inner);
    const msg=f.message(inner,"a",1800),rows=f.rows();f.verify(rows);
    const result=await locate(f,rows);assert.equal(result.ok,true);
    assert.ok(f.scrolls.some(s=>s.root===outer));assert.ok(f.scrolls.some(s=>s.root===inner));
    const r=msg.getBoundingClientRect();assert.ok(r.top>=12&&r.top<688);
  }finally{f.close();}
});
test("a remounted partial body is uncertain rendering, not proof of a new branch",async()=>{
  const f=fixture();try{
    const root=f.root(),rows=f.rows();f.message(root,"a",1000);f.verify(rows);const before=f.index.sample();
    root.replaceChildren();const msg=f.message(root,"a",1000,"<p>Ans</p>");
    f.hooks.set(6,()=>{msg.querySelector("p").textContent="Answer";});
    const result=await locate(f,rows);assert.equal(result.ok,true);assert.equal(f.index.sample(),before);
    assert.ok(f.frame>6,"A partial remount cannot be declared settled before the original signature is restored.");
    msg.querySelector("p").textContent="A real edit";assert.notEqual(f.index.sample(),before);
  }finally{f.close();}
});
test("an unresolved changed remount never passes by identity and a stable rectangle alone",async()=>{
  const f=fixture();try{
    const root=f.root(),rows=f.rows();f.message(root,"a",12);f.verify(rows);const before=f.index.sample();
    root.replaceChildren();f.message(root,"a",12,"<p>Different content, not yet verified</p>");
    const result=await locate(f,rows);assert.equal(result.ok,false);
    assert.equal(f.index.sample(),before,"Do not label missing render proof as a confirmed branch mutation.");
  }finally{f.close();}
});
test("visual viewport, composer and attainable scroll boundaries constrain the final visible target",async()=>{
  for(const spec of [{y:0,size:700},{y:900,size:1500},{y:0,size:10000,viewport:true}]){
    const f=fixture();try{
      const root=f.root({size:spec.size}),msg=f.message(root,"a",spec.y),rows=f.rows();f.verify(rows);
      if(spec.viewport){f.w.visualViewport={offsetTop:100,height:500,offsetLeft:0,width:500};msg.dataset.y="1000";}
      const result=await locate(f,rows);assert.equal(result.ok,true);
      const rect=msg.getBoundingClientRect();assert.ok(rect.bottom>(spec.viewport?112:12));
      assert.ok(rect.top<(spec.viewport?588:688));
    }finally{f.close();}
  }
});
test("trusted keyboard and touch abort, but a programmatic scroll or untrusted wheel does not",async()=>{
  for(const type of ["keydown","touchstart","scroll","untrusted"]){
    const f=fixture();try{
      const root=f.root(),rows=f.rows();f.message(root,"a",1000);f.verify(rows);let at;
      f.hooks.set(2,()=>{at=f.scrolls.length;f.input(type==="untrusted"?"wheel":type,root,type==="keydown"?"PageDown":undefined,{isTrusted:type!=="untrusted"});});
      if(["keydown","touchstart"].includes(type)){
        await assert.rejects(locate(f,rows),{name:"AbortError"});assert.equal(f.scrolls.length,at);
      }else assert.equal((await locate(f,rows)).ok,true);
      for(const name of ["wheel","touchstart","pointerdown","keydown"])assert.equal(f.listenerCount(name),0);
    }finally{f.close();}
  }
});
test("late duplicate identity removal is awaited and canonical mapping-node aliases still locate",async()=>{
  const f=fixture();try{
    const root=f.root(),rows=f.rows(),msg=f.message(root,"node-a",1000),copy=f.message(root,"node-a",1100);
    f.source.remember({...rows[0],sourcePath:["node-a"]});
    assert.equal(f.source.verify({ids:new Set(["a"]),identities:new Set(["a","node-a"])}),true);
    f.hooks.set(4,()=>copy.remove());assert.equal((await locate(f,rows)).ok,true);
    assert.equal(f.source.idOf(msg),"a");assert.ok(f.frame>4);
  }finally{f.close();}
});
test("a direct jump refuses an already contradicted branch or active generation",async()=>{
  for(const condition of ["foreign","generating"]){
    const f=fixture();try{
      const root=f.root(),rows=f.rows();f.message(root,"a",12);f.verify(rows);
      if(condition==="foreign")f.message(root,"other",120);
      else {const stop=f.doc.createElement("button");stop.dataset.testid="stop-button";root.append(stop);}
      const result=await locate(f,rows);assert.equal(result.ok,false,condition);assert.equal(result.reason,"changed");
    }finally{f.close();}
  }
});
test("variable-height virtual far jumps work bidirectionally, including first and last messages",async()=>{
  const f=fixture();try{
    const rows=f.rows(Array.from({length:240},(_,i)=>"m"+i)),offsets=[0];
    const heights=rows.map((_,i)=>i===1?11000:1000+(i*97)%900);heights.forEach(h=>offsets.push(offsets.at(-1)+h));
    const root=f.root({size:offsets.at(-1)});let mountedKey="",queued=false;
    function render(){
      const center=heights.findIndex((_,i)=>offsets[i+1]>root.scrollTop),start=Math.max(0,center-2),end=Math.min(rows.length,center+5);
      const key=start+":"+end;if(mountedKey===key)return;mountedKey=key;root.replaceChildren();
      for(let i=start;i<end;i++)f.message(root,rows[i].id,offsets[i]).dataset.height=heights[i];
    }
    root.scrollTop=root.scrollHeight-root.clientHeight;render();f.verify(rows);
    root.onMove=()=>{if(!queued){queued=true;f.hooks.set(f.frame+4,()=>{queued=false;render();});}};
    for(const i of [0,137,239,54]){
      const result=await locate(f,rows,{id:rows[i].id});assert.equal(result.ok,true,`m${i}: ${JSON.stringify(result)}`);
      const target=root.querySelector(`[data-message-id="m${i}"]`);assert.ok(target);assert.ok(root.childElementCount<=7);
      const rect=target.getBoundingClientRect();assert.ok(rect.bottom>12&&rect.top<688);
    }
  }finally{f.close();}
});
test("current section uses the real reading line and retains the duplicate heading ordinal",()=>{
  const f=fixture();try{
    const root=f.root(),msg=f.message(root,"a",0,'<h2 data-offset="0">Repeated</h2><h3 data-offset="300">Child</h3><h2 data-offset="700">Repeated</h2>');
    msg.dataset.height="1500";const row={id:"a",role:"assistant",headings:[{text:"Repeated",level:2},{text:"Child",level:3},{text:"Repeated",level:2}],files:[]};
    f.verify([row]);root.scrollTop=350;
    assert.deepEqual(JSON.parse(JSON.stringify(f.index.currentSection(row))),{id:"a",heading:1});
    root.scrollTop=750;assert.deepEqual(JSON.parse(JSON.stringify(f.index.currentSection(row))),{id:"a",heading:2});
    msg.querySelector("h2").remove();
    assert.deepEqual(JSON.parse(JSON.stringify(f.index.currentSection(row))),{id:"a"},"Missing duplicate predecessors cannot shift the requested ordinal.");
  }finally{f.close();}
});
test("abort and deadline wake a jump even when animation frames are suspended",async()=>{
  for(const mode of ["abort","deadline"]){
    const f=fixture();try{
      const root=f.root(),rows=f.rows(),ctl=new AbortController();f.message(root,"a",12);f.verify(rows);
      f.w.requestAnimationFrame=()=>1;f.w.cancelAnimationFrame=()=>{};
      let timer;f.w.setTimeout=fn=>{timer=fn;return 1;};f.w.clearTimeout=()=>{};
      const pending=locate(f,rows,{id:"a"},ctl);
      if(mode==="abort"){ctl.abort();await assert.rejects(pending,{name:"AbortError"});}
      else {timer();assert.equal((await pending).ok,false);}
      assert.equal(f.listenerCount("wheel"),0);
    }finally{f.close();}
  }
});
test("only a fresh exact source body can corroborate an otherwise uncertain remount",async()=>{
  const f=fixture();try{
    const root=f.root(),rows=f.rows();f.message(root,"a",12);f.verify(rows);f.index.sample();
    root.replaceChildren();f.message(root,"a",12,"<p>Changed source</p>");f.index.sample();
    f.w.ReaderVisible=m=>({body:m.body});f.w.FastTextExporter={};
    const fresh=f.index.fromBranch({messages:[{...rows[0],body:"Changed source"}]});
    assert.equal((await locate(f,fresh)).ok,true);
  }finally{f.close();}
});
