// Actual capture/readBranch + Fork + random source-file rows + navigation.
// All source responses and DOM nodes are synthetic. No real session or network.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom");
const root=path.resolve(__dirname,"..");
function fixture(){
  const long="x".repeat(2*1024*1024+17)+"\n"+Array.from({length:111},(_,i)=>`Long ${i} targetneedle`).join("\n");
  const mapping={};
  for(let i=0;i<129;i++){
    const message={id:`m${i}`,author:{role:i%2?"assistant":"user"},content:{content_type:"text",parts:[i?`Message ${i} targetneedle`:long]}};
    if(i===3)message.metadata={model_dil_v2:{fallbackMarkdown:"Static UI targetneedle",compiled:"RAW_PROGRAM_NOT_FOR_NAVIGATION"}};
    mapping[`n${i}`]={parent:i?`n${i-1}`:null,children:i<128?[`n${i+1}`]:[],message};
  }
  const raw=JSON.stringify({conversation_id:"synthetic-navigation",title:"Synthetic navigation source",current_node:"n128",mapping});
  const dom=new JSDOM('<main data-current-node-id="n128"><article data-testid="conversation-turn-0"><div data-message-id="m0" data-message-author-role="user"><p>Mounted leading text</p></div></article></main>',
    {url:"https://chatgpt.com/c/synthetic-navigation",pretendToBeVisual:true,runScripts:"outside-only"});
  const w=dom.window,requests=[],progress=[];let overlay;
  Object.assign(w,{TextEncoder,TextDecoder,Blob,Response,Headers,ReadableStream,TransformStream,AbortController,
    ReaderOverlay(options){overlay=options;},ReaderSourceControl(){},
    chrome:{runtime:{sendMessage(){throw Error("Navigation must not contact Reader.");},connect(){throw Error("Navigation must not upload.");}}},
    fetch:async input=>{
      const u=new URL(input,"https://chatgpt.com");requests.push(u.pathname);
      if(u.pathname==="/api/auth/session")return Response.json({accessToken:"synthetic-test-only"});
      if(u.pathname==="/backend-api/conversation/synthetic-navigation")
        return new Response(raw,{headers:{"Content-Length":String(Buffer.byteLength(raw))}});
      throw Error("Unexpected synthetic request: "+u.pathname);
    }});
  w.Element.prototype.getClientRects=function(){return [{top:0,left:0,bottom:40,right:300,width:300,height:40}];};
  for(const file of ["extension/locales/en.js","extension/i18n.js","extension/fast-text.js","extension/source-dom.js",
                    "reader/progress.js","reader/visible.js","reader/source-file.js","reader/page-index.js","reader/capture.js"])
    w.eval(fs.readFileSync(path.join(root,file),"utf8"));
  return {w,long,requests,progress,rawBytes:Buffer.byteLength(raw),read:(ctl,observe)=>overlay.read(ctl,step=>{progress.push(step);observe?.(step);}),close:()=>w.close()};
}

test("global navigation indexes the branch without full conversions; chapter and file reads stay independent",async t=>{
  const f=fixture();try{
    const api=f.w.FastTextExporter,original=api.records;let conversions=0;
    api.records=(messages,options)=>{conversions+=messages.length;return original(messages,options);};
    const data=await f.read(new AbortController());
    assert.equal(conversions,0,"global conversion count");
    assert.ok(data.rows.every(row=>!row.headings&&!row.sections&&!row.files));
    assert.equal(data.rows[0].title.length,220);assert.equal(data.rows[3].title,"");
    const chapters=await data.loadChapters("m3");assert.equal(chapters.length,0);
    assert.equal(conversions,1);
    assert.equal((await data.loadFiles("m126")).length,0);assert.equal(conversions,1);
    const metrics=f.w.ReaderPageIndex.metrics();assert.equal(metrics.source.indexConversions,0);
    assert.equal(metrics.source.rows,129);assert.equal(metrics.source.chapterParses,1);
    t.diagnostic(JSON.stringify({fixture:"129-source-messages",...metrics.source}));
  }finally{f.close();}
});
test("latest capture navigation keeps metadata only, reuses one Blob, and search cancellation does not invalidate later random reads",async()=>{
  const f=fixture();try{
    const owner=new AbortController(),data=await f.read(owner),index=f.w.ReaderPageIndex;
    assert.equal(data.rows.length,129);assert.equal(data.complete,true);
    assert.ok(data.rows.every(r=>!("body"in r)&&!("dil"in r)&&!("compiled"in r)));
    assert.ok(!JSON.stringify(data.rows).includes("RAW_PROGRAM_NOT_FOR_NAVIGATION"));
    assert.ok(f.progress.some(p=>p.stage==="source"&&p.done===f.rawBytes));
    assert.ok(f.progress.some(p=>p.stage==="index"&&p.done===129));
    assert.equal(owner.signal.aborted,false);
    const before=f.requests.length,ctl=new AbortController();
    await assert.rejects(index.search(data.rows,data.loadBody,"targetneedle",{
      signal:ctl.signal,onProgress:()=>ctl.abort()
    }),/abort/i);
    assert.equal(owner.signal.aborted,false,"Abandoning a search must not destroy the retained source.");
    assert.equal(await data.loadBody("m0",new AbortController().signal),f.long);
    const result=await index.search(data.rows,data.loadBody,"targetneedle");
    assert.equal(result.total,239);assert.equal(result.hits.length,64);
    assert.ok(result.hits[0].start>2*1024*1024);
    const last=await index.search(data.rows,data.loadBody,"targetneedle",{index:result,page:result.cursors.length-1});
    assert.equal(last.hits.at(-1).id,"m128");
    assert.equal(f.requests.length,before,"Random reads and later searches must reuse the original Blob.");
    assert.equal(f.requests.filter(p=>p==="/backend-api/conversation/synthetic-navigation").length,1);
    assert.equal(f.requests.filter(p=>p==="/api/auth/session").length,1);
  }finally{f.close();}
});

test("capture navigation survives ordinary history mounting but refuses changed content, route and explicit branch",async()=>{
  for(const change of ["content","route","branch"]){
    const f=fixture();try{
      const data=await f.read(new AbortController()),index=f.w.ReaderPageIndex,version=index.sample(),main=f.w.document.querySelector("main");
      const article=f.w.document.createElement("article");article.dataset.testid="conversation-turn-128";
      article.innerHTML='<div data-message-id="m128" data-message-author-role="user"><p>Mounted older message</p></div>';
      main.append(article);assert.equal(index.sample(),version);
      f.w.document.querySelector('[data-testid="conversation-turn-0"]').remove();assert.equal(index.sample(),version);
      assert.match(await data.loadBody("m128"),/Message 128 targetneedle/);
      if(change==="content")article.querySelector("p").textContent="Edited source text";
      else if(change==="route")f.w.history.pushState({},"","/c/other-synthetic");
      else main.dataset.currentNodeId="a-different-leaf";
      await assert.rejects(data.loadBody("m128"),/Source changed/);
      assert.equal(f.requests.filter(p=>p==="/backend-api/conversation/synthetic-navigation").length,1);
    }finally{f.close();}
  }
});

test("a stationary source is fully sampled at read boundaries, not once per source span and message",async()=>{
  const f=fixture();try{
    const api=f.w.ReaderPageIndex,sample=api.sample;let scans=0;
    api.sample=(...args)=>{scans++;return sample(...args);};
    const result=await f.read(new AbortController());
    assert.equal(result.rows.length,129);assert.equal(result.complete,true);
    assert.ok(scans>0&&scans<=8,`stationary mounted transcript was scanned ${scans} times`);
    assert.ok(f.progress.some(p=>p.stage==="index"&&p.done===129));
    assert.ok(f.progress.some(p=>p.stage==="messages"&&p.done===129),"building the outline is a separate measured phase");
  }finally{f.close();}
});

test("the final navigation boundary refuses a last-moment edit or a contradictory mounted role",async()=>{
  for(const change of ["body","role"]){
    const f=fixture();let changed=false;
    try{
      await assert.rejects(f.read(new AbortController(),step=>{
        if(step.stage!=="messages"||step.done!==129||changed)return;
        changed=true;const node=f.w.document.querySelector("[data-message-id]");
        if(change==="body")node.querySelector("p").textContent="An intervening edit";
        else node.dataset.messageAuthorRole="assistant";
      }),/changed|branch/i);
      assert.equal(changed,true);
    }finally{f.close();}
  }
});

test("a single large source header yields to a queued stop before it builds the outline",async()=>{
  const f=fixture(),ctl=new AbortController();try{
    let clock=0,turns=0,stopAt=null;
    Object.defineProperty(f.w.performance,"now",{value:()=>clock+=12});
    f.w.scheduler={yield:()=>new Promise(resolve=>f.w.setTimeout(()=>{turns++;resolve();},0))};
    await assert.rejects(f.read(ctl,step=>{
      if(step.checkedBytes>0&&!stopAt){
        assert.equal(step.checkTotal,f.rawBytes);assert.equal(step.pages,1);
        assert.match(f.w.ReaderProgress.describe(step,true),/核对来源.*KiB.*MiB/);
        stopAt=step.checkedBytes;f.w.setTimeout(()=>ctl.abort(),0);
      }
    }),/abort/i);
    assert.ok(turns&&stopAt<f.rawBytes);assert.equal(f.progress.some(p=>p.stage==="messages"),false);
  }finally{f.close();}
});
