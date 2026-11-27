// Host lifecycle contract with a simulated OPFS/runtime and server. No network or browser profile.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const crypto=require("node:crypto"),hostId="a".repeat(32),base="chrome-extension://"+hostId+"/";
const device="00000000-0000-4000-8000-000000000001",key="00000000-0000-4000-8000-000000000002";
const iid="00000000-0000-4000-8000-000000000003",orphan="00000000-0000-4000-8000-000000000004";
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const turn=()=>new Promise(r=>setImmediate(r));
async function environment({accepted=false,initialPatch={},beforeRequest,onLock}={}){
  const body=new Blob(["synthetic sealed ZIP"]),calls=[],requests=[],events=[],listeners=[],timers=[];
  const directories=new Map([[key,new Map([["import.zip",body]])],[orphan,new Map([["body.tmp",new Blob(["incomplete"])]])]]);
  let jobs=[{key,device,sourceKey:"synthetic",phase:"uploading",active:true,packageReady:true,mode:"save",
    binding:{size:body.size,sha256:crypto.createHash("sha256").update("synthetic sealed ZIP").digest("hex"),project:null,excerpt:false},...initialPatch}];
  let current=device;
  const state={patchJob:patch=>Object.assign(jobs[0],patch),setDevice:value=>{current=value;}};
  const root={
    async *[Symbol.asyncIterator](){for(const entry of directories)yield entry;},
    async removeEntry(name){directories.delete(name);},
    async getDirectoryHandle(name){
      if(!directories.has(name))throw Object.assign(Error("Missing staged file"),{name:"NotFoundError"});
      return {async getFileHandle(file){return {async getFile(){return directories.get(name).get(file);}};}};
    }
  };
  const fetch=async(url,opts={})=>{
    const p=new URL(url).pathname.replace("/api/extension/v1/","");
    calls.push(p);requests.push({path:p,method:opts.method||"GET"});
    const override=await beforeRequest?.(p,opts,state);
    if(override)return override;
    if(p==="requests/"+key){
      events.push({when:"receipt-request",step:jobs[0]?.step});
      return Response.json({id:accepted?iid:null});
    }
    if(p==="transfers/"+key&&opts.method==="DELETE")return new Response(null,{status:404});
    if(p==="transfers/"+key)return Response.json({id:null,size:body.size,offset:0,chunk_bytes:4*1024*1024});
    if(p==="transfers/"+key+"/chunks")return Response.json({size:body.size,offset:body.size});
    if(p==="transfers/"+key+"/finish"){accepted=true;return Response.json({id:iid});}
    if(p==="imports/"+iid)return Response.json({status:"analyzing",phase:"queued"});
    throw Error("Unexpected simulated request "+p);
  };
  const lockTails=new Map(),locks={request(name,options,fn){
    const f=fn||options;
    if(options?.ifAvailable&&lockTails.has(name))return Promise.resolve(f(null));
    const next=(lockTails.get(name)||Promise.resolve()).catch(()=>{}).then(async()=>{
      await onLock?.(name,state);return f({name});
    });
    lockTails.set(name,next);
    return next.finally(()=>{if(lockTails.get(name)===next)lockTails.delete(name);});
  }};
  const env=vm.createContext({console,URL,Blob,Response,FormData,TextEncoder,TextDecoder,performance,crypto:crypto.webcrypto,
    READER_ORIGIN:"https://reader.example.test",fetch,setTimeout,clearTimeout,
    setInterval(fn){timers.push(fn);return timers.length;},clearInterval(){},
    navigator:{storage:{getDirectory:async()=>root},locks},
    chrome:{runtime:{id:hostId,getURL:f=>base+f,onConnect:{addListener(){}},
      onMessage:{addListener(fn){listeners.push(fn);}},
      async sendMessage(m){
        let value;
        if(m.op==="jobs")value=structuredClone(jobs);
        else if(m.op==="batch")value=null;
        else if(m.op==="saveJobs")jobs=m.jobs.filter(j=>j.device===current);
        else if(m.op==="device")value=current;
        else if(m.op==="access"){assert.equal(m.device,current);value="synthetic-token";}
        else throw Error("Unexpected host RPC "+m.op);
        return {value};
      }}}
  });
  for(const name of ["progress.js","upload.js","transfer-state.js","host.js"])
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../reader",name),"utf8"),env,{filename:name});
  await vm.runInContext("initialized",env);
  const send=message=>new Promise((resolve,reject)=>{
    for(const fn of listeners)if(fn(message,{id:hostId,url:base+"panel.html"},r=>r.error?reject(Error(r.error)):resolve(r)))break;
  });
  return {env,calls,requests,events,directories,...state,jobs:()=>jobs,
    tick:()=>vm.runInContext("tick()",env),
    resume:()=>send({kind:"panel-host",device,op:"check",key}),
    discard:()=>send({kind:"panel-host",device,op:"discard",key}),
    cleanup:()=>vm.runInContext("forgetDetachedDevice()",env),
    async disconnect(){
      current=null;jobs=[];
      await vm.runInContext("forgetDetachedDevice()",env);
    }};
}

test("a lost response is reconciled automatically from the original receipt without a second upload",async()=>{
  let lookups=0;
  const e=await environment({beforeRequest(route){
    if(route==="requests/"+key){
      if(++lookups===1)return Response.json({}, {status:503});
      return Response.json({id:iid});
    }
  }});
  await e.tick();
  assert.ok(e.jobs()[0].nextCheckAt>Date.now());await e.tick();assert.equal(lookups,1);
  e.patchJob({nextCheckAt:Date.now()-1});await Promise.all([e.tick(),e.tick()]);
  assert.equal(e.jobs()[0].iid,iid);assert.equal(e.jobs()[0].phase,"received");
  assert.equal(lookups,2);assert.equal(e.requests.filter(r=>r.method==="POST").length,0);
});
test("a confirmed sealed upload resumes from its durable offset; shared failures have a finite retry budget",async()=>{
  const e=await environment();
  await e.tick();assert.equal(e.jobs()[0].phase,"upload-paused");assert.ok(e.jobs()[0].nextCheckAt>Date.now());
  e.patchJob({nextCheckAt:Date.now()-1});await e.tick();
  assert.equal(e.jobs()[0].iid,iid);assert.equal(e.calls.filter(p=>p.endsWith("/finish")).length,1);
  const outage=await environment({beforeRequest(){return new Response(null,{status:503,headers:{"Retry-After":"120"}});}});
  await outage.tick();assert.ok(outage.jobs()[0].nextCheckAt>=Date.now()+119000);
  for(let i=0;i<2;i++){outage.patchJob({nextCheckAt:Date.now()-1});await outage.tick();}
  assert.equal(outage.jobs()[0].autoChecks,2);assert.equal(outage.jobs()[0].nextCheckAt,null);
  await outage.tick();assert.equal(outage.calls.length,3);assert.ok(outage.jobs()[0].packageReady);
});
test("permanent errors and explicit decisions never schedule background submissions",async()=>{
  for(const status of [401,403,409,413,422,507]){
    const e=await environment({beforeRequest(){return new Response(null,{status});}});
    await e.tick();await e.tick();assert.ok(!e.jobs()[0].nextCheckAt);assert.equal(e.calls.length,1);
  }
  const e=await environment({initialPatch:{packageReady:false,iid,phase:"received"},beforeRequest(){
    return Response.json({status:"ready",review:{action:"conflict",receipt:"synthetic-receipt"}});
  }});
  await e.tick();await e.tick();assert.equal(e.jobs()[0].phase,"review");assert.ok(!e.jobs()[0].nextCheckAt);
  assert.ok(e.requests.every(r=>r.method==="GET"));
});
test("an incomplete receipt response cannot authorize a new submission",async()=>{
  for(const response of [{},{id:"invalid"},null]){
    const e=await environment({initialPatch:{active:false,phase:"upload-paused"},beforeRequest(){return Response.json(response);}});
    await e.resume();
    assert.equal(e.requests.length,1);assert.ok(e.requests.every(r=>r.method==="GET"));
    assert.equal(e.jobs()[0].diagnostic.code,"UPLOAD_RECEIPT_INVALID");
    assert.ok(!e.jobs()[0].nextCheckAt);assert.ok(e.directories.has(key));
  }
});
test("a delayed accepted receipt after switching owners cannot erase retained bytes",async()=>{
  const e=await environment({beforeRequest(route,opts,state){
    if(route==="requests/"+key){state.setDevice("replacement-owner");return Response.json({id:iid});}
  }});
  await e.tick();assert.ok(e.directories.has(key));assert.equal(e.requests.length,1);
  assert.equal(e.jobs()[0].iid,undefined);
});
test("scheduled recovery rechecks cancellation under the OPFS lock and stops malformed budgets",async()=>{
  let cancel=false;
  const e=await environment({initialPatch:{phase:"upload-paused",active:false,nextCheckAt:Date.now()-1},
    onLock(name,state){if(cancel&&name==="reader-local-"+key){cancel=false;state.patchJob({phase:"cancelled",nextCheckAt:null,packageReady:false});}}});
  cancel=true;await e.tick();assert.deepEqual(e.calls,[]);assert.equal(e.jobs()[0].phase,"cancelled");
  for(const count of [-1,2,"1",2.5]){
    const held=await environment({initialPatch:{phase:"check",active:false,nextCheckAt:Date.now()-1,autoChecks:count}});
    await held.tick();assert.deepEqual(held.calls,[]);assert.equal(held.jobs()[0].nextCheckAt,null);
    assert.ok(held.directories.has(key));
  }
});
test("a transient HTTP status carrying a semantic error never retries the same invalid artifact",async()=>{
  const e=await environment({beforeRequest(){return Response.json({detail:{code:"READER_PACKAGE_INVALID"}},{status:503});}});
  await e.tick();await e.tick();
  assert.equal(e.calls.length,1);assert.ok(!e.jobs()[0].nextCheckAt);
  assert.equal(e.jobs()[0].diagnostic.recovery,"system_support");
});
test("host restart keeps a sealed package but deletes unfinished capture; it queries before an explicit resume",async()=>{
  const e=await environment();
  assert.ok(e.directories.has(key));assert.ok(!e.directories.has(orphan));
  await e.tick();
  assert.deepEqual(e.calls,["requests/"+key]);
  assert.equal(e.jobs()[0].phase,"upload-paused");assert.equal(e.jobs()[0].packageReady,true);
  assert.equal(e.jobs()[0].active,false);
  await e.resume();
  assert.equal(e.jobs()[0].iid,iid);assert.equal(e.jobs()[0].packageReady,false);
  assert.ok(!e.directories.has(key));
  assert.equal(e.calls.filter(p=>p==="transfers/"+key+"/finish").length,1);
  // When delivery has taken over, even the receipt lookup is already labelled upload.
  const snapshots=e.events.filter(x=>x.step?.stage==="upload");
  assert.ok(snapshots.length>0);
});

test("host restart reconciles an accepted receipt without re-uploading, even when its final response was lost",async()=>{
  const e=await environment({accepted:true});await e.tick();
  assert.deepEqual(e.calls,["requests/"+key]);
  assert.equal(e.jobs()[0].iid,iid);assert.equal(e.jobs()[0].phase,"received");
  assert.equal(e.jobs()[0].packageReady,false);assert.ok(!e.directories.has(key));
});

test("disconnecting the Reader account removes its retained plaintext package without a network request",async()=>{
  const e=await environment();await e.disconnect();
  assert.equal(e.directories.size,0);assert.deepEqual(e.calls,[]);
});

test("discard and resume are serialized; a cancelled package cannot be uploaded by a waiting check",{timeout:3000},async()=>{
  const reached=deferred(),releaseCancel=deferred(),releaseUpload=deferred();let first=true;
  const e=await environment({initialPatch:{active:false,phase:"upload-paused"},
    async beforeRequest(p,opts){
      if(p==="requests/"+key&&first){first=false;reached.resolve();await releaseCancel.promise;}
      if(p==="transfers/"+key&&opts.method==="POST")await releaseUpload.promise;
    }});
  let resume;
  try{
    const cancel=e.discard();await reached.promise;
    resume=e.resume();await turn();await turn();
    releaseCancel.resolve();assert.deepEqual(structuredClone(await cancel),{ok:true});
    releaseUpload.resolve();await resume;
    assert.equal(e.jobs()[0].phase,"cancelled");
    assert.equal(e.jobs()[0].iid,undefined);
    assert.equal(e.jobs()[0].packageReady,false);
    assert.equal(e.jobs()[0].binding,null);
    assert.ok(!e.directories.has(key));
    assert.equal(e.requests.some(r=>r.method==="POST"),false,"resume must re-read the cancelled ledger under the same lock");
  }finally{releaseCancel.resolve();releaseUpload.resolve();await resume?.catch(()=>{});}
});

test("a discard waiting behind an accepted upload cannot cancel or overwrite its receipt",{timeout:3000},async()=>{
  const reached=deferred(),release=deferred();
  const e=await environment({initialPatch:{active:false,phase:"upload-paused"},
    async beforeRequest(p,opts){
      if(p==="transfers/"+key&&opts.method==="POST"){reached.resolve();await release.promise;}
    }});
  const resume=e.resume();await reached.promise;
  const discarded=e.discard().then(()=>({ok:true}),error=>({error}));
  try{
    await turn();release.resolve();await resume;
    assert.ok((await discarded).error,"an already accepted import cannot be reported as cancelled");
    assert.equal(e.jobs()[0].iid,iid);assert.equal(e.jobs()[0].phase,"received");
    assert.equal(e.requests.some(r=>r.method==="DELETE"),false);
  }finally{release.resolve();await resume.catch(()=>{});}
});

test("check re-reads the ledger after its local lock, not the earlier panel snapshot",async()=>{
  let cancelAtLock=false;
  const e=await environment({initialPatch:{active:false,phase:"upload-paused"},
    onLock(name,state){
      if(cancelAtLock&&name==="reader-local-"+key){
        cancelAtLock=false;state.patchJob({phase:"cancelled",active:false,packageReady:false,binding:null});
      }
    }});
  cancelAtLock=true;await e.resume();
  assert.equal(cancelAtLock,false,"check must acquire the per-item OPFS lock");
  assert.equal(e.jobs()[0].phase,"cancelled");assert.deepEqual(e.calls,[]);
});

test("startup cleanup keeps a package sealed after the original ledger snapshot but before the OPFS lock",async()=>{
  let sealed=false;
  const e=await environment({initialPatch:{phase:"reading",active:true,packageReady:false},
    onLock(name,state){
      if(name==="reader-local-"+key&&!sealed){
        sealed=true;state.patchJob({phase:"upload-paused",active:false,packageReady:true});
      }
    }});
  assert.equal(sealed,true);assert.ok(e.directories.has(key),"freshly sealed package must survive cleanup");
  assert.ok(!e.directories.has(orphan),"unowned unfinished data is still removed");
  assert.equal(e.jobs()[0].packageReady,true);assert.deepEqual(e.calls,[]);
});

test("device cleanup re-reads sealed packages after the OPFS lock instead of using an old retained set",async()=>{
  let sealAtLock=false;
  const e=await environment({onLock(name,state){
    if(name==="reader-local-"+key&&sealAtLock){
      sealAtLock=false;state.patchJob({phase:"upload-paused",active:false,packageReady:true});
    }
  }});
  e.patchJob({phase:"reading",active:true,packageReady:false});sealAtLock=true;
  await e.cleanup();
  assert.equal(sealAtLock,false);assert.ok(e.directories.has(key));
  assert.equal(e.jobs()[0].packageReady,true);assert.deepEqual(e.calls,[]);
});

test("discard reconciles an accepted receipt without deleting the server import",async()=>{
  const e=await environment({accepted:true,initialPatch:{phase:"upload-paused",active:false}});
  await e.discard();
  assert.equal(e.jobs()[0].iid,iid);assert.equal(e.jobs()[0].phase,"received");
  assert.equal(e.jobs()[0].packageReady,false);
  assert.equal(e.requests.some(r=>r.method==="DELETE"),false);
});

test("a failed server cancellation preserves the resumable package and binding",async()=>{
  const e=await environment({initialPatch:{phase:"upload-paused",active:false},
    beforeRequest(p,opts){if(p==="transfers/"+key&&opts.method==="DELETE")return new Response(null,{status:503});}});
  const before=structuredClone(e.jobs()[0]);
  await assert.rejects(e.discard(),/503/);
  assert.deepEqual(e.jobs()[0],before);assert.ok(e.directories.has(key));
});
