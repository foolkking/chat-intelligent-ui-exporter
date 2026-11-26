const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
require("../reader/append-picker.js");
const rows=n=>Array.from({length:n},(_,i)=>({id:"synthetic-"+i,role:i%2?"assistant":"user",title:"Synthetic "+i}));
test("append defaults select every message without submitting or truncating at 250",()=>{
  for(const n of [249,250,251,1001]){
    const input=rows(n),m=ReaderExcerpt.model(input);
    assert.equal(m.picks.size,n);
    assert.equal(ReaderExcerpt.selected(input,m.picks,true,{extended:true}).length,n);
    if(n>250)assert.throws(()=>ReaderExcerpt.selected(input,m.picks,true));
  }
});
test("turn, role, inversion and cross-page intervals keep source order and only chosen question relationships",()=>{
  const input=rows(1001),m=ReaderExcerpt.model(input);m.apply("none");
  assert.equal(m.interval(10,18),true);assert.equal(m.picks.size,18);
  assert.deepEqual([...m.picks],Array.from({length:18},(_,i)=>18+i));
  m.turn(11,false);assert.equal(m.picks.size,16);
  m.apply("assistant");assert.equal(m.picks.size,500);
  m.apply("invert");assert.equal(m.picks.size,501);
  m.apply("none");m.range(29,20,true);assert.equal(m.picks.size,10);
  const chosen=ReaderExcerpt.selected(input,m.picks,true,{extended:true});
  assert.deepEqual(chosen.map(x=>x.row.id),Array.from({length:10},(_,i)=>"synthetic-"+(20+i)));
  assert.equal(chosen[1].question,"synthetic-20");
  m.picks.delete(20);assert.equal(ReaderExcerpt.selected(input,m.picks,true,{extended:true})[0].question,null);
  assert.equal(m.interval(0,2),false);assert.equal(m.interval(1,9999),false);
  assert.equal(m.range(99999,0),false);
});
test("leading answers and consecutive questions form distinct real turns",()=>{
  const m=ReaderExcerpt.model([{role:"assistant"},{role:"assistant"},{role:"user"},{role:"user"},{role:"assistant"}]);
  assert.deepEqual(m.turns,[{start:0,end:2},{start:2,end:3},{start:3,end:5}]);
  m.picks.delete(1);assert.deepEqual(m.turnState(0),{count:1,total:2,checked:false,partial:true});
});
test("the selector preserves all choices through pages, permits complete preview and gates legacy submission",async()=>{
  const {JSDOM}=require("jsdom"),dom=new JSDOM("<button id=before>Before</button>",{runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window,roots=[],attach=w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow=function(o){const r=attach.call(this,o);roots.push(r);return r;};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.eval(fs.readFileSync(path.join(__dirname,"../reader/append-picker.js"),"utf8"));
  try{
    const input=rows(251),reads=[],ctl=new w.AbortController(),promise=w.ReaderExcerpt.choose(input,"Synthetic",async m=>{reads.push(m.id);return "Complete body for "+m.id;},ctl.signal);
    const root=roots[0];assert.equal(root.querySelector(".next").disabled,true);
    assert.match(root.querySelector(".notice").textContent,/legacy append contract/);
    assert.equal(reads.length,0,"Metadata display does not read every body");
    const fold=root.querySelector(".turn-fold");fold.onclick();
    assert.equal(fold.getAttribute("aria-expanded"),"false");
    assert.ok([...root.querySelector(".group").querySelectorAll(".message")].every(row=>row.hidden));
    assert.match(root.querySelector("nav span").textContent,/251 \/ 251/,"folding does not clear selection");
    assert.equal(reads.length,0,"folding cannot trigger a body preview");
    root.querySelector("nav button:last-child").onclick();assert.equal(root.querySelector("input[data-index]").dataset.index,"24");
    const detail=root.querySelector("details");detail.open=true;await detail.ontoggle();
    assert.equal(reads.length,1);assert.match(detail.querySelector("pre").textContent,/Complete body/);
    root.querySelector("nav button:first-of-type").onclick();
    assert.equal(root.querySelector(".turn-fold").getAttribute("aria-expanded"),"false","collapse survives paging");
    assert.equal(root.querySelector("input[data-index]").checked,true);
    const clear=[...root.querySelectorAll(".tools button")].find(b=>b.textContent==="Clear");clear.onclick();
    assert.match(root.querySelector("nav span").textContent,/0 \/ 251/);
    const check=root.querySelector("input[data-index]");check.checked=true;check.onchange();
    assert.equal(root.querySelector(".next").disabled,false);
    root.querySelector(".next").onclick({isTrusted:true});
    assert.deepEqual([...await promise],[0]);
  }finally{w.close();}
});
