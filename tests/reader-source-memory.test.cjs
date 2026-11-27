// Trusted worker/client with synthetic state. No browser, credentials or API.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const dir=path.join(__dirname,"../reader"),crypto=require("node:crypto").webcrypto;
const cid="00000000-0000-4000-8000-000000000007";
async function fixture(){
  const device={id:"synthetic-device",user:"synthetic-user",origin:"https://reader.example.test"};
  const local={device},session={},calls=[],writes=[];
  const store=data=>({async setAccessLevel(){},async get(keys){return Object.fromEntries((keys===null?Object.keys(data):Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]));},
    async set(patch){Object.assign(data,structuredClone(patch));writes.push(Object.keys(patch));},
    async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key];},async clear(){for(const key of Object.keys(data))delete data[key];}});
  const c=vm.createContext({READER_ORIGIN:device.origin,TextEncoder,crypto,URL,
    navigator:{locks:{request:async(_n,fn)=>fn()}},source:()=>true,currentSource:async()=>true,
    chrome:{storage:{local:store(local),session:store(session)},runtime:{onConnect:{addListener(){}}},
      tabs:{onActivated:{addListener(){}}}}});
  vm.runInContext(fs.readFileSync(path.join(dir,"client.js"),"utf8"),c);await c.ReaderClient.trust;
  let found=cid;
  c.ReaderClient.request=async(_d,p,opts)=>{calls.push({p,opts});return {json:async()=>p==="capabilities"?
    {protocol:1,import_profile:"reader-chat-v1",capture:true,resumable_capture:true,source_lookup:true,selective_append:true}:
    p==="sources/status"?{conversation_id:found}:[]};};
  vm.runInContext(fs.readFileSync(path.join(dir,"source-actions.js"),"utf8"),c);
  const invoke=(kind,id="synthetic-source")=>c.ReaderSourceAction({kind},{tab:{id:1},documentId:"synthetic-document"},"/c/"+id,async()=>{});
  return {c,device,local,session,calls,writes,invoke,setFound:value=>{found=value;}};
}
test("reading a source never remembers it; explicit update remembers only its account-scoped hash and revalidates the current binding",async()=>{
  const f=await fixture();
  assert.equal((await f.invoke("source-state")).state,"destination");assert.equal(f.local.sourceChecks,undefined);assert.equal(f.calls.length,0);
  const result=await f.invoke("start");assert.ok(result.ticket,"an existing source can update without choosing a new project");
  assert.equal(f.session["ticket:"+result.ticket].project,null);
  assert.equal(f.session["ticket:"+result.ticket].mode,"save","the regular integrity-checked full-source route is retained");
  const saved=f.local.sourceChecks;assert.equal(saved.keys.length,1);assert.match(saved.keys[0],/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(saved),/synthetic-source|00000000-0000-4000-8000-000000000007/);
  f.calls.length=0;
  assert.equal((await f.invoke("source-state")).state,"previous");
  assert.deepEqual(f.calls.map(r=>r.p),["capabilities","sources/status"]);
  f.setFound(null);assert.equal((await f.invoke("source-state")).state,"destination","a remembered action never fabricates a server binding");
  f.calls.length=0;await f.invoke("source-state","other-source");assert.equal(f.calls.length,0,"no account-wide tracking opt-in");
  f.local.device={...f.device,user:"another-user"};
  assert.equal(await f.c.ReaderClient.rememberedSource(f.device,"synthetic-source"),false);
  await assert.rejects(f.c.ReaderClient.rememberSources(f.device,["another"]),/owner-changed/);
});
test("selective append remembers the explicit source without assigning or confirming a Reader target",async()=>{
  const f=await fixture();f.setFound(null);
  const result=await f.invoke("start-append");assert.ok(result.ticket);
  const ticket=f.session["ticket:"+result.ticket];
  assert.equal(ticket.mode,"append");assert.equal(ticket.project,null);
  assert.equal(await f.c.ReaderClient.rememberedSource(f.device,"synthetic-source"),true);
  assert.equal(f.calls.some(r=>/commit|append-imports/.test(r.p)),false);
});
test("missing source without a save destination and malformed binding never create a ticket or remembered action",async()=>{
  for(const found of [null,"invalid-reader-id",undefined]){
    const f=await fixture();f.setFound(found);const r=await f.invoke("start");
    assert.equal(r.ticket,undefined);assert.equal(f.local.sourceChecks,undefined);assert.deepEqual(f.session,{});
  }
});
test("multiple explicit selections are remembered, but an account switch rejects delayed writes",async()=>{
  const f=await fixture();
  await f.c.ReaderClient.rememberSources(f.device,["one","two"]);await f.c.ReaderClient.rememberSources(f.device,["two","three"]);
  assert.equal(f.local.sourceChecks.keys.length,3);
  const before=structuredClone(f.local.sourceChecks);f.local.device={...f.device,id:"another-device"};
  await assert.rejects(f.c.ReaderClient.rememberSources(f.device,["four"]),/owner-changed/);
  assert.deepEqual(f.local.sourceChecks,before);
});
test("an update does not depend on the availability of an unrelated default project",async()=>{
  const f=await fixture();
  f.local.destination={device:f.device.id,project:"00000000-0000-4000-8000-000000000002"};
  const result=await f.invoke("start");assert.ok(result.ticket);
  assert.equal(f.calls.some(r=>r.p==="projects"),false);
  assert.equal(f.session["ticket:"+result.ticket].project,null);
  assert.equal(f.local.destination.project,"00000000-0000-4000-8000-000000000002");
});
