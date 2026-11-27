// Synthetic, layout-independent UI contract tests. Real transcript navigation
// remains delegated to the independently tested ReaderPageIndex.jump.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),repo=path.resolve(__dirname,"..");
const row=(id,role,headings=[])=>({id,role,title:role+" "+id,headings,files:[]});
function fixture(rows=[]){
  const dom=new JSDOM('<button id="outside">Outside</button><div id="list"></div>',{url:"https://chatgpt.com/c/synthetic-outline",runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window,container=w.document.querySelector("#list"),locates=[],previews=[],changes=[],sizes=[];let before=0;
  w.ResizeObserver=class {constructor(callback){this.callback=callback;sizes.push(this);}observe(){}disconnect(){}};
  Object.defineProperty(container,"clientHeight",{value:300,configurable:true});
  for(const file of ["extension/source-dom.js","reader/page-index.js","reader/outline-tree.js"])w.eval(fs.readFileSync(path.join(repo,file),"utf8"));
  const tree=w.ReaderOutlineTree({container,zh:false,onLocate:(target,owner)=>locates.push({target:JSON.parse(JSON.stringify(target)),owner}),
    onPreview:(data,owner,parent)=>{previews.push(data.id);owner.addEventListener("focus",()=>{parent.dataset.preview="requested";});},
    onBeforeRender:()=>before++,onChange:state=>changes.push(state)});
  tree.setRows(rows);
  const items=()=>[...container.querySelectorAll('[role="treeitem"]')];
  const item=target=>items().find(el=>el.dataset.mid===target.id&&
    (target.heading===undefined?el.dataset.heading===undefined&&el.dataset.kind!=="turn":el.dataset.heading===String(target.heading)));
  const key=(node,key)=>node.onkeydown({key,isTrusted:true,preventDefault(){},stopPropagation(){}});
  const click=node=>node.onclick({isTrusted:true,stopPropagation(){}});
  return {w,container,tree,locates,previews,changes,items,item,key,click,sizes,get before(){return before;},close:()=>{tree.destroy();w.close();}};
}
test("outline tree keeps every turn, question, answer and nested section with stable duplicate ordinals",()=>{
  const rows=[row("q","user"),row("a1","assistant",[{text:"Repeated",level:2},{text:"Child",level:3},{text:"Repeated",level:2}]),row("a2","assistant")];
  const f=fixture(rows);try{
    const items=f.items();assert.equal(items.length,7);
    assert.deepEqual(items.map(i=>i.dataset.kind),["turn","question","answer","section","section","section","answer"]);
    assert.deepEqual(items.map(i=>Number(i.getAttribute("aria-level"))),[1,2,2,3,4,3,2]);
    assert.ok(f.item({id:"a1"}));assert.ok(f.item({id:"a2"}));
    f.click(f.item({id:"a1",heading:2}));assert.deepEqual(f.locates[0].target,{id:"a1",heading:2,conversation:"synthetic-outline",
      chapter:{text:"Repeated",level:2,occurrence:1,parents:[],ancestry:[],before:"Child",after:null}});
    assert.equal(f.items().filter(i=>i.tabIndex===0).length,1);
  }finally{f.close();}
});
test("leading assistants and consecutive users remain separate turns; no-answer turns stay reachable",()=>{
  const f=fixture([row("a0","assistant"),row("q1","user"),row("q2","user"),row("a2","assistant")]);try{
    const roots=f.items().filter(i=>i.dataset.kind==="turn");assert.equal(roots.length,3);
    assert.deepEqual(roots.map(i=>i.getAttribute("aria-posinset")),["1","2","3"]);
    f.tree.reveal({id:"q1"});assert.ok(f.item({id:"q1"}));
    f.tree.reveal({id:"a2"});assert.ok(f.item({id:"a2"}));assert.ok(f.item({id:"q2"}));
  }finally{f.close();}
});
test("collapse does not navigate, reveal opens the exact ancestry and keeps all answer entry points",()=>{
  const f=fixture([row("q","user"),row("a","assistant",[{text:"Top",level:1},{text:"Child",level:3}]),row("b","assistant")]);try{
    const top=f.item({id:"a",heading:0});top.focus();f.key(top,"ArrowLeft");
    assert.equal(f.item({id:"a",heading:1}),undefined);assert.equal(f.locates.length,0);
    f.tree.reveal({id:"a",heading:1},{focus:true});
    assert.equal(f.w.document.activeElement,f.item({id:"a",heading:1}));
    assert.equal(f.item({id:"a",heading:0}).getAttribute("aria-expanded"),"true");
    assert.ok(f.item({id:"a"}));assert.ok(f.item({id:"b"}));
  }finally{f.close();}
});
test("roving arrow/Home/End keyboard navigation never jumps until Enter or Space",()=>{
  const f=fixture([row("q","user"),row("a","assistant",[{text:"Section",level:2}])]);try{
    const first=f.items()[0];first.focus();f.key(first,"ArrowDown");
    assert.equal(f.w.document.activeElement,f.item({id:"q"}));assert.equal(f.locates.length,0);
    f.key(f.w.document.activeElement,"End");assert.equal(f.w.document.activeElement,f.item({id:"a",heading:0}));
    f.key(f.w.document.activeElement,"Enter");assert.deepEqual(f.locates.at(-1).target,{id:"a",heading:0,conversation:"synthetic-outline",
      chapter:{text:"Section",level:2,occurrence:0,parents:[],ancestry:[],before:null,after:null}});
    f.key(f.w.document.activeElement,"Home");assert.equal(f.w.document.activeElement,f.items()[0]);
    f.key(f.w.document.activeElement," ");assert.deepEqual(f.locates.at(-1).target,{id:"q"});
  }finally{f.close();}
});
test("current exact chapter and its ancestor path are marked without taking focus or scrolling the source",()=>{
  const f=fixture([row("q","user"),row("a","assistant",[{text:"Top",level:1},{text:"Child",level:2}])]);try{
    const outside=f.w.document.querySelector("#outside");outside.focus();
    f.tree.setActive({id:"a",heading:1},{reveal:true});
    assert.equal(f.w.document.activeElement,outside);
    const current=f.container.querySelector('[aria-current="location"]');assert.equal(current,f.item({id:"a",heading:1}));
    assert.equal(f.container.querySelectorAll('[aria-current="location"]').length,1);
    assert.ok(f.item({id:"a"}).classList.contains("current-path"));
    f.tree.setActive({id:"a"});assert.equal(f.item({id:"a"}).getAttribute("aria-current"),"location");
    assert.equal(f.item({id:"a",heading:1}).getAttribute("aria-current"),null);
  }finally{f.close();}
});
test("50001 rows use a bounded DOM window, expose exact totals and reveal the far end without truncation",()=>{
  const rows=Array.from({length:50001},(_,i)=>row("m"+i,i%2?"assistant":"user")),f=fixture(rows);
  try{
    assert.ok(f.items().length<=64);
    f.tree.reveal({id:"m49999"},{focus:true});assert.ok(f.item({id:"m49999"}));assert.ok(f.items().length<=64);
    assert.equal(f.w.document.activeElement,f.item({id:"m49999"}));
    f.key(f.w.document.activeElement,"End");
    const last=f.w.document.activeElement;assert.equal(last.dataset.mid,"m50000");assert.equal(last.getAttribute("aria-setsize"),"25001");
    f.key(last,"ArrowRight");f.key(last,"ArrowRight");assert.ok(f.item({id:"m50000"}));
    f.tree.reveal({id:"m0"});assert.ok(f.item({id:"m0"}));assert.ok(f.items().length<=64);
    assert.ok(f.container.querySelector('[data-spacer="after"]').style.height!=="0px");
  }finally{f.close();}
});
test("the window follows list scroll and exact sibling positions survive virtualization",()=>{
  const f=fixture(Array.from({length:300},(_,i)=>row("q"+i,"user")));try{
    f.container.scrollTop=52*150;f.tree.render();
    const roots=f.items().filter(i=>i.dataset.kind==="turn");
    assert.ok(Number(roots[0].getAttribute("aria-posinset"))>100);assert.ok(f.items().length<=64);
    assert.ok(roots.every(i=>i.getAttribute("aria-setsize")==="300"));
  }finally{f.close();}
});
test("question previews stay on demand and use the original row owner; no body is retained by the tree",()=>{
  const data={...row("q","user"),body:"x".repeat(2*1024*1024)},f=fixture([data,row("a","assistant")]);try{
    assert.deepEqual(f.previews,["q"]);const question=f.item({id:"q"}),wrapper=question.parentElement;
    assert.equal(wrapper.dataset.preview,undefined);question.focus();assert.equal(wrapper.dataset.preview,"requested");
    assert.ok(!f.container.textContent.includes("x".repeat(1000)));assert.equal(question.hasAttribute("title"),false);
    const before=f.before;f.tree.render();assert.ok(f.before>=before);
    assert.equal(f.w.document.activeElement,f.item({id:"q"}),"A render must not drop keyboard focus.");
  }finally{f.close();}
});
test("same-title heading keys and focus survive same-source metadata refresh and discard removed branches",()=>{
  const headings=[{text:"Same",level:2},{text:"Same",level:2}],f=fixture([row("q","user"),row("a","assistant",headings)]);
  try{
    f.tree.setActive({id:"a",heading:1},{reveal:true,focus:true});const key=f.item({id:"a",heading:1}).dataset.key;
    f.tree.setRows([row("q","user"),row("a","assistant",headings.map(h=>({...h})))]);
    assert.equal(f.w.document.activeElement.dataset.key,key);assert.equal(f.item({id:"a",heading:1}).getAttribute("aria-current"),"location");
    f.tree.setRows([row("other","assistant")]);assert.equal(f.container.querySelector('[data-mid="a"]'),null);
    assert.equal(f.container.querySelector("[aria-current]"),null);assert.ok(f.items().some(i=>i.dataset.mid==="other"));
  }finally{f.close();}
});
test("text is inserted literally, never interpreted as source HTML or executable markup",()=>{
  const f=fixture([{...row("q","user"),title:'<img src=x onerror="alert(1)">'},row("a","assistant",[{text:"<script>bad()</script>",level:2}])]);
  try{
    assert.equal(f.container.querySelector("img,script"),null);assert.match(f.container.textContent,/<img src=x/);
    assert.match(f.container.textContent,/<script>bad/);
  }finally{f.close();}
});
test("empty models and detached/destroyed trees have no stale callbacks, selected paths or pending focus",()=>{
  const f=fixture([]);try{
    assert.equal(f.items().length,0);assert.match(f.container.textContent,/No messages/);
    f.tree.setRows([row("a","assistant")]);const old=f.item({id:"a"});f.tree.destroy();
    old.onclick({isTrusted:true,stopPropagation(){}});assert.equal(f.locates.length,0);
    f.container.scrollTop=200;f.container.dispatchEvent(new f.w.Event("scroll"));assert.equal(f.container.children.length,0);
  }finally{f.close();}
});
test("untrusted synthetic activation cannot trigger a source navigation request",()=>{
  const f=fixture([row("q","user")]);try{
    const question=f.item({id:"q"});question.click();
    question.onkeydown({key:"Enter",isTrusted:false,preventDefault(){},stopPropagation(){}});
    assert.equal(f.locates.length,0);
  }finally{f.close();}
});
test("measuring an expanded preview adjusts virtual geometry without destroying or re-reading it",async()=>{
  const f=fixture(Array.from({length:100},(_,i)=>row("q"+i,"user")));try{
    const question=f.item({id:"q0"});question.focus();const wrapper=question.parentElement,before=f.before,previews=f.previews.length;
    wrapper.getBoundingClientRect=()=>({height:252});
    f.sizes[0].callback([{target:wrapper}]);
    await new Promise(resolve=>f.w.requestAnimationFrame(resolve));
    assert.equal(f.item({id:"q0"}),question,"Geometry-only measurements keep the live preview owner.");
    assert.equal(f.w.document.activeElement,question);assert.equal(f.before,before);assert.equal(f.previews.length,previews);
  }finally{f.close();}
});
test("a detached tree cannot navigate or steal the list back on a late scroll/resize callback",async()=>{
  const f=fixture([row("q","user")]);try{
    const old=f.item({id:"q"}),replacement=f.w.document.createElement("p");replacement.textContent="Files";
    f.container.replaceChildren(replacement);f.click(old);assert.equal(f.locates.length,0);
    f.sizes[0].callback([{target:old.parentElement}]);f.container.dispatchEvent(new f.w.Event("scroll"));
    await new Promise(resolve=>f.w.requestAnimationFrame(resolve));assert.equal(f.container.firstElementChild,replacement);
  }finally{f.close();}
});
test("collapsing a turn with off-window descendants updates its disclosure without dropping focus",()=>{
  const f=fixture(Array.from({length:200},(_,i)=>row("q"+i,"user")));try{
    const first=f.items()[0];first.focus();f.key(first,"ArrowRight");
    const turn=f.items().find(el=>el.dataset.kind==="turn"&&el.dataset.mid==="q1");
    turn.focus();f.key(turn,"ArrowRight");const mounted=f.items().find(el=>el.dataset.kind==="turn"&&el.dataset.mid==="q1");
    f.key(mounted,"ArrowLeft");
    assert.equal(f.w.document.activeElement.dataset.key,mounted.dataset.key);
    assert.equal(f.w.document.activeElement.getAttribute("aria-expanded"),"false");
  }finally{f.close();}
});
test("revealing a deep chapter preserves exact hidden nesting levels and independent sibling occurrence counts",()=>{
  const headings=Array.from({length:90},(_,i)=>({text:"Level "+i,level:(i%6)+1})),f=fixture([row("q","user"),row("a","assistant",headings)]);
  try{
    f.tree.reveal({id:"a",heading:89},{focus:true});
    assert.equal(f.w.document.activeElement.dataset.heading,"89");assert.ok(f.items().length<=64);
    assert.equal(f.w.document.activeElement.getAttribute("aria-level"),"8");
    assert.equal(f.w.document.activeElement.getAttribute("aria-posinset"),"1");
    assert.equal(f.w.document.activeElement.getAttribute("aria-setsize"),"1");
    f.key(f.w.document.activeElement,"ArrowLeft");assert.equal(f.w.document.activeElement.dataset.heading,"88");
  }finally{f.close();}
});
test("scrolling a focused virtual row out of the window keeps a visible keyboard entry, never body focus",()=>{
  const f=fixture(Array.from({length:300},(_,i)=>row("q"+i,"user")));try{
    f.items()[0].focus();f.container.scrollTop=52*180;f.tree.render();
    assert.ok(f.container.contains(f.w.document.activeElement));
    assert.equal(f.w.document.activeElement.getAttribute("role"),"treeitem");
    assert.equal(f.w.document.activeElement.tabIndex,0);assert.ok(Number(f.w.document.activeElement.getAttribute("aria-posinset"))>100);
  }finally{f.close();}
});
test("collapsed turns keep question titles discoverable and do not add hidden interactive controls",()=>{
  const f=fixture([row("q1","user"),row("q2","user")]);try{
    const second=f.items().find(el=>el.dataset.kind==="turn"&&el.dataset.mid==="q2");
    assert.match(second.textContent,/user q2/);
    assert.equal(f.container.querySelectorAll('button[aria-hidden="true"]').length,0);
    const fold=second.querySelector(".outline-fold");assert.ok(fold);
    fold.onclick({isTrusted:true,stopPropagation(){}});assert.ok(f.item({id:"q2"}));assert.equal(f.locates.length,0);
  }finally{f.close();}
});
test("expand/collapse all stays metadata-only, keeps the window bounded, and never navigates",()=>{
  const f=fixture(Array.from({length:200},(_,i)=>row("m"+i,i%2?"assistant":"user",i%2?[{text:"Top",level:1},{text:"Child",level:2}]:[])));
  try{
    f.w.document.querySelector("#outside").focus();
    f.tree.setAll(true);assert.ok(f.item({id:"m1",heading:1}));assert.ok(f.items().length<=64);
    f.tree.setAll(false);assert.ok(f.items().every(el=>el.dataset.kind==="turn"));
    assert.equal(f.locates.length,0);assert.equal(f.w.document.activeElement.id,"outside");
    f.tree.setActive({id:"m199",heading:1},{reveal:true});
    assert.equal(f.item({id:"m199",heading:1}).getAttribute("aria-current"),"location");
    assert.ok(f.items().length<=64);assert.equal(f.locates.length,0);
  }finally{f.close();}
});
test("incremental chapter replacement cannot lend an old ordinal's focus or callback to a different title",()=>{
  const f=fixture([row("q","user"),row("a","assistant",[{text:"Old",level:2}]),row("q2","user")]);try{
    f.tree.setActive({id:"a",heading:0},{focus:true});const old=f.item({id:"a",heading:0}),answer=f.item({id:"a"});
    const next=f.w.ReaderPageIndex.metadata(row("a","assistant",[{text:"New",level:2}]));
    f.tree.patchChapters(new Map([["a",next]]));
    assert.equal(f.w.document.activeElement,answer);assert.equal(answer.getAttribute("aria-current"),"location");
    f.click(old);assert.equal(f.locates.length,0);f.click(f.item({id:"a",heading:0}));assert.equal(f.locates.length,1);
  }finally{f.close();}
});
