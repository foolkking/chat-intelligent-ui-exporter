// Real host/reducer/upload code with in-memory OPFS, locks and HTTP responses only.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const {webcrypto}=require("node:crypto");
const device="00000000-0000-4000-8000-000000000001",key="00000000-0000-4000-8000-000000000002";
const iid="00000000-0000-4000-8000-000000000003",cid="00000000-0000-4000-8000-000000000004";
const batch="00000000-0000-4000-8000-000000000005";
const stats={sourceBytes:70,sourcePages:2,indexedNodes:4,messageCount:2,textBytes:12,
  assetBytes:5,filesStarted:2,filesSucceeded:1,filesFailed:1,filesDiscovered:2,filesTotal:2,unresolvedResources:3,packageBytes:3};
const turn=()=>new Promise(r=>setImmediate(r));

async function environment({accepted=false,patch={},response,server={status:"processing",progress:25},batchPlan=null}={}){
  const body=new Blob(["zip"]),calls=[],listeners=[],writes=[],directories=new Set([key]);
  let current=device,jobs=[{key,device,batch,sourceKey:"synthetic",phase:"uploading",active:true,packageReady:true,
    binding:{size:3,sha256:"a".repeat(64),project:null,excerpt:false},mode:"save",
    stats:structuredClone(stats),step:{stage:"package",done:3,packageBytes:3},startedAt:1234,finishedAt:null,...patch}];
  const root={async *[Symbol.asyncIterator](){for(const name of directories)yield [name,{}];},
    async removeEntry(name){directories.delete(name);},
    async getDirectoryHandle(name){if(!directories.has(name))throw Object.assign(Error("synthetic missing file"),{name:"NotFoundError"});
      return {async getFileHandle(){return {async getFile(){return body;}};}};}};
  const tails=new Map(),locks={request(name,options,fn){
    const f=fn||options;
    if(options?.ifAvailable&&tails.has(name))return Promise.resolve(f(null));
    const next=(tails.get(name)||Promise.resolve()).catch(()=>{}).then(()=>f({name}));
    tails.set(name,next);
    return next.finally(()=>{if(tails.get(name)===next)tails.delete(name);});
  }};
  const env=vm.createContext({console,URL,Blob,Response,FormData,TextEncoder,TextDecoder,performance,crypto:webcrypto,
    READER_ORIGIN:"https://reader.example.test",setTimeout,clearTimeout,setInterval(){},clearInterval(){},
    navigator:{storage:{getDirectory:async()=>root},locks},
    fetch:async(url,opts={})=>{
      const route=new URL(url).pathname.replace("/api/extension/v1/","");
      calls.push({route,method:opts.method||"GET"});
      const override=await response?.(route,opts);if(override)return override;
      if(route==="requests/"+key)return Response.json({id:accepted?iid:null});
      if(route==="imports/"+iid)return Response.json(server);
      if(route==="transfers/"+key)return Response.json({size:3,offset:0,chunk_bytes:3});
      if(route==="transfers/"+key+"/chunks")return Response.json({size:3,offset:3});
      if(route==="transfers/"+key+"/finish"){accepted=true;return Response.json({id:iid});}
      throw Error("Unexpected synthetic route");
    },
    chrome:{runtime:{id:"synthetic",getURL:name=>"chrome-extension://synthetic/"+name,
      onConnect:{addListener(){}},onMessage:{addListener(fn){listeners.push(fn);}},
      async sendMessage(m){
        let value;
        if(m.op==="jobs")value=structuredClone(jobs);
        else if(m.op==="batch")value=batchPlan;
        else if(m.op==="device")value=current;
        else if(m.op==="saveJobs"){jobs=structuredClone(m.jobs).filter(j=>j.device===current);writes.push(structuredClone(jobs));}
        else if(m.op==="access")value="synthetic";
        else throw Error("Unexpected synthetic RPC");
        return {value};
      }}}
  });
  for(const name of ["progress.js","upload.js","transfer-state.js","host.js"])
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../reader",name),"utf8"),env,{filename:name});
  await vm.runInContext("initialized",env);
  const command=op=>new Promise((resolve,reject)=>{
    const message={kind:"panel-host",op,device,key};
    for(const fn of listeners)if(fn(message,{id:"synthetic",url:"chrome-extension://synthetic/panel.html"},
      r=>r.error?reject(Error(r.error)):resolve(r)))break;
  });
  return {env,calls,writes,directories,job:()=>jobs[0],all:()=>jobs,command,
    tick:()=>vm.runInContext("tick()",env),setDevice:d=>{current=d;},
    evaluate:code=>vm.runInContext(code,env),async settled(){await turn();await locks.request("reader-jobs",()=>{});}};
}

test("restored sealed and batch-owned jobs retain counters/times/step while receipt reconciliation prevents retransmission",async()=>{
  const e=await environment({accepted:true,batchPlan:{id:batch}});
  await e.tick();
  assert.deepEqual(e.calls.map(c=>c.route),["requests/"+key]);
  assert.equal(e.job().phase,"received");assert.equal(e.job().batch,batch);
  assert.equal(e.job().startedAt,1234);assert.equal(e.job().finishedAt,null);
  assert.equal(e.job().step.stage,"package");
  assert.deepEqual(e.job().stats,{...stats,uploadBytes:3});
  assert.equal(e.job().packageReady,false);assert.equal(e.directories.has(key),false);
});

test("pause/resume preserves totals and startedAt, drains pending progress, and does not erase the received step",async()=>{
  const e=await environment();await e.tick();
  assert.equal(e.job().phase,"upload-paused");
  assert.deepEqual(e.job().stats,stats);assert.equal(e.job().startedAt,1234);
  assert.ok(Number.isSafeInteger(e.job().finishedAt));
  await e.command("check");await e.settled();
  assert.equal(e.job().phase,"received");assert.equal(e.job().finishedAt,null);
  assert.equal(e.job().stats.uploadBytes,3);assert.equal(e.job().stats.sourceBytes,70);
  assert.equal(e.job().step.stage,"upload");assert.equal(e.job().step.done,3);
  const count=e.writes.length;await new Promise(r=>setTimeout(r,20));
  assert.equal(e.writes.length,count,"close drains writes; a timer cannot write after the transition");
});

test("host aggregates before display throttling and seals a stopped record without raw diagnostic data",async()=>{
  const e=await environment({patch:{phase:"reading",packageReady:false,binding:null,stats:{},step:null}});
  await e.evaluate(`globalThis.report=displayProgress("${key}","${device}");
    report.update({stage:"source",done:100,sourceBytes:100,sourcePages:1});
    report.update({stage:"index",done:5});
    report.update({stage:"asset",files:1,done:4,assetBytes:4,filesStarted:1});
    report.update({stage:"asset",files:2,done:3,assetBytes:7,filesStarted:2,filesSucceeded:1});
    report.update({stage:"messages",done:2,messageCount:2,textBytes:12,filesFailed:1});
    report.close();`);
  await e.evaluate(`ledger("${key}",{phase:"capture-interrupted",active:false,
    diagnostic:{category:"source",stage:"source",code:"CAPTURE_INTERRUPTED",message:"private",key:"private"}})`);
  assert.deepEqual(e.job().stats,{sourceBytes:100,sourcePages:1,indexedNodes:5,
    assetBytes:7,filesStarted:2,filesSucceeded:1,filesFailed:1,messageCount:2,textBytes:12});
  assert.equal(e.job().step.stage,"messages");
  assert.deepEqual(e.job().diagnostic,{category:"source",stage:"source",code:"CAPTURE_INTERRUPTED"});
  assert.ok(Number.isSafeInteger(e.job().finishedAt));assert.equal(e.job().startedAt,1234);
});

test("stale device progress cannot recreate an old task or alter the next account",async()=>{
  const e=await environment();
  await e.evaluate(`globalThis.report=displayProgress("${key}","${device}");
    report.update({stage:"source",done:1,sourceBytes:1});`);
  await e.settled();e.setDevice(null);
  await e.evaluate(`report.update({stage:"source",done:2,sourceBytes:2});report.close();`);
  assert.equal(e.writes.at(-1)[0].stats.sourceBytes,70);
  assert.equal(e.all().length,1,"no saveJobs call runs on behalf of the detached owner");
});

test("safe HTTP conflict diagnostics retain the exact package and never store server detail",async()=>{
  const e=await environment({patch:{active:false,phase:"upload-paused"},response(route,opts){
    if(route==="transfers/"+key&&opts.method==="POST")
      return Response.json({detail:{code:"READER_TRANSFER_OFFSET",message:"private secret",source_id:"private"}},{status:409});
  }});
  await e.command("check");
  assert.equal(e.job().packageReady,true);assert.ok(e.job().binding);assert.equal(e.directories.has(key),true);
  assert.deepEqual(e.job().diagnostic,{category:"conflict",stage:"upload",status:409,code:"READER_TRANSFER_OFFSET"});
  assert.equal(e.job().stats.sourceBytes,70);assert.ok(Number.isSafeInteger(e.job().finishedAt));
  assert.doesNotMatch(JSON.stringify(e.job().diagnostic),/private|secret/);
  assert.equal(e.calls.some(c=>c.route.endsWith("/chunks")),false);
});

test("legacy jobs without metrics remain resumable; server progress, failures and completion retain transport facts",async()=>{
  const legacy=await environment({patch:{stats:undefined,startedAt:undefined,step:{stage:"package",done:3}}});
  await legacy.tick();await legacy.command("check");
  assert.equal(legacy.job().phase,"received");assert.equal(legacy.job().stats.uploadBytes,3);
  assert.ok(Number.isSafeInteger(legacy.job().startedAt));
  assert.equal("sourceBytes" in legacy.job().stats,false,"unknown legacy counters are not invented");
  const base={iid,packageReady:false,binding:null,phase:"received",stats:{...stats,uploadBytes:3}};
  const running=await environment({patch:base,server:{status:"processing",progress:100}});
  await running.tick();
  assert.equal(running.job().phase,"processing");assert.equal(running.job().stats.serverProgress,100);
  assert.equal(running.job().finishedAt,null);
  const failed=await environment({patch:base,server:{status:"failed",error:"private",progress:10}});
  await failed.tick();
  assert.equal(failed.job().phase,"attention");assert.deepEqual(failed.job().stats,base.stats);
  assert.deepEqual(failed.job().diagnostic,{category:"server",stage:"server"});
  assert.ok(Number.isSafeInteger(failed.job().finishedAt));
  const complete=await environment({patch:base,server:{status:"committed",conversation_id:cid,
    result:{version:1,completeness:"partial"},title:"synthetic title"}});
  await complete.tick();
  assert.equal(complete.job().phase,"done");assert.equal(complete.job().result.completeness,"partial");
  assert.deepEqual(complete.job().stats,base.stats);assert.equal(complete.job().startedAt,1234);
  assert.ok(Number.isSafeInteger(complete.job().finishedAt));assert.equal(complete.job().diagnostic,null);
});

test("startup/tick retain stopped diagnostics and restore only safe backend failure recovery",async()=>{
  const diagnostic={category:"protocol",stage:"upload",code:"UPLOAD_OFFSET_INVALID"};
  const e=await environment({patch:{active:false,phase:"upload-paused",finishedAt:2345,diagnostic}});
  await e.tick();
  assert.deepEqual(e.job().diagnostic,diagnostic);assert.deepEqual(e.job().stats,stats);
  assert.equal(e.job().finishedAt,2345);assert.deepEqual(e.calls,[]);
  const backend=await environment({patch:{iid,packageReady:false,binding:null,phase:"received"},
    server:{status:"failed",failure:{code:"READER_PACKAGE_INVALID",stage:"archive",recovery:"retry_existing",message:"private"}}});
  await backend.tick();
  assert.deepEqual(backend.job().diagnostic,{category:"server",code:"READER_PACKAGE_INVALID",stage:"archive",recovery:"system_support"});
  const failed=structuredClone(backend.job());await backend.tick();
  assert.deepEqual(backend.job(),failed,"inactive failure is not overwritten by a later poll");
  const interrupted=await environment({patch:{phase:"reading",packageReady:false,binding:null,
    step:{stage:"asset",done:2,files:1},stats:{assetBytes:2,filesStarted:1}}});
  await interrupted.tick();
  assert.equal(interrupted.job().phase,"capture-interrupted");
  assert.deepEqual(interrupted.job().diagnostic,{category:"source",stage:"asset",code:"CAPTURE_INTERRUPTED"});
  assert.equal(interrupted.job().stats.assetBytes,2);
});

test("append status check is read-only even on retry, applies measured results, and cannot invent completeness or waits",async()=>{
  const patch={mode:"append",iid,phase:"append-ready",active:false,packageReady:false,binding:null};
  for(const [fields,expected,active,result] of [
    [{status:"committed"},"append-complete",false,null],
    [{status:"committed",result:{added:2,skipped:1,partial:true,private:"ignore"}},"append-complete",false,{added:2,skipped:1,partial:true}],
    [{status:"committed",result:{added:null,skipped:0,partial:false}},"append-complete",false,null],
    [{status:"queued",phase:"waiting_resources",progress:16,wait:{reason:"UPLOAD_QUEUE_FULL",remaining_seconds:10}},"resource-wait",true,null],
    [{status:"queued",phase:"waiting_resources",progress:150,wait:{reason:"private"}},"processing",true,null],
    [{status:"failed",failure:{code:"APPEND_REVIEW_CHANGED",stage:"commit",recovery:"review_in_reader"}},"append-attention",false,null],
  ]){
    const e=await environment({patch,server:{mode:"selective_append",...fields}});
    await e.command("check");
    assert.deepEqual(e.calls,[{route:"imports/"+iid,method:"GET"}]);assert.equal(e.job().phase,expected);
    assert.equal(e.job().active,active);assert.deepEqual(e.job().appendResult,result);
    if(expected==="resource-wait")assert.equal(e.job().stats.serverProgress,16);
    if(fields.status==="failed")assert.equal(e.job().diagnostic.recovery,"review_in_reader");
    assert.doesNotMatch(JSON.stringify(e.job()),/private|ignore/);
  }
});
test("host enables bounded network recovery and clears its transient diagnostic only after the accepted receipt",async()=>{
  let offset=0,losses=0;
  const e=await environment({patch:{active:false,phase:"upload-paused"},response(route,opts){
    if(route==="transfers/"+key&&opts.method==="POST")return Response.json({size:3,offset,chunk_bytes:3});
    if(route==="transfers/"+key+"/chunks"){
      offset=3;if(!losses++){throw TypeError("Synthetic lost durable acknowledgement");}
    }
  }});
  await e.command("check");
  assert.equal(e.job().phase,"received");assert.equal(e.job().stats.uploadBytes,3);assert.equal(e.job().diagnostic,null);
  assert.ok(e.writes.some(list=>list[0]?.diagnostic?.category==="network"));
  assert.equal(e.calls.filter(c=>c.route.endsWith("/chunks")).length,1);
  assert.equal(e.calls.filter(c=>c.route.endsWith("/finish")).length,1);
});
