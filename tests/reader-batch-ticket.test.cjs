const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=name=>fs.readFileSync(require("node:path").join(__dirname,"../reader",name),"utf8");
const key="11111111-1111-4111-8111-111111111111",id="a".repeat(32),event={addListener(){}};
const device={id:"device",user:"user",origin:"https://reader.test"};
function area(state){return {async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(state[k])]))},
  async set(value){Object.assign(state,value)},async remove(key){delete state[key]}};}
async function ticket(change){
  const listeners=[],item={key,id:"chat",project:null,cancelled:false},plan={id:"plan",device:device.id,user:device.user,origin:device.origin,source:{scope:"scope"},items:[item]};
  change?.(plan,item);
  const t={batch:"plan",attempt:key,sourceId:"chat",scope:"scope",tab:1,project:null,device:device.id,path:"/c/chat",expires:Date.now()+30000};
  const env=vm.createContext({URL,Date,importScripts(){},READER_ORIGIN:device.origin,liveBatch:async()=>true,ReaderClient:{trust:Promise.resolve()},
    chrome:{runtime:{id,getURL:p=>`chrome-extension://${id}/${p}`,onMessage:{addListener:f=>listeners.push(f)},onInstalled:event,onStartup:event},
      storage:{local:area({device,batchPlan:plan}),session:area({"ticket:t":t}),onChanged:event},alarms:{onAlarm:event},downloads:{onChanged:event}}});
  vm.runInContext(source("background.js"),env);
  return new Promise(resolve=>listeners[0]({kind:"host-rpc",op:"ticket",ticket:"t",tab:1,doc:"doc"},{url:`chrome-extension://${id}/host.html`},resolve));
}
test("a one-use batch ticket belongs to the current fixed, uncancelled plan item",async()=>{
  assert.equal((await ticket()).value?.attempt,key);
  for(const mutate of [(p,i)=>{i.cancelled=true},(p,i)=>{i.skipped=true},p=>{p.user="other"},p=>{p.id="new-plan"},
    (p,i)=>{i.project="new-target"},p=>{p.source.scope="other-workspace"},(p,i)=>{i.id="other-chat"}])
    assert.ok((await ticket(mutate)).error,"stale or cancelled ticket must be rejected");
});
