// Synthetic reconstruction of the redacted 2026-11-26 DOM shape supplied by
// main. No account, transcript text or real identity is stored in this fixture.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom");
function fixture(){
  const question=(id)=>`<div data-chatgpt-search-message-ids="${id}"><div data-content-search-unit-key><div class="whitespace-pre-wrap">Question ${id}</div></div></div>`;
  const answer=(id,count)=>`<div data-chatgpt-search-message-ids="${id} ${id}"><h4 class="sr-only" data-conversation-role="assistant" tabindex="-1">Assistant label</h4><div data-response-body>${Array.from({length:count},(_,i)=>`<h2 id="${id}-h${i}">Section ${i}</h2><p>Paragraph ${i}</p>`).join("")}</div></div>`;
  const dom=new JSDOM(`<main><div><div><div>${question("n1")+answer("n2",11)+question("n3")+answer("n4",16)}</div></div></div></main>`,
    {url:"https://chatgpt.com/c/synthetic-response-dom",runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
  w.Element.prototype.checkVisibility=function(){return this.isConnected&&!this.closest("[hidden]");};
  w.Element.prototype.getClientRects=function(){return [{top:0,bottom:80,width:768,height:80}];};
  for(const file of ["extension/source-dom.js","reader/page-index.js"])w.eval(fs.readFileSync(path.join(__dirname,"..",file),"utf8"));
  const source=w.ChatExportSourceDOM,index=w.ReaderPageIndex;
  const rows=[["q1","user","n1"],["a1","assistant","n2"],["q2","user","n3"],["a2","assistant","n4"]]
    .map(([id,role,alias])=>({id,role,sourcePath:[alias]}));
  const remember=()=>rows.forEach(source.remember);
  return {w,source,index,rows,remember,close:()=>w.close()};
}
test("bare new repeated IDs and conversation-role labels identify real message containers without legacy roles or turn articles",()=>{
  const f=fixture();try{
    assert.equal(f.w.document.querySelectorAll("article,[data-testid^='conversation-turn'],[data-message-author-role],[data-message-id]").length,0);
    assert.deepEqual(Array.from(f.source.mounted(),el=>[f.source.idOf(el),f.source.roleOf(el),el.tagName]),
      [["n2","assistant","DIV"],["n4","assistant","DIV"]],"Explicit role labels are evidence, not the tiny landing nodes.");
    f.remember();
    assert.equal(f.source.verify({ids:new Set(f.rows.map(r=>r.id)),identities:new Set(["n1","n2","n3","n4",...f.rows.map(r=>r.id)])}),true);
    assert.deepEqual(Array.from(f.source.mounted(),el=>[f.source.idOf(el),f.source.roleOf(el)]),
      [["q1","user"],["a1","assistant"],["q2","user"],["a2","assistant"]]);
  }finally{f.close();}
});
test("response body excludes sr-only role headings and preserves all 11/16 actual section ordinals",()=>{
  const f=fixture();try{
    f.remember();const rows=f.index.domRows(),a=rows[1],b=rows[3],container=f.source.mounted()[1];
    assert.equal(a.headings.length,11);assert.equal(b.headings.length,16);
    assert.equal(a.headings[0].text,"Section 0");assert.ok(!a.body.includes("Assistant label"));
    assert.equal(f.source.surface(container),container.querySelector("[data-response-body]"));
    assert.equal(f.index.destination(container,a,{heading:10}).node.id,"n2-h10");
    container.querySelector("[data-conversation-role]").textContent="Localized assistant label";
    const sample=f.index.sample();
    container.querySelector("[data-conversation-role]").textContent="Another label";
    assert.equal(f.index.sample(),sample,"Non-body role label changes do not invalidate source bodies.");
  }finally{f.close();}
});
test("a response body takes precedence over one nested markdown fragment",()=>{
  const f=fixture();try{
    f.remember();const container=f.source.mounted()[1],body=container.querySelector("[data-response-body]");
    body.firstElementChild.className="markdown";
    assert.equal(f.source.surface(container),body);assert.equal(f.index.domRows()[1].headings.length,11);
    body.hidden=true;const replacement=f.w.document.createElement("div");replacement.dataset.responseBody="";
    replacement.innerHTML="<h2>Replacement body</h2>";container.append(replacement);
    assert.equal(f.source.surface(container),replacement);
  }finally{f.close();}
});
test("explicit conversation-role contradictions and mixed role labels fail closed, never borrow the API role",()=>{
  const f=fixture();try{
    f.remember();const accepted={ids:new Set(["n1","n2","n3","n4",...f.rows.map(r=>r.id)])},container=f.source.mounted()[1];
    container.querySelector("[data-conversation-role]").dataset.conversationRole="user";
    assert.equal(f.source.idOf(container),undefined);assert.equal(f.source.verify(accepted),false);
    container.dataset.messageAuthorRole="assistant";
    assert.equal(f.source.idOf(container),undefined);assert.equal(f.source.verify(accepted),false);
    container.querySelector("[data-conversation-role]").dataset.conversationRole="assistant";
    assert.equal(f.source.idOf(container),"a1");assert.equal(f.source.verify(accepted),true);
  }finally{f.close();}
});
