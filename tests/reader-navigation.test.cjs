const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {JSDOM}=require("jsdom");
const source=name=>fs.readFileSync(path.join(__dirname,"../reader",name),"utf8");
function page(body=""){
  const dom=new JSDOM(body,{url:"https://chatgpt.com/c/synthetic-navigation",pretendToBeVisual:true,runScripts:"outside-only"});
  const w=dom.window;
  w.Element.prototype.getClientRects=function(){return [{top:0,left:0,bottom:40,right:300,width:300,height:40}];};
  w.ReaderVisible=m=>({body:m.body});w.FastTextExporter={};
  w.eval(fs.readFileSync(path.join(__dirname,"../extension/source-dom.js"),"utf8"));w.eval(source("page-index.js"));
  return {w,index:w.ReaderPageIndex,close:()=>w.close()};
}
test("literal navigation matches retain Unicode text offsets, all repeated hits and regex punctuation",()=>{
  const p=page();try{
    const body="🚀 潮汐 [x] first\n潮汐 [x] second\n潮汐 [x] third";
    const hits=[...p.index.matches(body,"潮汐 [x]")];
    assert.equal(hits.length,3);assert.deepEqual(hits.map(h=>body.slice(h.start,h.end)),Array(3).fill("潮汐 [x]"));
    assert.deepEqual(hits.map(h=>h.occurrence),[0,1,2]);
    assert.equal([...p.index.matches(body,"")].length,0);
    assert.equal([...p.index.matches("word\n break","word break")].length,1);
  }finally{p.close();}
});
test("search resolves a real Range in the requested repeated occurrence, including inline elements",()=>{
  const p=page('<div data-message-id="a" data-message-author-role="assistant"><div class="markdown"><p>First 潮<b>汐</b> answer.</p><p>Second 潮<b>汐</b> answer.</p></div></div>');
  try{
    const msg=p.w.document.querySelector("[data-message-id]"),row=p.index.domRows()[0];
    const found=p.index.textTarget(msg,row,{query:"潮汐",occurrence:1});
    assert.ok(found);assert.equal(found.range.toString(),"潮汐");
    assert.match(found.range.startContainer.parentElement.textContent,/Second/);
    assert.equal(p.index.destination(msg,row,{query:"潮汐",occurrence:1}).kind,"text");
    assert.equal(p.index.textTarget(msg,row,{query:"潮汐",occurrence:2}),null);
  }finally{p.close();}
});
test("unverifiable duplicate search text does not fall back to an unrelated first hit or message",()=>{
  const p=page('<div data-message-id="a" data-message-author-role="assistant"><p>Other 潮汐 wording.</p><p>Other 潮汐 wording.</p></div>');
  try{
    const msg=p.w.document.querySelector("[data-message-id]"),row={body:"Original 潮汐 wording.",headings:[],files:[]};
    assert.equal(p.index.textTarget(msg,row,{query:"潮汐",occurrence:0}),null);
    assert.equal(p.index.destination(msg,row,{query:"潮汐",occurrence:0}),null);
  }finally{p.close();}
});
test("duplicate attachment names use file identity; unknown identity is an explicitly typed message fallback",()=>{
  const p=page('<div data-message-id="a" data-message-author-role="assistant"><a download="same.pdf" data-file-id="file-one">same.pdf</a><a download="same.pdf" data-file-id="file-two">same.pdf</a></div>');
  try{
    const msg=p.w.document.querySelector("[data-message-id]"),row=p.index.domRows()[0];
    const found=p.index.destination(msg,row,{file:1});
    assert.equal(found.kind,"file");assert.equal(found.node.dataset.fileId,"file-two");
    row.files.forEach(f=>{f.id="";});
    const fallback=p.index.destination(msg,row,{file:1});
    assert.equal(fallback.kind,"message-fallback");assert.equal(fallback.node,msg);
    assert.equal(p.index.destination(msg,row,{file:4}),null);
  }finally{p.close();}
});
test("headings keep real Setext and ATX hierarchy but exclude fenced examples",()=>{
  const p=page();try{
    const rows=p.index.fromBranch({messages:[{id:"a",role:"assistant",body:"Title\n=====\n## Child\n```md\n# Not a section\n```\nLast\n----"}]});
    assert.deepEqual(JSON.parse(JSON.stringify(rows[0].headings)),[{text:"Title",level:1},{text:"Child",level:2},{text:"Last",level:2}]);
  }finally{p.close();}
});
test("statistic values and widget chrome are not chapters; meaningful numbered headings survive DOM and source merging",()=>{
  const p=page(`<article data-message-id="a" data-message-author-role="assistant"><div class="markdown">
    <h2>三维无人机状态空间规模</h2><div><small>状态数量</small><h2>9,000</h2></div>
    <div><h3>54,000</h3><h3>0.216 MB</h3></div>
    <div role="dialog"><h2>Settings</h2></div><div role="toolbar"><h2>Controls</h2></div>
    <table><tr><td><h3>Table label</h3></td></tr></table><pre><h2>Example</h2></pre>
    <h3>2. 状态设计</h3><h3>2026 年计划</h3><h3>100 MB 的容量限制</h3>
    </div></article>`);
  try{
    const expected=["三维无人机状态空间规模","2. 状态设计","2026 年计划","100 MB 的容量限制"];
    assert.deepEqual(Array.from(p.index.domRows()[0].headings,h=>h.text),expected);
    const rows=p.index.fromBranch({messages:[{id:"a",role:"assistant",body:
      "## 三维无人机状态空间规模\n## 9,000\n### 54,000\n### 0.216 MB\n### 2. 状态设计\n### 2026 年计划\n### 100 MB 的容量限制"}]});
    assert.deepEqual(Array.from(rows[0].headings,h=>h.text),expected);
    assert.deepEqual(Array.from(p.index.mergeMounted(rows)[0].headings,h=>h.text),expected);
  }finally{p.close();}
});
test("file-backed navigation scans 50001 messages and a >2 MiB body without retaining bodies or dropping later matches",async()=>{
  const p=page();try{
    const rows=Array.from({length:50001},(_,i)=>p.index.metadata({id:`m${i}`,role:i%2?"assistant":"user",body:`Question ${i}`,headings:[],files:[]}));
    assert.ok(rows.every(r=>!Object.hasOwn(r,"body")&&!Object.hasOwn(r,"dil")));
    const long="x".repeat(2*1024*1024+17)+"\n"+Array.from({length:111},(_,i)=>`long ${i} targetneedle`).join("\n");
    let calls=0,active=0,peak=0;
    const load=async(id,signal)=>{signal?.throwIfAborted();calls++;active++;peak=Math.max(peak,active);
      await Promise.resolve();active--;return id==="m0"?long:`Question ${id}: targetneedle`;};
    const first=await p.index.search(rows,load,"targetneedle",{signal:new AbortController().signal});
    assert.equal(calls,50001);assert.equal(peak,1);assert.equal(first.total,50111);assert.equal(first.hits.length,64);
    assert.equal(first.hits[0].id,"m0");assert.ok(first.hits[0].start>2*1024*1024);
    assert.equal(first.cursors.length,Math.ceil(first.total/64));
    assert.ok(first.hits.every(h=>h.before.length+h.match.length+h.after.length<=100&&!Object.hasOwn(h,"body")));
    assert.ok(JSON.stringify(first).length<60000,"Retain only sparse cursors and one page, never all text/snippets.");
    const second=await p.index.search(rows,load,"targetneedle",{index:first,page:1});
    assert.equal(second.total,50111);assert.equal(second.hits.length,64);assert.equal(second.hits[0].occurrence,64);
    assert.equal(second.hits[46].occurrence,110);assert.equal(second.hits[47].id,"m1");
    const before=calls,last=await p.index.search(rows,load,"targetneedle",{index:first,page:first.cursors.length-1});
    assert.equal(last.hits.at(-1).id,"m50000");assert.equal(last.total,50111);assert.ok(calls-before<=64,"A later page resumes from its sparse cursor.");
    const firstKeys=new Set(first.hits.map(h=>`${h.id}:${h.occurrence}`));
    assert.ok(second.hits.every(h=>!firstKeys.has(`${h.id}:${h.occurrence}`)));
  }finally{p.close();}
});
test("body scanning is cancellable between batches and never reads for an empty query",async()=>{
  const p=page();try{
    const rows=Array.from({length:50001},(_,i)=>({id:`m${i}`,role:"user"})),ctl=new AbortController();let calls=0;
    const load=async()=>{calls++;return "search text";};
    const empty=await p.index.search(rows,load," ");assert.equal(calls,0);assert.equal(empty.total,0);
    await assert.rejects(p.index.search(rows,load,"absent",{signal:ctl.signal,onProgress:()=>ctl.abort()}),/abort/i);
    assert.equal(calls,64);
  }finally{p.close();}
});

function grants(){
  const id="a".repeat(32),dynamic="bbbbbbbb-cccc-dddd-eeee-ffffffffffff",data={},listeners=[],pages=new Map([[1,{id:1,url:"https://chatgpt.com/c/synthetic",active:true,doc:"source-doc"}]]);
  const storage={async get(key){return key===null?{...data}:{[key]:data[key]};},async set(v){Object.assign(data,v);},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};
  const c=vm.createContext({URL,URLSearchParams,Date,crypto:require("node:crypto").webcrypto,
    ReaderClient:{trust:Promise.resolve()},ReaderRoutes:{eligible:p=>p==="/c/synthetic"},
    navigator:{locks:{request:async(_name,fn)=>fn()}},source:s=>s.id===id&&s.frameId===0&&!!s.documentId,
    chrome:{runtime:{id,getURL:name=>`chrome-extension://${name==="frame.html"?dynamic:id}/${name}`,onMessage:{addListener(fn){listeners.push(fn);}}},
      storage:{session:storage,local:storage},action:{onClicked:{addListener(){}}},
      tabs:{async get(tab){return pages.get(tab);},async sendMessage(tab,m,options){const p=pages.get(tab);return {current:p?.doc===options.documentId&&new URL(p.url).pathname===m.path};},
        create:async v=>v,onRemoved:{addListener(){}}}}});
  vm.runInContext(source("surfaces.js"),c);
  const send=(m,s)=>new Promise(resolve=>listeners[0](m,s,resolve));
  const top={id,tab:pages.get(1),frameId:0,documentId:"source-doc",url:pages.get(1).url};
  const child={id,tab:pages.get(1),frameId:3,documentId:"frame-doc",url:`chrome-extension://${id}/frame.html#unused`};
  return {id,c,data,pages,top,child,send};
}
test("dynamic WAR sender is accepted only with the stable authenticated extension origin and a one-use live-parent grant",async()=>{
  const e=grants(),ticket=await e.send({kind:"frame-ticket",path:"/c/synthetic"},e.top);
  assert.ok(ticket.ticket);
  for(const patch of [{id:"z".repeat(32)},{frameId:0},{documentId:undefined},{url:"https://chatgpt.com/frame.html"},{url:`chrome-extension://${e.id}/frame.html?bypass=1`}])
    assert.deepEqual(JSON.parse(JSON.stringify(await e.send({kind:"frame-claim",ticket:ticket.ticket},{...e.child,...patch}))),{});
  assert.equal((await e.send({kind:"frame-claim",ticket:ticket.ticket},e.child)).ok,true);
  assert.ok(e.data["frame:frame-doc"]);assert.equal(e.data["surface:"+ticket.ticket],undefined);
  assert.equal((await e.send({kind:"frame-claim",ticket:ticket.ticket},{...e.child,documentId:"second-frame"})).ok,undefined);
});
test("expired, other-tab and replaced parent document tickets cannot authorize a frame",async()=>{
  for(const scenario of ["expiry","tab","document","route"]){
    const e=grants(),{ticket}=await e.send({kind:"frame-ticket",path:"/c/synthetic"},e.top);
    let child=e.child;
    if(scenario==="expiry")e.data["surface:"+ticket].expires=0;
    if(scenario==="tab")child={...child,tab:{id:2}};
    if(scenario==="document")e.pages.get(1).doc="replaced-doc";
    if(scenario==="route")e.pages.get(1).url="https://chatgpt.com/c/other";
    assert.equal((await e.send({kind:"frame-claim",ticket},child)).ok,undefined,scenario);
    assert.equal(e.data["frame:frame-doc"],undefined,scenario);
  }
});
test("a previously authorized frame loses host action permission when its parent changes",async()=>{
  const e=grants(),{ticket}=await e.send({kind:"frame-ticket",path:"/c/synthetic"},e.top);
  await e.send({kind:"frame-claim",ticket},e.child);
  const host={id:e.id,url:`chrome-extension://${e.id}/host.html`};
  assert.equal(await e.send({kind:"panel-allowed",tab:1,doc:"frame-doc"},host),true);
  e.pages.get(1).doc="new-doc";
  assert.equal(await e.send({kind:"panel-allowed",tab:1,doc:"frame-doc"},host),false);
});
