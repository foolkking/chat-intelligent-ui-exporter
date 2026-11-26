// Numeric-only observations. These tests never open a browser or send a request.
const test=require("node:test"),assert=require("node:assert/strict");
require("../reader/progress.js");
require("../reader/upload.js");
require("../reader/transfer-state.js");

test("progress retains the legacy step contract and allowlists explicit cumulative measurements",()=>{
  const old={stage:"asset",done:7,total:12,files:2};
  assert.deepEqual(ReaderProgress.snapshot({...old,title:"private",url:"https://private.invalid"}),old);
  const values={sourceBytes:101,sourcePages:2,indexedNodes:6,messageCount:3,textBytes:40,
    assetBytes:19,filesStarted:2,filesSucceeded:1,filesFailed:1,filesDiscovered:4,filesTotal:4,
    unresolvedResources:5,packageBytes:201,uploadBytes:100,serverProgress:55};
  assert.deepEqual(ReaderProgress.snapshot({...old,...values,token:"private"}),{...old,...values});
  const bad=ReaderProgress.snapshot({stage:"source",done:3,total:2,sourceBytes:NaN,sourcePages:-1,
    textBytes:Infinity,assetBytes:1.5,filesTotal:"4",uploadBytes:Number.MAX_SAFE_INTEGER+1,serverProgress:101});
  assert.deepEqual(bad,{stage:"source",done:3});
});

test("accumulation merges explicit counters, never adds resetting page/file done counters",()=>{
  let stats={};
  for(const step of [
    {stage:"source",pages:1,done:100,sourceBytes:100,sourcePages:1},
    {stage:"index",done:3},
    {stage:"source",pages:2,done:7,sourceBytes:107,sourcePages:2},
    {stage:"index",done:5},
    {stage:"asset",files:1,done:11,assetBytes:11,filesStarted:1,filesDiscovered:2},
    {stage:"asset",files:2,done:2,assetBytes:13,filesStarted:2,filesSucceeded:1},
    {stage:"asset",files:2,done:2,assetBytes:13,filesStarted:2,filesSucceeded:1},
    {stage:"messages",done:1,messageCount:1,textBytes:8,filesFailed:1,unresolvedResources:3}
  ])stats=ReaderProgress.accumulate(stats,step);
  assert.deepEqual(stats,{sourceBytes:107,sourcePages:2,indexedNodes:5,assetBytes:13,
    filesStarted:2,filesDiscovered:2,filesSucceeded:1,messageCount:1,textBytes:8,filesFailed:1,unresolvedResources:3});
  assert.equal("filesTotal" in stats,false,"identified resources do not establish the final total");
  assert.deepEqual(ReaderProgress.accumulate({}, {stage:"asset",files:9,done:123,total:456}),{});
  assert.deepEqual(ReaderProgress.accumulate(stats,{sourceBytes:1,assetBytes:1,indexedNodes:1}),stats);
  assert.equal(ReaderProgress.accumulate(stats,{filesTotal:2}).filesTotal,2);
});

test("restored measurements are sanitized and server offsets/percent are authoritative, not summed",()=>{
  const before=Object.freeze({sourceBytes:10,uploadBytes:9,serverProgress:75,title:"private",id:"private"});
  const next=Object.freeze({uploadBytes:4,serverProgress:20,sourceBytes:8,key:"private",error:"private"});
  assert.deepEqual(ReaderProgress.accumulate(before,next),{sourceBytes:10,uploadBytes:4,serverProgress:20});
  assert.deepEqual(ReaderProgress.accumulate(null,{serverProgress:-1,sourceBytes:Infinity}),{});
  assert.deepEqual(ReaderProgress.accumulate({uploadBytes:4},{uploadBytes:"5"}),{uploadBytes:4});
  assert.deepEqual(ReaderProgress.accumulate({}, {serverProgress:0}),{serverProgress:0});
});

test("throttling carries explicit cumulative counters across superseded updates without inventing old-call metrics",()=>{
  const seen=[],report=ReaderProgress.throttle(step=>seen.push(step),60000);
  report.update({stage:"asset",files:1,done:0,assetBytes:0,filesStarted:1});
  report.update({stage:"asset",files:1,done:11,assetBytes:11,filesSucceeded:1});
  report.update({stage:"asset",files:2,done:0,filesStarted:2});
  report.update({stage:"asset",files:2,done:13,assetBytes:24,filesFailed:1});
  report.update({stage:"messages",done:1,messageCount:1,textBytes:9});
  report.flush();report.close();
  assert.equal(seen.at(-1).assetBytes,24);
  assert.equal(seen.at(-1).filesStarted,2);
  assert.equal(seen.at(-1).filesSucceeded,1);
  assert.equal(seen.at(-1).filesFailed,1);
  assert.equal(seen.at(-1).messageCount,1);
  assert.equal(seen.at(-1).textBytes,9);
  const legacy=[],old=ReaderProgress.throttle(step=>legacy.push(step),60000);
  old.update({stage:"source",done:0});old.update({stage:"index",done:4});old.close();
  assert.deepEqual(legacy,[{stage:"source",done:0},{stage:"index",done:4}]);
});

test("diagnostics are a finite enum projection, never raw messages, identities or arbitrary status/code",()=>{
  assert.deepEqual(ReaderProgress.diagnostic({category:"conflict",stage:"upload",status:409,
    code:"READER_TRANSFER_OFFSET",message:"private",title:"private",key:"private",token:"private",url:"private"}),
  {category:"conflict",stage:"upload",status:409,code:"READER_TRANSFER_OFFSET"});
  assert.deepEqual(ReaderProgress.diagnostic({category:"unknown",stage:"private",status:799,code:"private"}),
    {category:"unknown"});
  assert.equal(ReaderProgress.diagnostic({category:"private",error:"private"}),null);
  assert.equal(ReaderProgress.diagnostic(null),null);
});

test("upload reports only acknowledged bytes, with stable machine codes for impossible receipts",async()=>{
  const file=new Blob(["abc"]),steps=[],calls=[];
  const request=async(route)=>{
    calls.push(route);
    return {json:async()=>calls.length===1?{id:null}:calls.length===2?
      {size:3,offset:1,chunk_bytes:2}:calls.length===3?{size:3,offset:3}:{id:"accepted"}};
  };
  assert.equal((await ReaderUpload({key:"synthetic",file,binding:{size:3},request,report:p=>steps.push(p)})).id,"accepted");
  assert.deepEqual(steps,[{stage:"upload",done:1,total:3,uploadBytes:1},{stage:"upload",done:3,total:3,uploadBytes:3}]);
  let n=0;
  await assert.rejects(ReaderUpload({key:"synthetic",file,binding:{size:3},report(){},
    request:async()=>({json:async()=>++n===1?{}:{size:3,offset:4,chunk_bytes:2}})}),
  e=>e.code==="UPLOAD_RECEIPT_INVALID");
  n=0;
  await assert.rejects(ReaderUpload({key:"synthetic",file,binding:{size:3},report(){},
    request:async()=>({json:async()=>++n===1?{}:n===2?{size:3,offset:0,chunk_bytes:3}:{size:3,offset:2}})}),
  e=>e.code==="UPLOAD_OFFSET_INVALID");
});

test("server progress is bounded and does not certify completion; raw failure detail is never projected",()=>{
  for(const n of [-1,101,Infinity,"80",null]){
    const s=ReaderTransferState({status:"processing",progress:n,error:"private",title:"private"});
    assert.equal(s.phase,"processing");assert.equal(s.percent,null);
    assert.equal("title" in s,false);assert.equal("error" in s,false);
  }
  assert.equal(ReaderTransferState({status:"processing",progress:100}).phase,"processing");
  assert.equal(ReaderTransferState({status:"processing",progress:100}).percent,100);
  assert.equal(ReaderTransferState({status:"queued",progress:0}).percent,0);
  const failure=ReaderTransferState({status:"failed",progress:80,error:"private"});
  assert.equal(failure.active,false);
  assert.deepEqual(failure.diagnostic,{category:"server",stage:"server"});
});

test("nullable backend failure uses finite code/stage/recovery contracts and corruption never requests same-artifact retry",()=>{
  assert.equal(ReaderProgress.failure(null),null);
  for(const recovery of ["retry_existing","free_storage","reconnect","review_in_reader","system_support"]){
    const value={code:"IMPORT_STORAGE_FULL",stage:"file",recovery,details:"private",retryable:true};
    assert.deepEqual(ReaderProgress.failure(value),{category:"server",code:value.code,stage:"file",recovery});
  }
  const invalid={code:"READER_PACKAGE_INVALID",stage:"archive",recovery:"retry_existing",details:"private",key:"private"};
  assert.deepEqual(ReaderProgress.failure(invalid),{category:"server",code:"READER_PACKAGE_INVALID",stage:"archive",recovery:"system_support"});
  assert.deepEqual(ReaderTransferState({status:"failed",failure:invalid}).diagnostic,ReaderProgress.failure(invalid));
  assert.deepEqual(ReaderProgress.failure({code:"PRIVATE",stage:"private",recovery:"retry_existing"}),
    {category:"server",code:"TASK_FAILED",stage:"analysis",recovery:"system_support"});
  assert.deepEqual(ReaderProgress.failure({code:"SOURCE_CHANGED",stage:"private",recovery:"retry_existing"}),
    {category:"server",code:"TASK_FAILED",stage:"analysis",recovery:"system_support"});
});

function recoveryModel({lose="chunk",always=false,stopStatus,badAck=false}={}){
  const file=new Blob(["abcdef"]),binding={size:6,sha256:"a".repeat(64),project:null,excerpt:false};
  const calls=[],sent=[],steps=[],begins=[];let offset=0,accepted=false,lost=false,finishes=0,retries=0;
  const request=async(route,opts={})=>{
    calls.push(route);
    if(always)throw TypeError("Synthetic network loss");
    if(route==="requests/synthetic")return {json:async()=>({id:accepted?"received":null})};
    if(route==="transfers/synthetic"){
      begins.push(opts.body);
      if(stopStatus)throw Object.assign(Error("Synthetic rejected admission"),{status:stopStatus});
      return {json:async()=>({size:6,offset,chunk_bytes:3})};
    }
    if(route.endsWith("/chunks")){
      const at=Number(opts.body.get("offset"));sent.push(at);assert.equal(at,offset);
      offset+=opts.body.get("chunk").size;
      if(lose==="chunk"&&!lost){lost=true;throw TypeError("Synthetic lost chunk response");}
      return {json:async()=>({size:6,offset:badAck?offset-1:offset})};
    }
    if(route.endsWith("/finish")){
      finishes++;accepted=true;
      if(lose==="finish"&&!lost){lost=true;throw TypeError("Synthetic lost finish response");}
      return {json:async()=>({id:"received"})};
    }
    throw Error("Unexpected synthetic endpoint");
  };
  const run=options=>ReaderUpload({key:"synthetic",file,binding,request,report:s=>steps.push(s),
    retryLimit:2,onRetry(){retries++;},...options});
  return {run,calls,sent,steps,begins,binding,get retries(){return retries;},get finishes(){return finishes;}};
}

test("opt-in automatic lost-chunk recovery reads receipt and durable offset before sending the next bytes",async()=>{
  const m=recoveryModel();assert.equal((await m.run()).id,"received");
  assert.deepEqual(m.calls,["requests/synthetic","transfers/synthetic","transfers/synthetic/chunks",
    "requests/synthetic","transfers/synthetic","transfers/synthetic/chunks","transfers/synthetic/finish"]);
  assert.deepEqual(m.sent,[0,3]);assert.deepEqual(m.steps.map(p=>p.uploadBytes),[0,3,6]);
  assert.equal(m.retries,1);assert.equal(m.finishes,1);assert.equal(new Set(m.begins).size,1);
});

test("automatic lost-finish recovery accepts only the original receipt, without a second finish/admission",async()=>{
  const m=recoveryModel({lose:"finish"});assert.equal((await m.run()).id,"received");
  assert.equal(m.calls.at(-1),"requests/synthetic");assert.equal(m.begins.length,1);
  assert.equal(m.finishes,1);assert.equal(m.retries,1);assert.deepEqual(m.sent,[0,3]);
});

test("automatic network recovery is capped at two cycles, while the default still leaves retry to the caller",async()=>{
  const m=recoveryModel({always:true});
  await assert.rejects(m.run({retryLimit:100}),e=>e.code==="NETWORK_UNAVAILABLE");
  assert.equal(m.retries,2);assert.deepEqual(m.calls,Array(3).fill("requests/synthetic"));
  const old=recoveryModel();await assert.rejects(old.run({retryLimit:0}),/lost chunk response/);
  assert.equal(old.retries,0);assert.deepEqual(old.sent,[0]);
});

test("automatic recovery stops on auth, semantic conflict, integrity rejection and impossible acknowledgement",async()=>{
  for(const status of [401,403,409,422]){
    const m=recoveryModel({stopStatus:status});
    await assert.rejects(m.run(),e=>e.status===status);assert.equal(m.retries,0);
    assert.deepEqual(m.calls,["requests/synthetic","transfers/synthetic"]);assert.deepEqual(m.sent,[]);
  }
  const invalid=recoveryModel({lose:null,badAck:true});
  await assert.rejects(invalid.run(),e=>e.code==="UPLOAD_OFFSET_INVALID");
  assert.equal(invalid.retries,0);assert.deepEqual(invalid.sent,[0]);
});

test("automatic recovery freezes the authorized binding and abort cannot initiate another request",async()=>{
  const m=recoveryModel();
  assert.equal((await m.run({onRetry(){m.binding.project="different-target";}})).id,"received");
  assert.equal(new Set(m.begins).size,1);assert.equal(JSON.parse(m.begins[1]).project,null);
  const controller=new AbortController(),aborted=recoveryModel();
  await assert.rejects(aborted.run({signal:controller.signal,onRetry(){controller.abort();}}),e=>e.name==="AbortError");
  assert.deepEqual(aborted.calls,["requests/synthetic","transfers/synthetic","transfers/synthetic/chunks"]);
});
