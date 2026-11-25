// Actual center controller with isolated storage/UI; no account, browser or network.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom"),crypto=require("node:crypto");
const device={id:"00000000-0000-4000-8000-000000000001",user:"synthetic",origin:"https://reader.example.test"};
const key="00000000-0000-4000-8000-000000000002",iid="00000000-0000-4000-8000-000000000003";
const old={version:1,id:"old-plan",device:device.id,user:device.user,origin:device.origin,source:{kind:"archive",scope:"same-source"},
  attachments:true,items:[{id:"one",title:"One",group:"unknown",project:null,key,cancelled:false}],paused:true};
const sleep=n=>new Promise(r=>setTimeout(r,n));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await sleep(5);}assert(fn(),"UI did not reach the expected state");}
async function fixture({plan=old,jobs=[],shared,search="",tabs=[],rows=[{id:"one",title:"One",group:"unknown"}],
  projects=[],sourceLookup=false}={}){
  const dir=path.join(__dirname,"../reader"),dom=new JSDOM(fs.readFileSync(path.join(dir,"center.html"),"utf8"),{
    url:"https://extension.example.test/center.html"+search,runScripts:"outside-only"
  }),w=dom.window,calls=[],requests=[],messages=[],removed=[];
  shared||={changes:[],locks:new Map(),state:{device:structuredClone(device),batchPlan:structuredClone(plan),jobs:structuredClone(jobs)}};
  const {changes,locks,state}=shared;
  const clone=x=>x===undefined?undefined:structuredClone(x);
  const backend={projects:clone(projects),sourceLookup,status:async()=>({})};
  const storage={
    async get(keys){return Object.fromEntries((typeof keys==="string"?[keys]:keys).map(k=>[k,clone(state[k])]))},
    async set(patch){const c={};for(const [k,v] of Object.entries(patch)){c[k]={oldValue:clone(state[k]),newValue:clone(v)};state[k]=clone(v);}
      for(const fn of changes)fn(c,"local");},
    async remove(keys){for(const key of typeof keys==="string"?[keys]:keys)delete state[key];}
  };
  w.navigator.locks={request(name,opts,fn){
    const f=fn||opts;
    if(opts?.ifAvailable&&locks.has(name))return Promise.resolve(f(null));
    const task=(locks.get(name)||Promise.resolve()).catch(()=>{}).then(()=>f({name}));
    locks.set(name,task);return task.finally(()=>{if(locks.get(name)===task)locks.delete(name);});
  }};
  const root={async getDirectoryHandle(){return {async removeEntry(name){removed.push(name);},async *[Symbol.asyncIterator](){}};},
    async removeEntry(name){removed.push(name);}};
  w.navigator.storage={getDirectory:async()=>root};w.READER_ORIGIN=device.origin;w.crypto.randomUUID=()=>crypto.randomUUID();
  w.ChatExportI18n={setLocale(){}};
  w.ReaderProgress={throttle:f=>({update:f,flush(){},close(){}}),describe:()=>"Reading"};
  w.ReaderLocalArchive={open:async()=>({digest:"same-source",rows:clone(rows),
    build:async()=>{calls.push("build");return {file:{size:10},sha256:"a".repeat(64),partial:false,losses:{}};}})};
  w.ReaderClient={trust:Promise.resolve(),request:async(_d,p,opts={})=>{
    calls.push(p);requests.push({device:_d,path:p,method:opts.method||"GET",body:opts.body});
    return {json:async()=>p==="capabilities"?{protocol:1,import_profile:"reader-chat-v1",capture:true,resumable_capture:true,source_lookup:backend.sourceLookup}:
      p==="projects"?clone(backend.projects):p==="sources/status"?backend.status(_d,JSON.parse(opts.body)):p.startsWith("requests/")?{id:null}:{}};
  }};
  w.chrome={storage:{local:storage,onChanged:{addListener:f=>changes.push(f)}},tabs:{create:async()=>{}},
    runtime:{sendMessage:async m=>{
      calls.push(m.kind);messages.push(clone(m));
      if(m.kind==="wake")return {ok:true};
      if(m.kind==="panel-host")return {ok:true};
      if(m.kind==="batch-tabs")return {tabs:clone(tabs)};
      return {};
    }}};
  // Evaluate the selection model and controller in the same window: their Set
  // constructors must match. JSDOM also supplies that realm's URLSearchParams.
  for(const file of ["batch-model.js","center-selection.js","center.js"])w.eval(fs.readFileSync(path.join(dir,file),"utf8"));
  await until(()=>!w.document.querySelector("#resume-box").hidden||!plan);
  return {w,state,calls,requests,messages,removed,storage,shared,backend,close:()=>w.close(),async choose(selected=[0]){
    const input=w.document.querySelector("#source-file");Object.defineProperty(input,"files",{value:[{name:"synthetic.zip"}],configurable:true});
    input.dispatchEvent(new w.Event("change"));await until(()=>!w.document.querySelector("#selection-step").hidden);
    const inputs=[...w.document.querySelectorAll("#source-rows input")];
    for(const index of selected){assert.ok(inputs[index],"the requested synthetic source exists");inputs[index].click();}
    w.document.querySelector("#to-target").click();
    await until(()=>!w.document.querySelector("#confirm-import").disabled);
  }};
}
test("another selection cannot silently replace an unfinished durable plan",async()=>{
  const f=await fixture();try{
    await f.choose();f.w.document.querySelector("#confirm-import").click();
    await sleep(80);
    assert.equal(f.state.batchPlan.id,old.id,"the old fixed selection must survive");
    assert.ok(f.w.document.querySelector("#error").textContent);
    assert.equal(f.calls.includes("build"),false);
  }finally{f.close();}
});
test("resume wakes the host even when every item already has an active server receipt",async()=>{
  const f=await fixture({jobs:[{device:device.id,key,iid,active:true,phase:"received",local:true,batch:old.id}]});
  try{
    f.w.document.querySelector("#resume-plan").click();await until(()=>!f.w.document.querySelector("#tasks-step").hidden);
    await sleep(20);f.calls.length=0;
    f.w.document.querySelector("#continue-queue").click();await sleep(80);
    assert.ok(f.calls.includes("wake"),"queue continuation must not depend on a previous view opening the host");
    assert.equal(f.calls.includes("build"),false);
  }finally{f.close();}
});
test("resume waits for an active capture without a receipt instead of staging it again",async()=>{
  const job={device:device.id,key,active:true,phase:"reading",local:true,batch:old.id};
  const f=await fixture({jobs:[job]});let timeout;
  try{
    await f.w.document.querySelector("#resume-plan").onclick();
    // Make the original source available, so a regressed controller would really
    // rebuild it rather than merely fail with "source needed".
    const input=f.w.document.querySelector("#resume-file");
    Object.defineProperty(input,"files",{value:[{name:"synthetic.zip"}],configurable:true});
    await input.onchange();
    assert.equal(f.w.document.querySelector("#resume-file-label").hidden,true);
    assert.equal(f.state.jobs[0].iid,undefined);
    f.calls.length=0;
    let settled=false;
    const run=f.w.document.querySelector("#continue-queue").onclick().then(()=>{settled=true;});
    await until(()=>f.calls.includes("wake"));await sleep(80);
    assert.equal(settled,false,"the existing capture is still active");
    assert.equal(f.calls.some(p=>p.startsWith("requests/")),false,"do not infer absence from a not-yet-created receipt");
    assert.equal(f.calls.includes("build"),false,"do not rebuild an active capture");
    assert.equal(f.calls.includes("panel-host"),false,"do not request a second transfer while capture is active");
    assert.equal(f.state.jobs[0].phase,"reading");
    // The original host finishes the existing item; the controller must observe
    // its terminal state, not require a source reread or another submission.
    await f.storage.set({jobs:[{...job,iid,active:false,phase:"done",
      result:{completeness:"complete",action:"created"}}]});
    await Promise.race([run,new Promise((_,reject)=>{
      timeout=setTimeout(()=>reject(Error("Queue did not observe the original capture completion")),2000);
    })]);
    assert.equal(f.state.batchPlan.id,old.id);
    assert.equal(f.state.batchPlan.paused,true);
    assert.equal(f.state.jobs.length,1);
    assert.equal(f.state.jobs[0].key,key);
    assert.equal(f.state.jobs[0].iid,iid);
    assert.equal(f.calls.some(p=>p==="build"||p.startsWith("requests/")||p==="panel-host"),false);
    assert.equal(f.w.document.querySelector("#error").textContent,"");
  }finally{clearTimeout(timeout);f.close();}
});

const reviewJob=()=>({device:device.id,key,iid,active:false,phase:"review",local:true,batch:old.id,
  sourceKey:"synthetic-original",review:{receipt:"synthetic-review-1",partial:true,live_share:true,action:"conflict"}});
const skipButton=w=>[...w.document.querySelectorAll("#task-rows button")].find(b=>b.textContent==="Skip; keep original");

test("skip review only dismisses this plan item, preserves the original receipt and source, and allows a new plan",async()=>{
  const job=reviewJob(),f=await fixture({jobs:[job]});
  try{
    await f.w.document.querySelector("#resume-plan").onclick();
    const skip=skipButton(f.w);assert.ok(skip);
    f.calls.length=f.requests.length=f.messages.length=f.removed.length=0;
    await skip.onclick();
    assert.equal(f.state.batchPlan.items[0].skipped,true);
    assert.equal(f.state.batchPlan.items[0].cancelled,false);
    assert.deepEqual(f.state.jobs,[job],"skipping does not approve, cancel or replace the server job");
    assert.deepEqual(f.requests,[]);assert.deepEqual(f.messages,[]);assert.deepEqual(f.removed,[]);
    assert.match(f.w.document.querySelector("#task-rows").textContent,/Review remains available in Reader/);
    assert.equal(skipButton(f.w),undefined);
    assert.equal(f.w.document.querySelector("#continue-queue").hidden,true);
    await f.w.document.querySelector("#new-import").onclick();
    assert.equal(f.state.batchPlan,undefined);
    assert.deepEqual(f.state.jobs,[job],"the original review survives starting another plan");
    assert.deepEqual(f.requests,[]);assert.deepEqual(f.messages,[]);assert.deepEqual(f.removed,[]);
    assert.equal(f.w.document.querySelector("#source-step").hidden,false);
    assert.equal(f.w.document.querySelector("#error").textContent,"");
  }finally{f.close();}
});

test("stale review skip is rejected after each receipt replacement, without commit, cancel or source removal",async()=>{
  let job=reviewJob();const f=await fixture({jobs:[job]});
  try{
    await f.w.document.querySelector("#resume-plan").onclick();
    for(const receipt of ["synthetic-review-2","synthetic-review-3"]){
      const stale=skipButton(f.w);assert.ok(stale);
      job={...job,review:{...job.review,receipt}};
      await f.storage.set({jobs:[job]});
      await until(()=>skipButton(f.w)!==stale);
      f.calls.length=f.requests.length=f.messages.length=f.removed.length=0;
      await stale.onclick();
      assert.match(f.w.document.querySelector("#error").textContent,/State changed/);
      assert.equal(f.state.batchPlan.items[0].skipped,undefined);
      assert.deepEqual(f.state.jobs,[job],"old UI must not act on a replacement receipt");
      assert.deepEqual(f.requests,[]);assert.deepEqual(f.messages,[]);assert.deepEqual(f.removed,[]);
    }
    await skipButton(f.w).onclick();
    assert.equal(f.state.batchPlan.items[0].skipped,true,"the freshly reviewed receipt can still be skipped");
    assert.deepEqual(f.state.jobs,[job]);
    assert.deepEqual(f.requests,[]);assert.deepEqual(f.messages,[]);assert.deepEqual(f.removed,[]);
  }finally{f.close();}
});

test("another center window can cancel the next item while the first is building; the running queue never submits that cancelled item",async()=>{
  const secondKey="00000000-0000-4000-8000-000000000005";
  const plan={...structuredClone(old),items:[{...old.items[0]},
    {...old.items[0],id:"two",title:"Two",key:secondKey}]};
  const f=await fixture({plan}),other=await fixture({shared:f.shared}),built=[];
  try{
    await f.w.document.querySelector("#resume-plan").onclick();
    await other.w.document.querySelector("#resume-plan").onclick();
    f.w.ReaderLocalArchive.open=async()=>({digest:"same-source",rows:plan.items.map(i=>({id:i.id,title:i.title,group:i.group})),
      async build(id){
        built.push(id);
        if(id==="one"){
          await other.w.document.querySelector("#cancel-pending").onclick();
          assert.equal(f.state.batchPlan.items[0].cancelled,false,"the active first item cannot be cancelled here");
          assert.equal(f.state.batchPlan.items[1].cancelled,true);
        }
        return {file:{size:10},sha256:"a".repeat(64),partial:false,losses:{}};
      }});
    const send=f.w.chrome.runtime.sendMessage;
    f.w.chrome.runtime.sendMessage=async m=>{
      const reply=await send(m);
      if(m.kind==="panel-host")await f.storage.set({jobs:f.state.jobs.map(j=>j.key===m.key?
        {...j,iid,active:false,packageReady:false,phase:"done",result:{completeness:"complete",action:"created"}}:j)});
      return reply;
    };
    const input=f.w.document.querySelector("#resume-file");
    Object.defineProperty(input,"files",{value:[{name:"synthetic.zip"}],configurable:true});
    await input.onchange();
    await f.w.document.querySelector("#continue-queue").onclick();
    assert.deepEqual(built,["one"]);
    assert.deepEqual(f.messages.filter(m=>m.kind==="panel-host").map(m=>m.key),[key]);
    assert.equal(f.requests.some(r=>r.path==="requests/"+secondKey),false);
    assert.equal(f.state.batchPlan.items[1].cancelled,true);
    assert.equal(f.state.jobs.some(j=>j.key===secondKey),false);
    assert.equal(f.w.document.querySelector("#error").textContent,"");
    assert.equal(other.w.document.querySelector("#error").textContent,"");
  }finally{f.close();other.close();}
});

test("a tab query is only a confirmed-source hint and never starts discovery automatically",async()=>{
  const f=await fixture({search:"?tab=17",tabs:[{id:8,title:"Other synthetic tab"},{id:17,title:"Requested synthetic tab"}]});
  try{
    assert.equal(new f.w.URLSearchParams(f.w.location.search).get("tab"),"17");
    assert.equal(f.w.eval("new Set() instanceof Set"),true);
    assert.equal(typeof f.w.ReaderCenterSelection.create,"function");
    assert.deepEqual(f.messages,[],"opening a link must not query or discover source tabs");
    await f.w.document.querySelector("#web-source").onclick();
    const choices=[...f.w.document.querySelectorAll("#web-tabs button")];
    assert.equal(choices.length,2);
    assert.match(choices[0].textContent,/Requested synthetic tab.*Opened from this tab/);
    assert.equal(choices[1].textContent,"Other synthetic tab");
    assert.deepEqual(f.messages.map(m=>m.kind),["batch-tabs"],"the hinted source still requires an explicit choice");
    assert.deepEqual(f.requests,[]);
    assert.equal(f.w.document.querySelector("#selection-step").hidden,true);
    assert.equal(f.w.document.querySelector("#error").textContent,"");
  }finally{f.close();}
});

const sourceRows=()=>["one","two","three"].map(id=>({id,title:"Synthetic "+id,group:"unknown"}));
const projectA="00000000-0000-4000-8000-000000000011",projectB="00000000-0000-4000-8000-000000000012";
const projectRows=()=>[{id:projectA,name:"Synthetic A"},{id:projectB,name:"Synthetic B"}];
function selectValue(w,id,value){
  const select=w.document.getElementById(id);select.value=value;
  select.dispatchEvent(new w.Event("change"));assert.equal(select.value,value);
}

test("saved-reference lookup requires an explicit click and sends only the selected source ids",async()=>{
  const f=await fixture({plan:null,rows:sourceRows(),sourceLookup:true});
  try{
    f.backend.status=async()=>({conversation_id:iid});
    await f.choose([0,2]);await f.w.document.querySelector("#reload-projects").onclick();
    assert.equal(f.requests.some(r=>r.path==="sources/status"),false,"reading, selecting and refreshing destinations do not disclose source ids");
    const button=f.w.document.querySelector("#check-bindings");
    assert.equal(button.hidden,false);assert.equal(button.disabled,false);
    await button.onclick();
    const sent=f.requests.filter(r=>r.path==="sources/status");
    assert.deepEqual(sent.map(r=>[r.device,r.method,JSON.parse(r.body)]),[
      [device.id,"POST",{source_id:"one"}],[device.id,"POST",{source_id:"three"}]
    ]);
    assert.match(f.w.document.querySelector("#bindings-status").textContent,/Checked 2\/2; 2 saved references/);
    assert.equal(f.messages.some(m=>["batch-capture","panel-host"].includes(m.kind)),false);
    assert.deepEqual(f.state.jobs,[]);
  }finally{f.close();}
});

test("a Reader account change invalidates a held saved-reference response and stops the remaining lookups",{timeout:4000},async()=>{
  const f=await fixture({plan:null,rows:sourceRows(),sourceLookup:true}),entered=deferred(),release=deferred();
  let checking;
  try{
    await f.choose([0,1]);
    f.backend.status=async()=>{entered.resolve();return release.promise;};
    checking=f.w.document.querySelector("#check-bindings").onclick();
    await entered.promise;
    const other={...device,id:"00000000-0000-4000-8000-000000000013",user:"synthetic-other"};
    await f.storage.set({device:other});
    await until(()=>f.requests.some(r=>r.device===other.id&&r.path==="projects")&&!f.w.document.querySelector("#confirm-import").disabled);
    release.resolve({conversation_id:iid});await checking;
    const sent=f.requests.filter(r=>r.path==="sources/status");
    assert.deepEqual(sent.map(r=>[r.device,JSON.parse(r.body)]),[[device.id,{source_id:"one"}]]);
    assert.equal(f.w.document.querySelector("#bindings-status").textContent,"","the old account's response must not appear in the new account");
    assert.equal(f.messages.some(m=>["batch-capture","panel-host"].includes(m.kind)),false);
    assert.deepEqual(f.state.jobs,[]);
  }finally{release.resolve({conversation_id:iid});await checking?.catch(()=>{});f.close();}
});

test("a deleted Reader destination blocks confirmation instead of silently falling back to unclassified",async()=>{
  const f=await fixture({plan:null,projects:projectRows()});
  try{
    await f.choose();selectValue(f.w,"mapping-0",projectA);
    assert.equal(f.w.document.querySelector("#confirm-import").disabled,false);
    f.backend.projects=projectRows().filter(p=>p.id!==projectA);
    for(let refresh=0;refresh<2;refresh++){
      await f.w.document.querySelector("#reload-projects").onclick();
      const select=f.w.document.querySelector("#mapping-0");
      assert.equal(select.value,"unavailable");
      assert.equal(select.selectedOptions[0].disabled,true);
      assert.match(select.selectedOptions[0].textContent,/Project unavailable/);
      assert.equal(f.w.document.querySelector("#confirm-import").disabled,true);
      f.w.document.querySelector("#confirm-import").click();
      assert.equal(f.state.batchPlan,null);assert.deepEqual(f.state.jobs,[]);
      assert.equal(f.messages.some(m=>["batch-capture","panel-host"].includes(m.kind)),false);
    }
  }finally{f.close();}
});

test("refreshing Reader projects preserves the current per-project mapping, attachment choice and remember choice",async()=>{
  const rows=[{id:"one",title:"One",group:"project:source-a"},{id:"two",title:"Two",group:"project:source-b"}];
  const f=await fixture({plan:null,rows,projects:projectRows()});
  try{
    await f.choose([0,1]);
    assert.equal(f.w.document.querySelector("#target-mode").value,"groups");
    selectValue(f.w,"mapping-0",projectA);selectValue(f.w,"mapping-1",projectB);
    f.w.document.querySelector("#include-files").checked=false;
    f.w.document.querySelector("#remember-mapping").checked=true;
    // A changed default or stored mapping is not permission to erase this view's
    // already reviewed choices during a catalogue refresh.
    await f.storage.set({destination:{device:device.id,project:projectB,textOnly:false},
      batchMappings:[{origin:device.origin,user:device.user,source:"same-source",
        targets:{"project:source-a":projectB,"project:source-b":projectA}}]});
    f.backend.projects=[{id:projectB,name:"Synthetic B renamed"},{id:projectA,name:"Synthetic A"}];
    await f.w.document.querySelector("#reload-projects").onclick();
    assert.equal(f.w.document.querySelector("#mapping-0").value,projectA);
    assert.equal(f.w.document.querySelector("#mapping-1").value,projectB);
    assert.match(f.w.document.querySelector("#mapping-1").selectedOptions[0].textContent,/B renamed/);
    assert.equal(f.w.document.querySelector("#target-mode").value,"groups");
    assert.equal(f.w.document.querySelector("#include-files").checked,false);
    assert.equal(f.w.document.querySelector("#remember-mapping").checked,true);
    assert.equal(f.w.document.querySelector("#confirm-import").disabled,false);
    assert.equal(f.state.batchPlan,null);assert.deepEqual(f.state.jobs,[]);
    assert.equal(f.requests.some(r=>r.method!=="GET"),false);
    assert.equal(f.w.document.querySelector("#error").textContent,"");
  }finally{f.close();}
});
