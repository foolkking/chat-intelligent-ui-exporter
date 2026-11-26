const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom");
function fixture(html){
  const dom=new JSDOM(html,{url:"https://chatgpt.com/c/synthetic-identities",runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
  w.Element.prototype.getClientRects=function(){return this.isConnected?[{top:0,bottom:80,width:400,height:80}]:[];};
  w.ReaderVisible=m=>({body:m.body});w.FastTextExporter={};
  for(const file of ["extension/source-dom.js","reader/page-index.js"])w.eval(fs.readFileSync(path.join(__dirname,"..",file),"utf8"));
  return {w,source:w.ChatExportSourceDOM,index:w.ReaderPageIndex,close:()=>w.close()};
}
test("a partially mounted duplicate heading is not mistaken for the requested occurrence",()=>{
  const f=fixture('<article data-message-id="a" data-message-author-role="assistant"><h2>Repeated</h2></article>');
  try{
    const row={id:"a",role:"assistant",headings:[{text:"Repeated",level:2},{text:"Repeated",level:2}],files:[]};
    assert.equal(f.index.destination(f.w.document.querySelector("article"),row,{heading:0}),null,
      "The sole mounted heading could be the second occurrence.");
  }finally{f.close();}
});
test("hidden duplicate headings cannot shift a visible heading occurrence",()=>{
  const f=fixture('<article data-message-id="a" data-message-author-role="assistant"><section hidden><h2>Repeated</h2></section><h2 id="real">Repeated</h2></article>');
  try{
    const row={id:"a",headings:[{text:"Repeated",level:2}],files:[]};
    assert.equal(f.index.destination(f.w.document.querySelector("article"),row,{heading:0}).node.id,"real");
  }finally{f.close();}
});
test("busy remount hydration is not proof of a changed branch, while a settled live edit still is",()=>{
  const f=fixture('<main><article data-message-id="a" data-message-author-role="assistant"><p>Full answer</p></article></main>');
  try{
    f.source.remember({id:"a",role:"assistant"});f.source.verify({ids:new Set(["a"])});
    const before=f.index.sample(),main=f.w.document.querySelector("main");
    main.innerHTML='<article data-message-id="a" data-message-author-role="assistant" aria-busy="true"><p>Loading</p></article>';
    assert.equal(f.index.sample(),before);
    main.querySelector("p").textContent="Full";assert.equal(f.index.sample(),before);
    main.querySelector("p").textContent="Full answer";main.querySelector("article").removeAttribute("aria-busy");
    assert.equal(f.index.sample(),before);
    main.querySelector("p").textContent="Genuinely edited answer";assert.notEqual(f.index.sample(),before);
  }finally{f.close();}
});
test("nested role wrappers describe one message, not two identical navigation destinations",()=>{
  const f=fixture('<article data-message-id="a" data-message-author-role="assistant"><div data-message-author-role="assistant"><p>Answer</p></div></article>');
  try{
    f.source.remember({id:"a",role:"assistant"});assert.equal(f.source.mounted().length,1);
  }finally{f.close();}
});
test("a foreign explicit ID cannot be concealed by a simultaneous legacy identity attribute",()=>{
  const f=fixture('<article data-message-id="a" data-chatgpt-search-message-ids="a foreign" data-message-author-role="assistant">Answer</article>');
  try{
    f.source.remember({id:"a",role:"assistant"});assert.equal(f.source.verify({ids:new Set(["a"])}),false);
  }finally{f.close();}
});
test("sections retain actual heading parents and repeated occurrences without changing old heading objects",()=>{
  const f=fixture("");try{
    const row=f.index.fromBranch({messages:[{id:"a",role:"assistant",body:"# Top\n### Child\n### Child\n## Sibling\n# End"}]})[0];
    const sections=JSON.parse(JSON.stringify(f.index.sections(row)));
    assert.deepEqual(sections.map(s=>[s.index,s.level,s.parent,s.occurrence]),[[0,1,null,0],[1,3,0,0],[2,3,0,1],[3,2,0,0],[4,1,null,0]]);
    assert.deepEqual(sections.map(s=>s.target),Array.from(row.headings,(_,heading)=>({id:"a",heading})));
    assert.deepEqual(Object.keys(row.headings[0]).sort(),["level","text"]);
    const metadata=f.index.metadata(row);assert.deepEqual(JSON.parse(JSON.stringify(metadata.sections)),sections);
    assert.ok(!("body" in metadata));
  }finally{f.close();}
});
test("tree preserves leading answers, consecutive questions and distinct same-title answer identities",()=>{
  const f=fixture("");try{
    const rows=[["a0","assistant"],["q1","user"],["q2","user"],["a2","assistant"],["a3","assistant"]]
      .map(([id,role])=>({id,role,body:"Same title "+ "x".repeat(300),headings:[{text:"Repeated",level:2}],files:[]}));
    const tree=JSON.parse(JSON.stringify(f.index.tree(rows)));
    assert.deepEqual(tree.map(t=>[t.q?.id||null,t.answers.map(a=>a.id)]),[[null,["a0"]],["q1",[]],["q2",["a2","a3"]]]);
    assert.ok(tree.flatMap(t=>[t.q,...t.answers].filter(Boolean)).every(r=>!("body"in r)&&r.title.length<=220&&r.sections.length===1));
    assert.deepEqual(tree[2].answers.map(a=>a.sections[0].target),[{id:"a2",heading:0},{id:"a3",heading:0}]);
  }finally{f.close();}
});
test("hidden previous markdown and zero-opacity history cannot supply a destination or branch identity",()=>{
  const f=fixture('<main><article data-message-id="a" data-message-author-role="assistant"><div class="markdown" hidden><h2>Old</h2></div><div class="markdown"><h2>Live</h2></div></article><article data-message-id="foreign" data-message-author-role="assistant" style="opacity:0">Old answer</article></main>');
  try{
    const row=f.index.domRows()[0];assert.equal(row.body,"Live");assert.equal(row.headings[0].text,"Live");
    assert.equal(f.source.verify({ids:new Set(["a"])}),true);
    assert.equal(f.index.domRows().length,1);
  }finally{f.close();}
});
test("tree always retains an answer entry even when it has no heading or visible text",()=>{
  const f=fixture("");try{
    const tree=JSON.parse(JSON.stringify(f.index.tree([{id:"a",role:"assistant",body:"",headings:[],files:[{id:"file-a",name:"image.png",type:"image"}]}])));
    assert.equal(tree.length,1);assert.equal(tree[0].q,null);assert.equal(tree[0].answers[0].id,"a");
    assert.deepEqual(tree[0].answers[0].headings,[]);assert.deepEqual(tree[0].answers[0].sections,[]);
    assert.equal(tree[0].answers[0].files[0].id,"file-a");assert.ok(!("body"in tree[0].answers[0]));
  }finally{f.close();}
});
test("a visible text occurrence cannot borrow the identical context of two different source hits",()=>{
  const part="left ".repeat(17)+"needle"+" right".repeat(17),f=fixture(`<article data-message-id="a" data-message-author-role="assistant"><p>${part}</p></article>`);
  try{
    const row={id:"a",role:"assistant",body:part+"\n\n"+part,headings:[],files:[]},msg=f.w.document.querySelector("article");
    assert.equal(f.index.textTarget(msg,row,{query:"needle",occurrence:1}),null);
  }finally{f.close();}
});
test("a contradicted attachment ID cannot be replaced by a same-name file match",()=>{
  const f=fixture('<article data-message-id="a" data-message-author-role="assistant"><a download="x.pdf" data-file-id="other">x.pdf</a></article>');
  try{
    const row={files:[{name:"x.pdf",id:"requested"}]},msg=f.w.document.querySelector("article");
    const target=f.index.destination(msg,row,{file:0});assert.equal(target.kind,"message-fallback");assert.equal(target.node,msg);
  }finally{f.close();}
});
test("an alias colliding with another message ID cannot silently change navigation ownership",()=>{
  const f=fixture('<article data-message-id="shared" data-message-author-role="assistant">Answer</article>');
  try{
    f.source.remember({id:"first",role:"assistant",sourcePath:["shared"]});
    f.source.remember({id:"shared",role:"assistant",sourcePath:["other"]});
    assert.equal(f.source.idOf(f.w.document.querySelector("article")),undefined);
    assert.equal(f.source.mounted().length,0);
  }finally{f.close();}
});
test("hidden busy widgets do not disable live edit detection",()=>{
  const f=fixture('<article data-message-id="a" data-message-author-role="assistant"><p>Answer</p><aside hidden aria-busy="true"></aside></article>');
  try{
    const before=f.index.sample();f.w.document.querySelector("p").textContent="Edited answer";
    assert.notEqual(f.index.sample(),before);
  }finally{f.close();}
});
test("heading text preserves literal number signs, underscores and inline code identifiers",()=>{
  const f=fixture("");try{
    const row=f.index.fromBranch({messages:[{id:"a",role:"assistant",body:"# C#\n## build_id ###\n### `snake_case`\n#### **Bold**"}]})[0];
    assert.deepEqual(Array.from(row.headings,h=>h.text),["C#","build_id","snake_case","Bold"]);
  }finally{f.close();}
});
