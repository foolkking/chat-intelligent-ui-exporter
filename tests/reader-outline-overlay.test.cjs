const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),repo=path.resolve(__dirname,".."),tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const rows=[{id:"q",role:"user",title:"Synthetic question",headings:[],files:[]},
  {id:"a",role:"assistant",title:"Synthetic answer",headings:[{level:2,text:"Same"},{level:3,text:"Nested"},{level:2,text:"Same"}],files:[{name:"x.pdf",id:"file-x",type:"file"}]},
  {id:"b",role:"assistant",title:"Headingless answer",headings:[],files:[]}];
async function fixture({complete=true,current={id:"a",heading:1}}={}){
  const dom=new JSDOM("<main></main>",{url:"https://chatgpt.com/c/synthetic-outline-overlay",runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
  const roots=[],observers=[],errors=[],jumps=[],reads=[];let result={ok:true,kind:"heading"},finish;
  const attach=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(options){const root=attach.call(this,options);roots.push(root);return root;};
  const Observer=w.MutationObserver;w.MutationObserver=class extends Observer {constructor(callback){super(callback);observers.push(this);}};
  w.addEventListener("error",event=>errors.push(event.error?.message||event.message));
  w.chrome={runtime:{sendMessage:async()=>({view:"outline"}),onMessage:{addListener(){}}}};
  for(const file of ["extension/source-dom.js","reader/routes.js","reader/glyphs.js","reader/progress.js","reader/page-index.js","reader/outline-tree.js","reader/overlay.js"])
    w.eval(fs.readFileSync(path.join(repo,file),"utf8"));
  w.ReaderPageIndex.observeLayout=()=>{};w.ReaderPageIndex.layout=()=>({height:900,edge:800,top:0,compact:false});
  w.ReaderPageIndex.visible=()=>current?.id;w.ReaderPageIndex.currentSection=()=>current;
  w.ReaderPageIndex.jump=async(_rows,target)=>{jumps.push(JSON.parse(JSON.stringify(target)));if(result===null)return new Promise(resolve=>{finish=resolve;});return result;};
  w.ReaderOverlay({busy:()=>false,read:async()=>({rows,complete,loadBody:async id=>{reads.push(id);return "Full synthetic question";}})});
  const root=roots[0],click=node=>node.onclick({isTrusted:true,stopPropagation(){}});
  click(root.querySelector(".handle"));await tick();await tick();
  const item=(id,heading)=>[...root.querySelectorAll('[role="treeitem"]')].find(el=>el.dataset.mid===id&&el.dataset.kind!=="turn"&&
    (heading===undefined?el.dataset.heading===undefined:el.dataset.heading===String(heading)));
  return {w,root,click,item,jumps,reads,setResult:r=>{result=r;},setCurrent:r=>{current=r;},finish:r=>finish(r),
    close(){observers.forEach(observer=>observer.disconnect());w.close();assert.deepEqual(errors,[]);}};
}
test("overlay renders the approved tree with all answer entries and marks the actual current nested section",async()=>{
  const f=await fixture();try{
    assert.ok(f.root.querySelector('[role="tree"]'));assert.ok(f.item("a"));assert.ok(f.item("b"));
    assert.equal(f.item("a",1).getAttribute("aria-current"),"location");
    assert.ok(f.item("a").classList.contains("current-path"));assert.equal(f.reads.length,0);
    f.click(f.item("a",2));await tick();assert.deepEqual(f.jumps,[{id:"a",heading:2}]);
  }finally{f.close();}
});
test("tree activation reports success only after a verified result and preserves location-unconfirmed failures",async()=>{
  const f=await fixture();try{
    f.setResult(null);f.click(f.item("a",2));await tick();
    assert.match(f.root.querySelector(".status").textContent,/Locating/);
    assert.equal(f.item("a",2).getAttribute("aria-current"),null);
    f.finish({ok:false,reason:"target"});await tick();
    assert.match(f.root.querySelector(".status").textContent,/Location unconfirmed/);
    assert.equal(f.item("a",1).getAttribute("aria-current"),"location");
    f.setResult({ok:true,kind:"heading"});f.setCurrent({id:"a",heading:2});f.click(f.item("a",2));await tick();
    assert.equal(f.item("a",2).getAttribute("aria-current"),"location");
  }finally{f.close();}
});
test("file message fallback stays explicit and cannot manufacture a current chapter; returning to the tree preserves identity",async()=>{
  const f=await fixture({complete:false});try{
    f.click(f.root.querySelectorAll("nav button")[1]);f.setResult({ok:true,kind:"message-fallback"});f.setCurrent({id:"a"});
    f.click(f.root.querySelector(".result"));await tick();
    assert.match(f.root.querySelector(".status").textContent,/At the owning message; the exact file could not be verified/);
    assert.match(f.root.querySelector(".status").textContent,/Partial outline/);
    f.click(f.root.querySelectorAll("nav button")[0]);
    assert.equal(f.item("a").getAttribute("aria-current"),"location");
    assert.equal(f.root.querySelector('[data-heading][aria-current]'),null);
    assert.match(f.root.querySelector(".status").textContent,/At the owning message/,"A list render must retain the real degraded navigation outcome.");
  }finally{f.close();}
});
test("question previews remain demand-driven after tree integration and abort/release on switching list",async()=>{
  const f=await fixture({current:{id:"q"}});try{
    assert.deepEqual(f.reads,[]);const question=f.item("q");question.focus();await tick();
    assert.deepEqual(f.reads,["q"]);assert.equal(f.root.querySelector(".question-preview .body").textContent,"Full synthetic question");
    f.click(f.root.querySelectorAll("nav button")[1]);assert.equal(f.root.querySelector(".question-preview"),null);
    f.click(f.root.querySelectorAll("nav button")[0]);assert.deepEqual(f.reads,["q"]);assert.ok(f.item("q"));
  }finally{f.close();}
});
