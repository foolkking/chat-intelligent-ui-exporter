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
  projects=[],sourceLookup=false,webCreate=false,frame,web,wide=true,archive={}}={}){
  const dir=path.join(__dirname,"../reader"),dom=new JSDOM(fs.readFileSync(path.join(dir,"center.html"),"utf8"),{
    url:"https://extension.example.test/center.html"+search,runScripts:"outside-only"
  }),w=dom.window,calls=[],requests=[],messages=[],removed=[],created=[];
  if(frame)Object.defineProperty(w,"ReaderFrameContext",{value:Object.freeze(frame)});
  const mediaListeners=[],media={matches:wide,addEventListener:(_name,fn)=>mediaListeners.push(fn)};
  w.matchMedia=()=>media;
  shared||={changes:[],locks:new Map(),state:{device:structuredClone(device),batchPlan:structuredClone(plan),jobs:structuredClone(jobs)}};
  const {changes,locks,state}=shared;
  const clone=x=>x===undefined?undefined:structuredClone(x);
  const backend={projects:clone(projects),sourceLookup,webCreate,status:async()=>({conversation_id:null}),discover:async()=>clone(web)};
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
  w.eval(fs.readFileSync(path.join(dir,"progress.js"),"utf8"));
  w.ReaderLocalArchive={open:async()=>({digest:"same-source",rows:clone(rows),...archive,
    build:async(...args)=>{calls.push("build");return archive.build ? archive.build(...args) :
      {file:{size:10},sha256:"a".repeat(64),partial:false,losses:{}};}})};
  w.ReaderClient={trust:Promise.resolve(),rememberSources:async(d,ids)=>{assert.equal(d.id,state.device.id);state.rememberedSources=Array.from(ids);},
    confirmProject:(d,name)=>backend.confirmProject(d,name),request:async(_d,p,opts={})=>{
    calls.push(p);requests.push({device:_d,path:p,method:opts.method||"GET",body:opts.body});
    return {json:async()=>p==="capabilities"?{protocol:1,import_profile:"reader-chat-v1",capture:true,resumable_capture:true,source_lookup:backend.sourceLookup,web_import_project:backend.webCreate}:
      p==="projects"?clone(backend.projects):p==="sources/status"?backend.status(_d,JSON.parse(opts.body)):p.startsWith("requests/")?{id:null}:{}};
  }};
  w.chrome={storage:{local:storage,onChanged:{addListener:f=>changes.push(f)}},tabs:{create:async args=>{created.push(clone(args));}},
    runtime:{getURL:name=>"chrome-extension://"+"a".repeat(32)+"/"+name,sendMessage:async m=>{
      calls.push(m.kind);messages.push(clone(m));
      if(m.kind==="frame-view")return {ok:true};
      if(m.kind==="wake")return {ok:true};
      if(m.kind==="panel-host")return {ok:true};
      if(m.kind==="batch-tabs")return {tabs:clone(tabs)};
      if(m.kind==="batch-discover")return backend.discover(m);
      return {};
    }}};
  // Evaluate the selection model and controller in the same window: their Set
  // constructors must match. JSDOM also supplies that realm's URLSearchParams.
  for(const file of ["routes.js","batch-model.js","center-selection.js","center-projects.js","center.js"])w.eval(fs.readFileSync(path.join(dir,file),"utf8"));
  await until(()=>!w.document.querySelector("#resume-box").hidden||!plan);
  return {w,state,calls,requests,messages,removed,created,storage,shared,backend,close:()=>w.close(),
    resize(wide){media.matches=wide;for(const fn of mediaListeners)fn(media);},async choose(selected=[0]){
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

const mappingFixture={plan:null,webCreate:true,rows:[{id:"first",title:"Conversation One",group:"project:known"},
  {id:"second",title:"Conversation Two",group:"project:opaque"}],archive:{groups:{"project:known":"Synthetic A"}}};
const mappingRow=(f,i)=>f.w.document.querySelector("#mapping-"+i).closest(".mapping-row");
const submitName=(f,i)=>mappingRow(f,i).querySelector("form").onsubmit(new f.w.Event("submit",{cancelable:true}));
test("unnamed groups stay distinguishable in the directory and mapping without exposing identifiers",async()=>{
  const a="g-p-"+"a".repeat(32),b="g-p-"+"b".repeat(32),groups={["project:"+a]:a+"-slug"};
  const rows=[a,b,"named"].map((id,i)=>({id:"row"+i,title:"Example "+i,group:"project:"+id}));
  groups["project:named"]="Research";
  const f=await fixture({plan:null,rows,archive:{groups},projects:[{id:projectA,name:projectA}]});
  try{
    await f.choose([0,1,2]); const d=f.w.document;
    const unknown=[...d.querySelectorAll("#target-mappings .mapping-row label")].map(n=>n.textContent);
    assert.notEqual(unknown[0],unknown[1]);assert.equal(unknown[2],"Research");
    for(const id of [a,b,projectA]){
      assert.ok(!d.querySelector("#target-mappings").textContent.includes(id));
      assert.ok(!d.querySelector("#project-groups").textContent.includes(id));
      assert.ok(![...d.querySelectorAll("#selection-step [aria-label]")].some(n=>n.getAttribute("aria-label").includes(id)));
    }
    assert.match(mappingRow(f,0).textContent,/Example 0/);
    assert.match(mappingRow(f,1).textContent,/Example 1/);
    assert.ok([...d.querySelector("#mapping-0").options].some(o=>o.value===projectA));
    mappingRow(f,0).querySelector("button").click();
    assert.equal(d.querySelector("#mapping-0-name").value,"","a display fallback cannot seed a project name");
  }finally{f.close();}
});
test("a malformed archive conversation preserves final measured progress and does not block its healthy sibling",async()=>{
  const reached=[],rows=sourceRows().slice(0,2);
  const f=await fixture({plan:null,rows,archive:{async build(id,dir,{report}){
    reached.push(id);
    if(id==="one"){
      report({stage:"messages",done:1,textBytes:5});report({stage:"messages",done:2,textBytes:17});
      throw Object.assign(Error("synthetic-private-body"),{code:"SOURCE_FORMAT_INVALID"});
    }
    return {file:{size:10},sha256:"a".repeat(64),partial:false,losses:{}};
  }}});
  try{
    await f.choose([0,1]);await f.w.document.querySelector("#confirm-import").onclick();
    assert.deepEqual(reached,["one","two"]);
    const [bad,good]=f.state.batchPlan.items.map(i=>f.state.jobs.find(j=>j.key===i.key));
    assert.equal(bad.phase,"capture-interrupted");assert.ok(!bad.active&&!bad.packageReady&&!bad.iid);
    assert.equal(bad.diagnostic.code,"SOURCE_FORMAT_INVALID");assert.equal(bad.step.textBytes,17);assert.equal(bad.step.done,2);
    assert.equal(bad.diagnostic.stage,"messages");assert.ok(good.packageReady);
    assert.ok(!JSON.stringify(f.state.jobs).includes("synthetic-private-body"));
    assert.match(f.w.document.querySelector("#task-rows").textContent,/source format/i);
  }finally{f.close();}
});
test("storage, cancellation and ownership failures still stop the batch; unknown errors never expose their payload",async()=>{
  for(const error of [
    Object.assign(Error("private storage payload"),{name:"QuotaExceededError"}),
    Object.assign(Error("private cancellation payload"),{name:"AbortError"}),
    Error("owner-changed"),Error("private unknown payload")
  ]){
    const reached=[],f=await fixture({plan:null,rows:sourceRows().slice(0,2),archive:{async build(id){
      reached.push(id);throw error;
    }}});
    try{
      await f.choose([0,1]);await f.w.document.querySelector("#confirm-import").onclick();
      assert.deepEqual(reached,["one"]);assert.ok(f.state.batchPlan.paused);
      assert.equal(f.state.jobs.filter(j=>j.phase==="done").length,0);
      assert.ok(!JSON.stringify(f.state.jobs).includes("private"));
      assert.ok(!f.w.document.querySelector("#error").textContent.includes("private"));
    }finally{f.close();}
  }
});
test("same-name reuse and explicitly named creation freeze only the verified Reader UUIDs in the import plan",async()=>{
  const f=await fixture({...mappingFixture,projects:[projectRows()[0]]});try{
    await f.choose([0,1]);const doc=f.w.document;
    assert.equal(doc.querySelector("#mapping-0").value,"");
    assert.match(doc.querySelector("#mapping-0").options[1].textContent,/same name/i);
    mappingRow(f,0).querySelector("button").click();
    assert.equal(doc.querySelector("#mapping-0").value,projectA);
    mappingRow(f,1).querySelector("button").click();
    const field=doc.querySelector("#mapping-1-name");assert.equal(field.value,"");assert.equal(doc.activeElement,field);
    assert.match(mappingRow(f,1).textContent,/Conversation Two/);
    assert.equal(doc.querySelector("#confirm-import").disabled,true);
    field.value="  Synthetic B  ";field.dispatchEvent(new f.w.Event("input"));
    const created=[];f.backend.confirmProject=async(d,name)=>{created.push([d.id,name]);f.backend.projects.push(projectRows()[1]);return projectB;};
    await submitName(f,1);assert.deepEqual(created,[[device.id,"Synthetic B"]]);
    assert.equal(doc.querySelector("#mapping-1").value,projectB);assert.equal(doc.querySelector("#mapping-0").value,projectA);
    assert.equal(doc.querySelector("#confirm-import").disabled,false);assert.equal(f.state.batchPlan,null);
    const send=f.w.chrome.runtime.sendMessage;f.w.chrome.runtime.sendMessage=async m=>{
      const response=await send(m);
      if(m.kind==="panel-host")await f.storage.set({jobs:f.state.jobs.map(j=>j.key===m.key?{...j,iid,active:false,packageReady:false,phase:"done"}:j)});
      return response;
    };
    assert.equal(f.state.batchMappings,undefined,"viewing and editing destinations does not remember them");
    assert.equal(f.state.rememberedSources,undefined);await doc.querySelector("#confirm-import").onclick();
    assert.deepEqual(f.state.batchPlan.items.map(i=>i.project),[projectA,projectB]);
    assert.deepEqual(f.state.batchMappings[0].targets,{"project:known":projectA,"project:opaque":projectB});
    assert.deepEqual(f.state.rememberedSources,["first","second"]);
  }finally{f.close();}
});
test("unknown create result preserves the draft; a fresh exact-name choice uses the existing project without creating twice",async()=>{
  const f=await fixture(mappingFixture);try{
    await f.choose();mappingRow(f,0).querySelector("button").click();assert.equal(f.w.document.querySelector("#mapping-0-name").value,"Synthetic A");
    let count=0;f.backend.confirmProject=async()=>{count++;f.backend.projects=projectRows();throw Error("lost reply");};
    await submitName(f,0);assert.match(mappingRow(f,0).textContent,/refresh/i);assert.equal(f.w.document.querySelector("#confirm-import").disabled,true);
    await f.w.document.querySelector("#reload-projects").onclick();await submitName(f,0);
    assert.equal(count,1);assert.equal(f.w.document.querySelector("#mapping-0").value,projectA);
  }finally{f.close();}
});
test("older Reader can create in its sidebar and the next refresh resolves only the originating named row",async()=>{
  const f=await fixture({...mappingFixture,webCreate:false});try{
    await f.choose([0,1]);mappingRow(f,0).querySelector("button").click();await submitName(f,0);
    assert.deepEqual(f.created,[{url:device.origin+"/"}]);assert.match(mappingRow(f,0).textContent,/sidebar/i);
    assert.equal(f.w.document.querySelector("#confirm-import").disabled,true);
    f.backend.projects=projectRows();await f.w.document.querySelector("#reload-projects").onclick();
    assert.equal(f.w.document.querySelector("#mapping-0").value,projectA);assert.equal(f.w.document.querySelector("#mapping-1").value,"");
    assert.ok(f.requests.every(r=>r.method==="GET"));
  }finally{f.close();}
});
test("URL-slug aliases retain a remembered destination or explicit Unclassified; conflicting past choices require review",async()=>{
  const group="project:g-p-"+"0123456789abcdef".repeat(2);
  const source=webSource([{id:"one",title:"Same project with an old URL slug",group}],{hint:null});
  for(const [targets,expected] of [[{[group+"-old-name"]:projectA},projectA],
    [{[group+"-old-name"]:null},""],[{[group+"-old-name"]:projectA,[group]:projectB},"unavailable"]]){
    const f=await fixture({plan:null,web:source,projects:projectRows(),tabs:[{id:17,title:"Source"}]});try{
      await f.storage.set({batchMappings:[{origin:device.origin,user:device.user,source:source.scope,targets:{"*":projectB,...targets}}]});
      const doc=await openWeb(f);checkRow(doc);await doc.querySelector("#to-target").onclick();
      assert.equal(doc.querySelector("#mapping-0").value,expected);
      assert.equal(doc.querySelector("#confirm-import").disabled,expected==="unavailable");assert.equal(f.state.batchPlan,null);
    }finally{f.close();}
  }
});
test("a delayed confirmation cannot select a project after switching Reader account, source, or row choice",async()=>{
  for(const change of ["account","source","selection"]){
    const f=await fixture({...mappingFixture,projects:[projectRows()[1]]}),entered=deferred(),reply=deferred();let pending;
    try{
      await f.choose([0,1]);mappingRow(f,0).querySelector("button").click();
      f.backend.confirmProject=async()=>{entered.resolve();return reply.promise;};pending=submitName(f,0);await entered.promise;
      const doc=f.w.document;
      if(change==="account"){
        await f.storage.set({device:{...device,id:projectB,user:"other"}});await until(()=>!doc.querySelector("#confirm-import").disabled);
      }else if(change==="source"){
        await stepButton(doc,1).onclick();await doc.querySelector("#back-source").onclick();
        f.w.ReaderLocalArchive.open=async()=>({digest:"different",rows:[{id:"different",title:"Another source",group:"project:known"}]});await f.choose();
      }else selectValue(f.w,"mapping-0",projectB);
      f.backend.projects=projectRows();reply.resolve(projectA);await pending;
      assert.equal(doc.querySelector("#mapping-0").value,change==="selection"?projectB:"");assert.equal(f.state.batchPlan,null);
    }finally{reply.resolve(projectA);await pending;f.close();}
  }
});

test("entering Reader destination explicitly looks up only selected source ids and labels updates without importing",async()=>{
  const f=await fixture({plan:null,rows:sourceRows(),sourceLookup:true});
  try{
    f.backend.status=async()=>({conversation_id:iid});
    await f.choose([0,2]);await until(()=>!f.w.document.querySelector("#check-bindings").disabled);
    const button=f.w.document.querySelector("#check-bindings");
    assert.equal(button.hidden,false);assert.equal(button.disabled,false);
    const sent=f.requests.filter(r=>r.path==="sources/status");
    assert.deepEqual(sent.map(r=>[r.device,r.method,JSON.parse(r.body)]),[
      [device.id,"POST",{source_id:"one"}],[device.id,"POST",{source_id:"three"}]
    ]);
    assert.match(f.w.document.querySelector("#bindings-status").textContent,/Checked 2\/2; 2 saved references/);
    assert.match(f.w.document.querySelector("#confirm-import").textContent,/Update 2 conversations/);
    assert.equal(f.state.rememberedSources,undefined);
    await stepButton(f.w.document,1).onclick();
    assert.equal(f.w.document.querySelectorAll("#source-rows .meta").length,3);
    assert.equal([...f.w.document.querySelectorAll("#source-rows .meta")].filter(n=>n.textContent.includes("Update existing")).length,2);
    assert.equal(f.messages.some(m=>["batch-capture","panel-host"].includes(m.kind)),false);
    assert.deepEqual(f.state.jobs,[]);
  }finally{f.close();}
});

test("a Reader account change invalidates a held saved-reference response and stops the remaining lookups",{timeout:4000},async()=>{
  const f=await fixture({plan:null,rows:sourceRows(),sourceLookup:true}),entered=deferred(),release=deferred();
  let checking;
  try{
    await f.choose([0,1]);await until(()=>!f.w.document.querySelector("#check-bindings").disabled);
    f.requests.length=0;
    f.backend.status=async()=>{entered.resolve();return release.promise;};
    checking=f.w.document.querySelector("#check-bindings").onclick();
    await entered.promise;
    const other={...device,id:"00000000-0000-4000-8000-000000000013",user:"synthetic-other"};
    await f.storage.set({device:other});
    await until(()=>f.requests.some(r=>r.device===other.id&&r.path==="projects"));
    release.resolve({conversation_id:iid});await checking;
    const sent=f.requests.filter(r=>r.path==="sources/status");
    assert.deepEqual(sent.map(r=>[r.device,JSON.parse(r.body)]),[[device.id,{source_id:"one"}]]);
    await until(()=>!f.w.document.querySelector("#check-bindings").disabled);
    assert.equal(f.w.document.querySelector("#bindings-status").textContent,"","old results cannot certify the new account; no automatic disclosure to the replacement account");
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

test("refreshing Reader projects preserves the current per-project mapping and attachment choice without saving the draft",async()=>{
  const rows=[{id:"one",title:"One",group:"project:source-a"},{id:"two",title:"Two",group:"project:source-b"}];
  const f=await fixture({plan:null,rows,projects:projectRows()});
  try{
    await f.choose([0,1]);
    assert.equal(f.w.document.querySelector("#target-mode").value,"groups");
    selectValue(f.w,"mapping-0",projectA);selectValue(f.w,"mapping-1",projectB);
    f.w.document.querySelector("#include-files").checked=false;
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
    assert.equal(f.w.document.querySelector("#remember-mapping"),null,"remembering happens only on explicit submission");
    assert.equal(f.state.rememberedSources,undefined);
    assert.equal(f.w.document.querySelector("#confirm-import").disabled,false);
    assert.equal(f.state.batchPlan,null);assert.deepEqual(f.state.jobs,[]);
    assert.equal(f.requests.some(r=>r.method!=="GET"),false);
    assert.equal(f.w.document.querySelector("#error").textContent,"");
  }finally{f.close();}
});

test("embedded import uses the claimed tab hint and leaves library navigation to the outer workspace",async()=>{
  const f=await fixture({frame:{view:"import",tab:17},search:"?tab=8",tabs:[{id:8,title:"Query tab"},{id:17,title:"Bound tab"}]});
  try{
    const doc=f.w.document,link=doc.querySelector("#library-link");
    assert.equal(doc.querySelector(".center-head").hidden,true);
    assert.equal(link.closest("[hidden]"),doc.querySelector(".center-head"),"no duplicate library action inside the import step bar");
    assert.deepEqual(f.messages,[],"embedding still does not auto-discover a source or query Reader");
    assert.deepEqual(f.created,[]);
    await doc.querySelector("#web-source").onclick();
    assert.match(doc.querySelector("#web-tabs button").textContent,/Bound tab.*Opened from this tab/);
    assert.equal(f.messages.some(m=>m.kind==="batch-discover"),false);
    await doc.querySelector("#resume-plan").onclick();
    assert.equal(link.closest("[hidden]"),doc.querySelector(".center-head"),"step transitions must not restore the removed link");
    assert.equal(link.isConnected,true);
  }finally{f.close();}
});
test("standalone center keeps its header and explicit library new-tab behavior",async()=>{
  const f=await fixture();try{
    assert.equal(f.w.document.querySelector(".center-head").hidden,false);
    await f.w.document.querySelector("#library-link").onclick();
    assert.deepEqual(f.created,[{url:"chrome-extension://"+"a".repeat(32)+"/panel.html"}]);
    assert.deepEqual(f.messages,[]);
  }finally{f.close();}
});
test("switching an embedded import to library and hiding it does not interrupt an active queue or lose its item",async()=>{
  const job={device:device.id,key,active:true,phase:"reading",local:true,batch:old.id};
  const f=await fixture({frame:{view:"import",tab:17},jobs:[job]});let run,timeout;
  try{
    const doc=f.w.document;await doc.querySelector("#resume-plan").onclick();
    const input=doc.querySelector("#resume-file");
    Object.defineProperty(input,"files",{value:[{name:"synthetic.zip"}],configurable:true});await input.onchange();
    let finished=false;run=doc.querySelector("#continue-queue").onclick().then(()=>{finished=true;});
    await until(()=>f.calls.includes("wake"));
    // The outer workspace switches its retained iframe; the embedded step bar
    // deliberately no longer duplicates that library control.
    Object.defineProperty(doc,"visibilityState",{value:"hidden",configurable:true});
    doc.dispatchEvent(new f.w.Event("visibilitychange"));await sleep(80);
    assert.equal(finished,false);assert.equal(f.state.batchPlan.id,old.id);
    assert.equal(f.state.batchPlan.items[0].key,key);assert.deepEqual(f.removed,[]);assert.deepEqual(f.created,[]);
    assert.equal(f.calls.some(p=>p==="build"||p==="panel-host"||p.startsWith("requests/")),false);
    await f.storage.set({jobs:[{...job,iid,active:false,phase:"done",result:{completeness:"complete",action:"created"}}]});
    await Promise.race([run,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error("Hidden queue did not observe completion")),2000);})]);
    assert.equal(finished,true);assert.equal(f.state.jobs.length,1);assert.equal(f.state.jobs[0].key,key);
    assert.equal(doc.querySelector("#error").textContent,"");
  }finally{clearTimeout(timeout);f.close();}
});

const webRows=(n=155)=>Array.from({length:n},(_,i)=>({id:"web-"+i,title:"Synthetic "+String(i).padStart(3,"0"),
  group:i===n-1?"unknown":"project:p"+Math.floor(i/55)}));
const webSource=(rows=webRows(),patch={})=>({rows,groups:{"project:p0":"Same name","project:p1":"Same name","project:p2":"Third"},
  scope:"a".repeat(64),catalog:"catalog-1",complete:false,hint:"project:p1",...patch});
async function openWeb(f){
  const doc=f.w.document;await doc.querySelector("#web-source").onclick();
  await doc.querySelector("#web-tabs button").onclick();
  assert.equal(doc.querySelector("#selection-step").hidden,false);return doc;
}
function groupButton(doc,group){return [...doc.querySelectorAll("#project-groups button[data-group]")].find(n=>n.dataset.group===group);}
const stepButton=(doc,n)=>doc.querySelector(`#steps button[data-step="${n}"]`);
function checkRow(doc,index=0){doc.querySelectorAll("#source-rows input")[index].click();}
test("late names patch the same checkbox/page/filter/scroll and selected Reader destination, without a plan mutation",async()=>{
  const web=webSource(undefined,{groups:{},namesRevision:0,evidence:{"project:p1":{source:"missing"}}});
  const f=await fixture({plan:null,web,tabs:[{id:17,title:"Synthetic source"}],projects:[{id:projectA,name:"Manual target"}]});
  try{
    const doc=f.w.document;Object.defineProperty(doc,"visibilityState",{value:"visible",configurable:true});
    let wanted="Discovered",rev=0,callbacks=[];
    const timer=f.w.setTimeout.bind(f.w);
    f.w.setTimeout=(cb,ms,...args)=>{if(ms===350||ms===2200){callbacks.push(cb);return -1;}return timer(cb,ms,...args);};
    const send=f.w.chrome.runtime.sendMessage;f.w.chrome.runtime.sendMessage=async m=>m.kind==="batch-project-names"?
      {catalog:web.catalog,scope:web.scope,groups:{"project:p1":wanted},evidence:{"project:p1":{source:"project-link"}},namesRevision:++rev}:send(m);
    await openWeb(f);doc.querySelector("#source-more").click();checkRow(doc);
    const list=doc.querySelector("#source-rows"),check=list.querySelector("input"),label=list.querySelector("[data-source-label]");
    check.focus();list.scrollTop=37;const page=doc.querySelector("#source-page-status").textContent;
    callbacks.pop()();await until(()=>label.textContent==="Discovered");
    assert.equal(doc.activeElement,check);assert.equal(check.checked,true);assert.equal(check.isConnected,true);assert.equal(list.scrollTop,37);
    assert.equal(doc.querySelector("#source-page-status").textContent,page);assert.equal(doc.querySelector("#source-group").value,"project:p1");
    await stepButton(doc,2).onclick();const select=doc.querySelector("#target-mappings select");select.value=projectA;select.onchange();
    const kept=doc.querySelector("#target-mappings select");kept.focus();wanted="Renamed";callbacks.pop()();
    await until(()=>doc.querySelector("#target-mappings .mapping-row label").textContent==="Renamed");
    assert.equal(kept.value,projectA);assert.equal(kept.isConnected,true);assert.equal(doc.activeElement,kept);assert.equal(f.state.batchPlan,null);
    assert.equal(f.state.batchMappings,undefined);assert.deepEqual(f.state.jobs,[]);
    assert.doesNotMatch(JSON.stringify(f.w.ReaderProjectReport()),/Discovered|Renamed|project:p|catalog-1/);
  }finally{f.close();}
});
test("a background rename out of a compact project search keeps the active accordion, filter, page and focused checked row",async()=>{
  const web=webSource(),f=await fixture({plan:null,web,tabs:[{id:17,title:"Synthetic source"}],wide:false});
  try{
    const d=f.w.document;Object.defineProperty(d,"visibilityState",{value:"visible",configurable:true});
    const timer=f.w.setTimeout.bind(f.w),callbacks=[];
    f.w.setTimeout=(cb,ms,...args)=>{if(ms===350||ms===2200){callbacks.push(cb);return -1;}return timer(cb,ms,...args);};
    const send=f.w.chrome.runtime.sendMessage;f.w.chrome.runtime.sendMessage=m=>m.kind==="batch-project-names"?
      Promise.resolve({catalog:web.catalog,scope:web.scope,groups:{...web.groups,"project:p1":"Updated label"},evidence:{},namesRevision:1}):send(m);
    await openWeb(f);
    const query=d.querySelector("#project-query");query.value="Same name";query.oninput();
    const active=groupButton(d,"project:p1"),neighbor=groupButton(d,"project:p0");
    d.querySelector("#source-more").click();checkRow(d);
    const list=d.querySelector("#source-rows"),box=list.querySelector("input"),pane=d.querySelector("#conversation-pane");
    box.focus();list.scrollTop=29;const page=d.querySelector("#source-page-status").textContent;
    callbacks.pop()();await until(()=>list.querySelector("[data-source-label]").textContent==="Updated label");
    assert.equal(pane.closest("li").dataset.group,"project:p1");assert.equal(d.querySelector("#source-group").value,"project:p1");
    assert.equal(groupButton(d,"project:p1"),active);assert.equal(groupButton(d,"project:p0"),neighbor);
    assert.equal(d.activeElement,box);assert.equal(box.checked,true);assert.equal(list.scrollTop,29);
    assert.equal(query.value,"Same name");assert.equal(d.querySelector("#source-page-status").textContent,page);
    assert.equal(f.state.batchPlan,null);
  }finally{f.close();}
});
test("a missing name has a scoped, reversible alias; the alias is not a destination or a server rename",async()=>{
  const f=await fixture({plan:null,rows:[{id:"a",title:"A",group:"project:p"},{id:"b",title:"B",group:"unclassified"},{id:"c",title:"C",group:"unknown"}]});
  try{
    await f.choose([0]);const d=f.w.document;await stepButton(d,1).onclick();
    const button=groupButton(d,"project:p"),alias=button.parentElement.querySelector(".edit-alias"),dialog=d.querySelector("#project-alias");
    dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
    alias.click();const field=d.querySelector("#alias-name");field.value="g-p-internal";d.querySelector("#alias-form").dispatchEvent(new f.w.Event("submit",{cancelable:true}));
    assert.equal(field.validity.customError,true);d.querySelector("#alias-cancel").click();alias.click();
    assert.equal(field.validity.customError,false);field.value="Reading notes";d.querySelector("#alias-form").dispatchEvent(new f.w.Event("submit",{cancelable:true}));
    await until(()=>button.textContent.includes("Reading notes"));assert.equal(d.querySelector("#source-rows input").checked,true);
    assert.equal(f.state["reader-project-alias:archive:same-source"]["project:p"],"Reading notes");
    assert.notEqual(groupButton(d,"unclassified").querySelector(".project-name").textContent,groupButton(d,"unknown").querySelector(".project-name").textContent);
    await stepButton(d,2).onclick();assert.equal(d.querySelector(".mapping-row label").textContent,"Reading notes");
    assert.equal(d.querySelector(".mapping-row select").value,"");assert.equal(f.state.batchPlan,null);
    await stepButton(d,1).onclick();alias.click();field.value="";d.querySelector("#alias-form").dispatchEvent(new f.w.Event("submit",{cancelable:true}));
    await until(()=>!button.textContent.includes("Reading notes"));assert.equal(f.state["reader-project-alias:archive:same-source"]["project:p"],undefined);
  }finally{f.close();}
});
test("compact projects collapse separately from selection; expanding to a wide project list retains the exact conversation pane and choice",async()=>{
  const f=await fixture({plan:null,web:webSource(),tabs:[{id:17,title:"Synthetic source"}],wide:false});try{
    const doc=await openWeb(f),button=groupButton(doc,"project:p1"),pane=doc.querySelector("#conversation-pane");
    assert.ok(button);assert.equal(button.getAttribute("aria-expanded"),"true");
    assert.equal(doc.querySelectorAll("#source-rows input:checked").length,0,"project entry is a filter hint, never selection");
    checkRow(doc);assert.match(doc.querySelector("#selected-count").textContent,/1 selected/);
    await button.onclick();assert.equal(pane.hidden,true);assert.equal(button.getAttribute("aria-expanded"),"false");
    await button.onclick();assert.equal(pane.hidden,false);assert.equal(doc.querySelector("#source-rows input").checked,true);
    f.resize(true);assert.equal(pane.parentElement.className,"catalogue-layout");assert.equal(pane.hidden,false);
    assert.equal(groupButton(doc,"project:p1").getAttribute("aria-current"),"true");
    f.resize(false);assert.equal(pane.closest("li").dataset.group,"project:p1");
    assert.equal(doc.querySelectorAll("#conversation-pane").length,1);assert.equal(doc.querySelector("#source-rows input").checked,true);
    assert.deepEqual(f.requests,[]);assert.equal(f.messages.some(m=>m.kind==="batch-capture"),false);
  }finally{f.close();}
});
test("current discovered range is tri-state and fixed across pages, same-title groups and review-selected removal",async()=>{
  const f=await fixture({plan:null,web:webSource(),tabs:[{id:17,title:"Synthetic source"}]});try{
    const doc=await openWeb(f),all=doc.querySelector('li[data-group="project:p1"] input');
    assert.equal(all.type,"checkbox");assert.equal(all.checked,false);assert.match(all.getAttribute("aria-label"),/55 discovered/);
    checkRow(doc);assert.equal(all.indeterminate,true);assert.equal(all.checked,false);
    all.click();assert.match(doc.querySelector("#selected-count").textContent,/55 selected/);
    doc.querySelector("#source-more").click();assert.equal(doc.querySelectorAll("#source-rows input:checked").length,5);
    await groupButton(doc,"project:p0").onclick();checkRow(doc);
    assert.equal(doc.querySelector("#source-group").value,"project:p0","compact project shortcut must follow the selected project");
    assert.match(doc.querySelector("#selected-count").textContent,/56 selected/);
    doc.querySelector("#selected-count").click();assert.equal(doc.querySelectorAll("#source-rows li").length,50);
    checkRow(doc);assert.match(doc.querySelector("#selected-count").textContent,/55 selected/);
    assert.equal(doc.querySelectorAll("#source-rows li").length,50);
    assert.match(doc.querySelector("#group-label").textContent,/partial directory/);
    assert.match(doc.querySelector("#saved-state-note").textContent,/not checked/);
    assert.doesNotMatch(doc.querySelector("#selection-step").textContent,/Not imported|未导入/);
  }finally{f.close();}
});
test("project checkboxes select only discovered members even for a fabricated complete web catalogue",async()=>{
  const f=await fixture({plan:null,web:webSource(webRows(),{complete:true}),tabs:[{id:17,title:"Synthetic source"}]});try{
    const doc=await openWeb(f),box=doc.querySelector('li[data-group="project:p0"] input');
    assert.ok(box);box.click();assert.match(doc.querySelector("#selected-count").textContent,/55 selected/);
    assert.equal(doc.querySelector("#select-project"),null,"no control may claim complete web-project selection");
    assert.match(doc.querySelector("#group-label").textContent,/partial directory/);
    assert.equal(f.w.ReaderCenterSelection.create({source:f.w.JSON.parse(JSON.stringify({...webSource(webRows(),{complete:true}),kind:"web"}))}).project("project:p0").allowed,false);
    assert.deepEqual(f.requests,[]);assert.equal(f.messages.some(m=>m.kind==="batch-capture"),false);
  }finally{f.close();}
});
test("web refresh retains surviving selections but reports missing or reassigned rows without selecting newly discovered ones",async()=>{
  const initial=webRows(),f=await fixture({plan:null,web:webSource(initial),tabs:[{id:17,title:"Synthetic source"}]});try{
    const doc=await openWeb(f);checkRow(doc,0);checkRow(doc,1);checkRow(doc,2);
    f.backend.discover=async()=>webSource([...initial.filter(r=>r.id!=="web-56").map(r=>r.id==="web-57"?{...r,group:"unknown"}:r),
      {id:"new",title:"Newly discovered",group:"project:p1"}],{catalog:"catalog-2"});
    await doc.querySelector("#refresh-source").onclick();
    assert.match(doc.querySelector("#selected-count").textContent,/1 selected/);
    assert.match(doc.querySelector("#refresh-status").textContent,/2.*removed/);
    doc.querySelector("#selected-count").click();assert.equal(doc.querySelectorAll("#source-rows li").length,1);
    assert.match(doc.querySelector("#source-rows").textContent,/Synthetic 055/);
    assert.deepEqual(f.requests,[]);assert.equal(f.state.batchPlan,null);
  }finally{f.close();}
});
test("a changed or unknown workspace refresh preserves the old draft but blocks confirmation; a failed refresh does not become an empty catalogue",async()=>{
  const f=await fixture({plan:null,web:webSource(),tabs:[{id:17,title:"Synthetic source"}]});try{
    const doc=await openWeb(f);checkRow(doc);const before=doc.querySelector("#source-rows").textContent;
    f.backend.discover=async()=>webSource([],{scope:"other"});
    await doc.querySelector("#refresh-source").onclick();
    assert.equal(doc.querySelector("#source-rows").textContent,before);
    assert.match(doc.querySelector("#selected-count").textContent,/1 selected/);
    assert.equal(doc.querySelector("#to-target").disabled,true);
    assert.match(doc.querySelector("#error").textContent,/changed/);
    f.backend.discover=async()=>webSource();
    await doc.querySelector("#refresh-source").onclick();assert.equal(doc.querySelector("#to-target").disabled,false);
    f.backend.discover=async()=>({error:"source-unavailable"});
    await doc.querySelector("#refresh-source").onclick();
    assert.equal(doc.querySelector("#source-rows").textContent,before);assert.match(doc.querySelector("#selected-count").textContent,/1 selected/);
  }finally{f.close();}
});
test("changing source offers return to the unmodified draft; a late discovery after return cannot replace it",async()=>{
  const f=await fixture({plan:null,web:webSource(),tabs:[{id:17,title:"Synthetic source"}]});let pending;
  const release=deferred();try{
    const doc=await openWeb(f);checkRow(doc);
    await doc.querySelector("#back-source").onclick();assert.equal(doc.querySelector("#source-step").hidden,false);
    assert.equal(stepButton(doc,1).disabled,false);
    f.backend.discover=()=>release.promise;
    await doc.querySelector("#web-source").onclick();pending=doc.querySelector("#web-tabs button").onclick();
    await stepButton(doc,1).onclick();release.resolve(webSource([],{scope:"other"}));await pending;
    assert.equal(doc.querySelector("#selection-step").hidden,false);assert.match(doc.querySelector("#selected-count").textContent,/1 selected/);
    assert.equal(doc.querySelectorAll("#source-rows li").length,50);
  }finally{release.resolve({error:"source-unavailable"});await pending;f.close();}
});
test("project navigation and conversation DOM stay bounded with 3007 source groups and every later project remains reachable",async()=>{
  const rows=Array.from({length:3007},(_,i)=>({id:"r"+i,title:"Synthetic "+i,group:"project:g"+i}));
  const f=await fixture({plan:null,web:webSource(rows,{hint:null}),tabs:[{id:17,title:"Synthetic source"}]});try{
    const doc=await openWeb(f);
    assert.ok(doc.querySelectorAll("#project-groups>li").length<=51);assert.ok(doc.querySelectorAll("#source-group option").length<=52);
    assert.equal(doc.querySelectorAll("#source-rows li").length,50);
    for(let page=0;page<60;page++)await doc.querySelector("#project-next").onclick();
    assert.ok(groupButton(doc,"project:g3006"));await groupButton(doc,"project:g3006").onclick();
    assert.equal(doc.querySelectorAll("#source-rows li").length,1);assert.match(doc.querySelector("#source-rows").textContent,/Synthetic 3006/);
    checkRow(doc);assert.match(doc.querySelector("#selected-count").textContent,/1 selected/);
    assert.ok(doc.querySelectorAll("#project-groups>li").length<=51);
  }finally{f.close();}
});
test("local export project proof remains explicit and target mappings keep both groups after compact navigation",async()=>{
  const rows=[{id:"a",title:"First",group:"project:a"},{id:"b",title:"Second",group:"project:b"},
    {id:"c",title:"Unclassified",group:"unclassified"}];
  const f=await fixture({plan:null,rows,wide:false,archive:{digest:"b".repeat(64),complete:true},projects:projectRows()});try{
    const doc=f.w.document,input=doc.querySelector("#source-file");
    Object.defineProperty(input,"files",{value:[{name:"synthetic.zip"}],configurable:true});await input.onchange();
    assert.equal(doc.querySelector("#refresh-source").hidden,true);
    await groupButton(doc,"project:a").onclick();
    const proof=f.w.ReaderCenterSelection.create({source:f.w.JSON.parse(JSON.stringify({kind:"archive",rows,scope:"b".repeat(64),digest:"b".repeat(64),complete:true}))}).project("project:a");
    assert.equal(proof.allowed,true);doc.querySelector('li[data-group="project:a"] input').click();
    await groupButton(doc,"project:b").onclick();checkRow(doc);await doc.querySelector("#to-target").onclick();
    selectValue(f.w,"mapping-0",projectA);selectValue(f.w,"mapping-1",projectB);
    doc.querySelector("#include-files").checked=false;
    await stepButton(doc,1).onclick();f.resize(true);
    assert.match(doc.querySelector("#selected-count").textContent,/2 selected/);await doc.querySelector("#to-target").onclick();
    assert.equal(doc.querySelector("#mapping-0").value,projectA);assert.equal(doc.querySelector("#mapping-1").value,projectB);
    assert.equal(doc.querySelector("#include-files").checked,false);assert.equal(f.state.batchPlan,null);
  }finally{f.close();}
});
test("same-name project buttons filter by stable identity; unknown membership is not unclassified and scope-unknown stays gated",async()=>{
  const rows=[{id:"a",title:"First",group:"project:p0"},{id:"b",title:"Second",group:"project:p1"},
    {id:"c",title:"Unknown row",group:"unknown"},{id:"d",title:"Unclassified row",group:"unclassified"}];
  const f=await fixture({plan:null,web:webSource(rows,{scope:null}),tabs:[{id:17,title:"Synthetic source"}]});try{
    const doc=await openWeb(f);
    assert.equal(doc.querySelector("#source-group").value,"","unverified project hint must not filter");
    await groupButton(doc,"project:p0").onclick();assert.match(doc.querySelector("#source-rows").textContent,/First/);
    await groupButton(doc,"project:p1").onclick();assert.match(doc.querySelector("#source-rows").textContent,/Second/);
    await groupButton(doc,"unknown").onclick();assert.match(doc.querySelector("#source-rows").textContent,/Unknown row/);
    assert.doesNotMatch(doc.querySelector("#source-rows").textContent,/Unclassified row/);
    checkRow(doc);assert.equal(doc.querySelector("#to-target").disabled,true);
    await doc.querySelector("#to-target").onclick();assert.equal(doc.querySelector("#target-step").hidden,true);
    assert.deepEqual(f.requests,[]);
  }finally{f.close();}
});
test("the last explicitly chosen source wins when two discoveries finish out of order",async()=>{
  const f=await fixture({plan:null,tabs:[{id:1,title:"First tab"},{id:2,title:"Second tab"}]});
  const a=deferred(),b=deferred();let first,second;
  try{
    const doc=f.w.document;f.backend.discover=m=>m.tab===1?a.promise:b.promise;
    await doc.querySelector("#web-source").onclick();const choices=doc.querySelectorAll("#web-tabs button");
    first=choices[0].onclick();second=choices[1].onclick();
    b.resolve(webSource([{id:"b",title:"Second chosen source",group:"unknown"}]));await second;
    a.resolve(webSource([{id:"a",title:"First stale source",group:"unknown"}]));await first;
    assert.match(doc.querySelector("#source-rows").textContent,/Second chosen source/);
    assert.doesNotMatch(doc.querySelector("#source-rows").textContent,/First stale source/);assert.equal(f.state.batchPlan,null);
  }finally{a.resolve({error:"source-unavailable"});b.resolve({error:"source-unavailable"});await first;await second;f.close();}
});
test("Reader account changes invalidate a held source refresh without replacing the draft or issuing any import",async()=>{
  const f=await fixture({plan:null,web:webSource(),tabs:[{id:17,title:"Synthetic source"}]}),release=deferred();let pending;
  try{
    const doc=await openWeb(f);checkRow(doc);f.backend.discover=()=>release.promise;
    pending=doc.querySelector("#refresh-source").onclick();assert.equal(doc.querySelector("#to-target").disabled,true);
    await f.storage.set({device:{...device,id:"other-device",user:"other-user"}});
    release.resolve(webSource([]));await pending;
    assert.match(doc.querySelector("#selected-count").textContent,/1 selected/);
    assert.equal(doc.querySelectorAll("#source-rows li").length,50);
    assert.equal(doc.querySelector("#refresh-source").disabled,false);assert.equal(f.state.batchPlan,null);
    assert.equal(doc.querySelector("#to-target").disabled,true,"cancelled verification must not permit a stale draft to continue");
    assert.match(doc.querySelector("#refresh-status").textContent,/cancelled/i);
    assert.doesNotMatch(doc.querySelector("#refresh-status").textContent,/Rechecking/);
    assert.equal(f.messages.some(m=>["batch-capture","panel-host"].includes(m.kind)),false);
  }finally{release.resolve({error:"source-unavailable"});await pending;f.close();}
});
test("returning to a draft after cancelling its refresh keeps selections but requires source verification again",async()=>{
  const f=await fixture({plan:null,web:webSource(),tabs:[{id:17,title:"Synthetic source"}]}),release=deferred();let pending;
  try{
    const doc=await openWeb(f);checkRow(doc);f.backend.discover=()=>release.promise;
    pending=doc.querySelector("#refresh-source").onclick();
    await doc.querySelector("#back-source").onclick();await stepButton(doc,1).onclick();
    release.resolve(webSource([]));await pending;
    assert.match(doc.querySelector("#selected-count").textContent,/1 selected/);
    assert.equal(doc.querySelectorAll("#source-rows li").length,50);
    assert.equal(doc.querySelector("#to-target").disabled,true);
    assert.match(doc.querySelector("#refresh-status").textContent,/cancelled/i);
    f.backend.discover=async()=>webSource();await doc.querySelector("#refresh-source").onclick();
    assert.equal(doc.querySelector("#to-target").disabled,false);
    assert.match(doc.querySelector("#selected-count").textContent,/1 selected/);
    assert.equal(f.state.batchPlan,null);
  }finally{release.resolve({error:"source-unavailable"});await pending;f.close();}
});
test("resizing the selection keeps focused checkbox and changing pages leaves a keyboard-reachable project control",async()=>{
  const rows=Array.from({length:60},(_,i)=>({id:"r"+i,title:"Synthetic "+i,group:"project:g"+i}));
  const f=await fixture({plan:null,web:webSource(rows,{hint:null}),wide:true,tabs:[{id:17,title:"Synthetic source"}]});try{
    const doc=await openWeb(f),check=doc.querySelector("#source-rows input");check.focus();
    f.resize(false);assert.equal(doc.activeElement,check);f.resize(true);assert.equal(doc.activeElement,check);
    await doc.querySelector("#project-next").onclick();
    assert.equal(doc.activeElement,groupButton(doc,""));
    await groupButton(doc,"project:g59").onclick();checkRow(doc);
    await doc.querySelector("#project-prev").onclick();f.resize(false);
    assert.equal(doc.querySelector("#conversation-pane").closest("li").dataset.group,"project:g59");
    assert.equal(doc.querySelector("#source-rows input").checked,true);
  }finally{f.close();}
});
test("clickable steps gate prerequisites, retain the draft and never submit an import",async()=>{
  const f=await fixture({plan:null,web:webSource(),tabs:[{id:17,title:"Synthetic source"}]});try{
    const doc=f.w.document;
    assert.equal(stepButton(doc,0).getAttribute("aria-current"),"step");
    for(const n of [1,2,3])assert.equal(stepButton(doc,n).disabled,true);
    await openWeb(f);assert.equal(stepButton(doc,2).disabled,true);
    checkRow(doc);assert.equal(stepButton(doc,2).disabled,false);
    await stepButton(doc,2).onclick();
    assert.equal(doc.querySelector("#target-step").hidden,false);
    assert.equal(doc.querySelector("#target-mode").closest("#step-tools")?.id,"step-tools");
    assert.equal(doc.querySelector("#confirm-import").closest(".target-actions")?.className,"target-actions");
    assert.equal(doc.querySelector("#back-selection"),null);assert.equal(doc.querySelector("#return-selection"),null);
    await stepButton(doc,0).onclick();await stepButton(doc,1).onclick();
    assert.equal(doc.querySelector("#source-rows input").checked,true);
    assert.equal(doc.activeElement,stepButton(doc,1));
    assert.equal(f.state.batchPlan,null);assert.deepEqual(f.state.jobs,[]);
    assert.equal(f.calls.some(p=>p==="build"||p==="batch-capture"||p==="panel-host"),false);
  }finally{f.close();}
});
test("compact import header removes the marked block and puts scoped selection on the project right",async()=>{
  const f=await fixture({plan:null,frame:{view:"import",tab:17},web:webSource(),tabs:[{id:17,title:"Synthetic source"}]});try{
    const doc=await openWeb(f);
    for(const id of ["source-label","source-query","selection-view","selection-more","select-visible","source-status","account"])
      assert.equal(doc.getElementById(id),null,id);
    assert.equal(doc.querySelector("#library-link").closest("[hidden]")?.className,"center-head");
    for(const id of ["refresh-source","back-source","selected-count"])
      assert.equal(doc.getElementById(id).closest("#step-tools")?.id,"step-tools",id);
    const line=groupButton(doc,"project:p1").parentElement;
    assert.equal(line.lastElementChild.className,"project-select");
    checkRow(doc);assert.equal(line.querySelector("input").indeterminate,true);
    line.querySelector("input").click();assert.equal(line.querySelector("input").checked,true);
    assert.match(doc.querySelector("#selected-count").textContent,/55 selected/);
    assert.match(doc.querySelector("#group-label").textContent,/partial directory/);
    doc.querySelector("#selected-count").click();
    assert.equal(doc.querySelector("#selected-count").getAttribute("aria-pressed"),"true");
    assert.equal(doc.querySelectorAll("#source-rows li").length,50);
    checkRow(doc);assert.match(doc.querySelector("#selected-count").textContent,/54 selected/);
  }finally{f.close();}
});
test("a late lookup after step navigation cannot update the previous target or create remembered mappings",async()=>{
  const f=await fixture({plan:null,rows:sourceRows(),sourceLookup:true}),reply=deferred(),entered=deferred();let pending;
  try{
    await f.choose([0]);await until(()=>!f.w.document.querySelector("#check-bindings").disabled);
    const doc=f.w.document;await stepButton(doc,1).onclick();
    f.backend.status=async()=>{entered.resolve();return reply.promise;};
    pending=stepButton(doc,2).onclick();await entered.promise;await stepButton(doc,1).onclick();
    reply.resolve({conversation_id:iid});await pending;
    assert.equal(doc.querySelector("#selection-step").hidden,false);assert.equal(doc.querySelector("#source-rows input").checked,true);
    assert.doesNotMatch(doc.querySelector("#source-rows .meta").textContent,/Update existing/);
    assert.equal(f.state.batchPlan,null);assert.equal(f.state.batchMappings,undefined);assert.equal(f.state.rememberedSources,undefined);
    assert.equal(doc.querySelector("#error").textContent,"");
  }finally{reply.resolve({conversation_id:iid});await pending;f.close();}
});
test("updates retain the original project without requiring a stale new-import destination",async()=>{
  const f=await fixture({plan:null,rows:sourceRows(),sourceLookup:true,projects:projectRows()});try{
    const doc=f.w.document;
    await f.storage.set({batchMappings:[{origin:device.origin,user:device.user,source:"same-source",targets:{unknown:projectA}}]});
    f.backend.status=async()=>({conversation_id:iid});
    await f.choose([0]);await until(()=>!doc.querySelector("#check-bindings").disabled);
    assert.equal(doc.querySelectorAll("#target-mappings .mapping-row").length,0);
    assert.match(doc.querySelector("#confirm-import").textContent,/Update 1/);
    f.backend.projects=[];await doc.querySelector("#reload-projects").onclick();
    assert.equal(doc.querySelector("#confirm-import").disabled,false);
    const send=f.w.chrome.runtime.sendMessage;
    f.w.chrome.runtime.sendMessage=async m=>{
      const r=await send(m);
      if(m.kind==="panel-host")await f.storage.set({jobs:f.state.jobs.map(j=>({...j,iid,active:false,packageReady:false,phase:"done"}))});
      return r;
    };
    await doc.querySelector("#confirm-import").onclick();
    assert.equal(f.state.batchPlan.items[0].project,null,"no new-project retargeting is encoded for a verified existing group");
    assert.deepEqual(f.state.batchMappings[0].targets,{unknown:projectA},"update is not a new destination choice");
    assert.deepEqual(f.state.rememberedSources,["one"]);
  }finally{f.close();}
});
test("opening task step is read-only; the running queue blocks draft navigation without overwriting its plan",async()=>{
  const job={device:device.id,key,active:true,phase:"reading",local:true,batch:old.id},f=await fixture({jobs:[job]});let run;
  try{
    await f.choose();const doc=f.w.document;f.calls.length=0;
    await stepButton(doc,3).onclick();
    assert.equal(f.calls.includes("wake"),false,"opening task results is not resuming a queue");
    run=doc.querySelector("#continue-queue").onclick();await until(()=>f.calls.includes("wake"));await sleep(30);
    for(const n of [0,1,2]){assert.equal(stepButton(doc,n).disabled,true);await stepButton(doc,n).onclick();}
    assert.equal(doc.querySelector("#tasks-step").hidden,false);assert.equal(f.state.batchPlan.id,old.id);
    await f.storage.set({jobs:[{...job,iid,active:false,phase:"done"}]});await run;
    assert.equal(stepButton(doc,0).disabled,false);assert.equal(stepButton(doc,1).disabled,false);
    assert.equal(f.calls.includes("build"),false);
  }finally{if(run){await f.storage.set({jobs:[{...job,iid,active:false,phase:"done"}]});await run;}f.close();}
});
test("a memory-write failure after accepting a plan leaves the task recoverable, not a duplicate confirmation form",async()=>{
  const f=await fixture({plan:null});try{
    await f.choose();f.w.ReaderClient.rememberSources=async()=>{throw Error("storage-full");};
    await f.w.document.querySelector("#confirm-import").onclick();
    assert.equal(f.w.document.querySelector("#tasks-step").hidden,false);
    assert.equal(f.state.batchPlan.items.length,1);assert.equal(f.state.batchPlan.items[0].id,"one");
    assert.equal(f.calls.includes("build"),false);assert.match(f.w.document.querySelector("#error").textContent,/temporary storage/);
    assert.equal(f.w.document.querySelector("#continue-queue").disabled,false);
  }finally{f.close();}
});
