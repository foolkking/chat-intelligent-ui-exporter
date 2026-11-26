// Synthetic DOM evidence, not a logged-in ChatGPT acceptance test.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),root=path.resolve(__dirname,"..");
function fixture(html){
  const dom=new JSDOM(html,{url:"https://chatgpt.com/c/synthetic-adapter",runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
  w.Element.prototype.getClientRects=function(){return this.isConnected?[{top:0,bottom:40,left:0,right:300,width:300,height:40}]:[];};
  for(const f of ["extension/source-dom.js","reader/page-index.js"])w.eval(fs.readFileSync(path.join(root,f),"utf8"));
  return {w,dom: w.ChatExportSourceDOM,index:w.ReaderPageIndex,close:()=>w.close()};
}
test("new turn IDs resolve by API role evidence, not order; every answer retains its own identity",()=>{
  const p=fixture('<main><article data-chatgpt-search-message-ids="q a"><div data-message-author-role="assistant"><p>Answer</p></div><div data-message-author-role="user"><p>Question</p></div></article></main>');
  try{
    assert.equal(p.dom.mounted().length,0,"Ambiguous multi-ID wrappers cannot be assigned by position.");
    assert.equal(p.dom.verify({ids:new Set(["q","a"])}),true);
    p.dom.remember({id:"q",role:"user"});p.dom.remember({id:"a",role:"assistant"});
    const rows=p.index.domRows();
    assert.equal(rows.length,2);assert.equal(rows[0].id,"a");assert.equal(rows[1].id,"q");
    assert.equal(rows[0].body,"Answer");assert.equal(rows[1].body,"Question");
  }finally{p.close();}
});
test("hidden history cannot supply messages, branch hints, composers or generation state",()=>{
  const p=fixture('<main><div data-message-id="visible" data-message-author-role="assistant">Answer</div></main><section style="display:none"><div data-current-node-id="old-leaf"><div data-message-id="old" data-message-author-role="assistant">Old</div></div><button data-testid="stop-button">Stop</button><form data-chatgpt-composer><button aria-label="Stop"></button><div id="prompt-textarea"></div></form></section>');
  try{
    assert.equal(p.dom.generating(),false);assert.equal(p.dom.explicitLeaf(),undefined);
    assert.equal(p.dom.branchHint(),"visible");assert.equal(p.dom.composer(),undefined);
    assert.equal(p.dom.verify({ids:new Set(["visible"])}),true);
    assert.deepEqual(Array.from(p.index.mounted(),p.dom.idOf),["visible"]);
    p.w.document.querySelector("section").style.display="block";
    assert.equal(p.dom.generating(),true);assert.equal(p.dom.verify({ids:new Set(["visible"])}),false);
  }finally{p.close();}
});
test("new and old visible stop controls refuse a snapshot, hidden controls do not",()=>{
  for(const html of ['<button aria-label="Stop streaming"></button>','<button aria-label="Stop generating"></button>',
    '<button aria-label="停止生成"></button>','<form data-chatgpt-composer><button aria-label="Stop"></button></form>',
    '<div data-talvt-turn-state="in_progress"></div>','<button data-testid="stop-button"></button>']){
    const p=fixture("<main>"+html+"</main>");try{
      assert.equal(p.dom.generating(),true);
      p.w.document.querySelector("main").setAttribute("aria-hidden","true");assert.equal(p.dom.generating(),false);
    }finally{p.close();}
  }
});
test("copy feedback and known virtual slot reuse do not invalidate; real body and branch edits do",()=>{
  const p=fixture('<main data-current-node-id="n3"><article data-testid="conversation-turn-0"><div data-message-id="a" data-message-author-role="assistant"><p>Answer</p><button>Copy</button></div></article></main>');
  try{
    const main=p.w.document.querySelector("main"),slot=p.w.document.querySelector("article");
    assert.equal(p.dom.verify({ids:new Set(["a","b"])}),true);const before=p.index.sample();
    p.w.document.querySelector("button").textContent="Copied";assert.equal(p.index.sample(),before);
    slot.innerHTML='<div data-message-id="b" data-message-author-role="assistant"><p>History</p></div>';
    assert.equal(p.index.sample(),before,"Known history mounted in the same recycled slot is not a new branch.");
    assert.equal(p.index.leaf(),"n3");
    p.w.document.querySelector("p").textContent="Changed history";assert.notEqual(p.index.sample(),before);
    const next=p.index.sample();main.dataset.currentNodeId="n4";assert.notEqual(p.index.sample(),next);
    const marker=p.index.sample();slot.innerHTML='<div data-message-id="foreign" data-message-author-role="assistant">Other branch</div>';
    assert.notEqual(p.index.sample(),marker);assert.equal(p.dom.verify({ids:new Set(["a","b"])}),false);
  }finally{p.close();}
});
test("a virtual ancestor is only a read hint, never a version-changing branch end",()=>{
  const p=fixture('<main><div data-message-id="a" data-message-author-role="assistant">History</div></main>');
  try{
    p.dom.verify({ids:new Set(["a","b"])});const before=p.index.sample();
    p.w.document.querySelector("main").innerHTML='<div data-message-id="b" data-message-author-role="assistant">Newer history</div>';
    assert.equal(p.index.leaf(),"b");assert.equal(p.index.sample(),before);
  }finally{p.close();}
});
test("multiple same-role identities stay unresolved instead of choosing the last answer",()=>{
  const p=fixture('<main><div data-chatgpt-search-message-ids="a1 a2" data-message-author-role="assistant">Answer</div></main>');
  try{
    p.dom.remember({id:"a1",role:"assistant"});p.dom.remember({id:"a2",role:"assistant"});
    assert.equal(p.dom.mounted().length,0);
    assert.equal(p.dom.verify({ids:new Set(["a1"])}),false);
  }finally{p.close();}
});
test("nested legacy identities and bare new IDs use real roles; contradictory role evidence is refused",()=>{
  const p=fixture('<main><section data-message-author-role="user"><p data-message-id="q">Question</p></section><div data-chatgpt-search-message-ids="a a">Answer</div></main>');
  try{
    p.dom.remember({id:"q",role:"user"});p.dom.remember({id:"a",role:"assistant"});
    assert.equal(p.dom.verify({ids:new Set(["q","a"])}),true);
    assert.deepEqual(Array.from(p.index.domRows(),r=>[r.id,r.role]),[["q","user"],["a","assistant"]]);
    p.w.document.querySelector("section").dataset.messageAuthorRole="assistant";
    assert.equal(p.dom.verify({ids:new Set(["q","a"])}),false);
    assert.equal(p.dom.idOf(p.w.document.querySelector("section")),undefined);
  }finally{p.close();}
});
