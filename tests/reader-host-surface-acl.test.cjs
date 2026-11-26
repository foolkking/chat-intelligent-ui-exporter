// Synthetic MessageSender contract only; native sidePanel sender shape is not browser evidence.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const id="a".repeat(32),base="chrome-extension://"+id+"/",device="synthetic-device";
const read=name=>fs.readFileSync(path.join(__dirname,"../reader",name),"utf8");
async function fixture(){
  const listeners=[],calls=[];let parent=true;
  const env=vm.createContext({URL,Date,READER_ORIGIN:"https://reader.example.test",setInterval(){},
    navigator:{storage:{getDirectory:async()=>({async *[Symbol.asyncIterator](){}})}},
    chrome:{runtime:{id,getURL:name=>base+name,onConnect:{addListener(){}},onMessage:{addListener:fn=>listeners.push(fn)},
      sendMessage:async message=>{
        calls.push(message);
        if(message.kind==="panel-allowed")return parent&&message.tab===7&&["library","import"].includes(message.doc);
        if(message.op==="device")return {value:device};
        if(message.op==="jobs")return {value:[]};
        throw Error("Unexpected private RPC");
      }}}});
  vm.runInContext(read("host.js"),env);await vm.runInContext("initialized",env);
  const center=vm.createContext({URL,authorizedFrame:async()=>null,chrome:{runtime:{id,onMessage:{addListener(){}}}}});
  vm.runInContext(read("batch-worker.js"),center);
  return {calls,center:s=>center.centerPage(s),revoke:()=>{parent=false;},
    send:(sender,owner=device)=>new Promise(resolve=>{
      for(const listener of listeners)if(listener({kind:"panel-host",op:"check",key:"unknown",device:owner},sender,resolve)===true)return;
      resolve(undefined);
    })};
}
test("host and worker use the same exact center-page sender boundary, including synthetic no-tab native contexts",async()=>{
  const f=await fixture();
  const cases=[
    [{id,url:base+"center.html"},true],
    [{id,url:base+"center.html",frameId:0},true],
    [{id,url:base+"center.html?tab=7",tab:{id:9},frameId:0},true],
    [{id,url:base+"center.html#retained",frameId:0},true],
    [{id,url:base+"center.html",tab:{id:7},frameId:2},false],
    [{id,url:base+"center.html",frameId:2},false],
    [{id,url:base+"center.html",tab:{id:7}},false],
    [{id,url:base+"center.html",frameId:0,documentLifecycle:"cached"},false],
    [{id:"b".repeat(32),url:base+"center.html",frameId:0},false],
    [{id,url:"https://chatgpt.com/center.html",frameId:0},false],
    [{id,url:base+"nested/center.html",frameId:0},false],
    [{id,url:base+"center.html.bak",frameId:0},false],
    [{id,url:base+"frame.html?view=import",frameId:0},false]
  ];
  for(const [sender,allowed] of cases){
    f.calls.length=0;
    assert.equal(await f.center(sender),allowed,JSON.stringify(sender));
    const reply=await f.send(sender);
    assert.equal(reply?.error==="Task not found.",allowed,JSON.stringify(sender));
    assert.equal(f.calls.some(c=>c.op==="device"),allowed,JSON.stringify(sender));
  }
});
test("embedded frames still require host-delegated grant validation and lose actions when the parent is revoked",async()=>{
  const f=await fixture();
  for(const view of ["library","import"]){
    const sender={id,url:base+"frame.html#ticket",tab:{id:7},frameId:4,documentId:view};f.calls.length=0;
    assert.equal((await f.send(sender)).error,"Task not found.");
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),{kind:"panel-allowed",tab:7,doc:view});
    assert.equal((await f.send(sender,"other-account")).error,"Reader account changed.");
  }
  f.revoke();
  for(const doc of ["library","import"]){
    f.calls.length=0;
    assert.equal((await f.send({id,url:base+"frame.html#ticket",tab:{id:7},frameId:4,documentId:doc})).error,"Open Reader again.");
    assert.equal(f.calls.some(c=>c.op==="device"),false);
  }
});
