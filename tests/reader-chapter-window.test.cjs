const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom");
function fixture({load,valid=()=>true}={}){
  const dom=new JSDOM("<main></main>",{url:"https://chatgpt.com/c/synthetic-window",runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
  for(const name of ["extension/source-dom.js","reader/page-index.js","reader/outline-tree.js"])w.eval(fs.readFileSync(path.join(__dirname,"..",name),"utf8"));
  const main=w.document.querySelector("main"),reads=[],patches=[],rows=[];
  for(let i=0;i<10;i++)for(const role of ["user","assistant"])rows.push({id:(role==="user"?"q":"a")+i,role,title:""});
  rows.splice(10,0,{id:"extra4",role:"assistant",title:""});
  const tree=w.ReaderOutlineTree({container:main});
  const model=w.ReaderChapterWindow({rows,valid,load:async(id,signal)=>{
    reads.push(id);return load?load(id,signal):[{text:"Section",level:2},{text:"Child",level:3}];
  },patch:(changes,window)=>{patches.push(Array.from(changes.keys()));tree.patchChapters(changes,window);},error:e=>{throw e;}});
  tree.setRows(rows,model.turns);
  return {w,model,main,reads,patches,tree,close:()=>{model.pause();tree.destroy();w.close();}};
}
test("window clips at both ends, prioritizes the clicked answer and evicts only departed chapter models",async()=>{
  const f=fixture();try{
    const {model:m,reads}=f;assert.deepEqual(reads,[]);assert.equal(m.center(),-1);
    await m.move("q0");assert.deepEqual(Array.from(m.expanded()),["q0","q1","q2"]);assert.deepEqual(reads,["a0"]);
    await m.request("a3");assert.deepEqual(reads,["a0"]);
    await m.move("extra4");assert.deepEqual(Array.from(m.expanded()),["q3","q4","q5","q6"]);
    assert.deepEqual(reads,["a0","extra4","a4"]);assert.equal(m.detail("a0"),undefined);
    await m.request("q5");const retained=m.detail("a5"),root=f.main.querySelector('[data-kind="turn"][data-mid="q7"]');
    await m.move("q5");await m.move("a5");assert.equal(m.detail("a5"),retained);
    assert.equal(reads.filter(id=>id==="a5").length,1);
    assert.equal(f.main.querySelector('[data-kind="turn"][data-mid="q7"]'),root,"unaffected turn identity survives window patches");
    await m.move("a9");assert.deepEqual(Array.from(m.expanded()),["q8","q9"]);
    assert.deepEqual(Array.from(m.snapshot().keys()),["a9"]);assert.equal(m.order.size,21);
  }finally{f.close();}
});
test("aborted reads and a changed branch cannot populate the old or the new chapter window",async()=>{
  let resolve,valid=true,signal;
  const f=fixture({valid:()=>valid,load:(id,s)=>{if(id==="a4"){signal=s;return new Promise(done=>{resolve=done;});}return [];}});try{
    const first=f.model.move("a4");await f.model.move("a8");assert.equal(signal.aborted,true);
    resolve([{text:"Stale",level:2}]);await first;assert.equal(f.model.detail("a4"),undefined);assert.equal(f.model.center(),8);
    const again=f.model.move("a4");valid=false;resolve([{text:"Wrong branch",level:2}]);await again;
    assert.equal(f.model.detail("a4"),undefined);assert.equal(f.reads.includes("extra4"),false);
  }finally{f.close();}
});
