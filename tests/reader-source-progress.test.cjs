// Isolated control + real progress components; no browser account/network.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom");
async function fixture(initial,{capture}={}){
  const dom=new JSDOM("<body></body>",{url:"https://chatgpt.com/c/synthetic-progress",runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window,watchers=[],observers=[],requests=[];let backend=initial,root,copied;
  const Observer=w.MutationObserver;
  w.MutationObserver=class extends Observer{constructor(fn){super(fn);observers.push(this);}};
  const attach=w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow=function(options){root=attach.call(this,options);return root;};
  Object.defineProperty(w.navigator,"language",{value:"zh-CN"});
  Object.defineProperty(w.navigator,"clipboard",{value:{async writeText(value){copied=JSON.parse(value);}}});
  w.Date.now=()=>4000;
  w.ReaderPageIndex={sample:()=>1,observeLayout(fn){fn({bottom:76,edge:720,top:0});}};
  w.chrome={runtime:{getManifest:()=>({version:"synthetic"}),onMessage:{addListener(){}},
    async sendMessage(message){requests.push(message);return backend;},
    connect(){return {onMessage:{addListener(fn){watchers.push(fn);}},onDisconnect:{addListener(){}},disconnect(){}};}}};
  for(const f of ["glyphs.js","progress.js","progress-view.js","source-control.js"])w.eval(fs.readFileSync(path.join(__dirname,"../reader",f),"utf8"));
  w.ReaderSourceControl({pathId:()=>"synthetic-progress",capture:capture||(()=>{throw Error("Capture is outside this presentation test.");}),cancel(){}});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();
  return {root,w,requests,close:()=>{observers.forEach(o=>o.disconnect());w.close();},setBackend:value=>{backend=value;},
    async settle(){for(let i=0;i<4;i++)await settle();},
    async update(value){backend=value;watchers.forEach(fn=>fn({refresh:true}));await settle();},
    async diagnostic(){await root.querySelector(".diagnostic").onclick({isTrusted:true});return copied;}};
}
test("explicit resumed null timestamps and diagnostics clear stopped UI; missing legacy fields do not fabricate measurements",async()=>{
  const f=await fixture({state:"paused",stats:{sourceBytes:100,uploadBytes:10},step:{stage:"upload",done:10,total:20},
    startedAt:1000,finishedAt:1500,diagnostic:{category:"network",stage:"upload",code:"NETWORK_UNAVAILABLE"}});
  try{
    assert.match(f.root.querySelector(".progress-elapsed").textContent,/0.5 s/);
    assert.equal((await f.diagnostic()).diagnostic.category,"network");
    await f.update({state:"saving",stats:{uploadBytes:20},step:{stage:"upload",done:20,total:20},
      startedAt:1000,finishedAt:null,diagnostic:null});
    assert.match(f.root.querySelector(".progress-elapsed").textContent,/3.0 s/);
    assert.equal((await f.diagnostic()).diagnostic,null);
    assert.equal((await f.diagnostic()).stats.sourceBytes,100);
    await f.update({state:"saved",finishedAt:3000,diagnostic:null,stats:{uploadBytes:20}});
    assert.match(f.root.querySelector(".progress-elapsed").textContent,/2.0 s/);
    assert.equal(f.root.querySelector(".read-progress").hidden,false,"completion retains its measurements");
    assert.equal(f.root.querySelector(".read-progress>progress").hidden,true,"completion must not leave an upload activity meter");
  }finally{f.close();}
});
test("an existing full-source conversation has an incremental-update main action and a separate open-saved action",async()=>{
  let captures=0;
  const f=await fixture({state:"previous"},{
    async capture(_start,excerpt){assert.equal(excerpt,false);captures++;}
  });
  try{
    assert.match(f.root.querySelector(".main").textContent,/增量更新/);
    f.root.querySelector(".main").onclick({isTrusted:false});await f.settle();assert.equal(captures,0);
    f.root.querySelector(".main").onclick({isTrusted:true});await f.settle();assert.equal(captures,1);
    f.root.querySelector(".toggle").onclick({isTrusted:true});
    const open=[...f.root.querySelectorAll(".menu button")].find(b=>b.textContent==="打开已存版本");
    assert.ok(open);open.onclick({isTrusted:true});await f.settle();
    assert.equal(f.requests.at(-1).kind,"open-saved");assert.equal(captures,1);
  }finally{f.close();}
});
test("an append retains its own attempt, final state and counters rather than the previous full save",async()=>{
  let f;
  f=await fixture({state:"saved",progressKey:"save-record",stats:{sourceBytes:9000},startedAt:1000,finishedAt:2000},{
    async capture(onStart,excerpt,_batch,onProgress){
      assert.equal(excerpt,true);onStart("synthetic-append-attempt");
      onProgress({stage:"upload",done:20,total:20,sourceBytes:100,uploadBytes:20,packageBytes:20});
      f.setBackend({state:"append-ready",progressKey:"append-record",taskPhase:"append-ready",
        stats:{sourceBytes:100,uploadBytes:20,packageBytes:20},step:{stage:"upload",done:20,total:20},startedAt:4000,finishedAt:4000});
    }
  });
  try{
    f.root.querySelector(".toggle").onclick({isTrusted:true});
    [...f.root.querySelectorAll(".menu button")].find(b=>b.textContent==="选择内容并追加到…").onclick({isTrusted:true});
    await f.settle();
    assert.equal(f.requests.filter(r=>r.kind==="source-state").at(-1).attempt,"synthetic-append-attempt");
    assert.equal((await f.diagnostic()).stats.sourceBytes,100);
    assert.match(f.root.querySelector(".main").textContent,/继续追加/);
    assert.match(f.root.querySelector(".progress-rows [data-stage=server]").textContent,/等待.*确认/);
    assert.equal(f.root.querySelector(".read-progress>progress").hidden,true);
    f.root.querySelector(".main").onclick({isTrusted:true});await f.settle();
    assert.equal(f.requests.at(-1).kind,"open-append");assert.equal(f.requests.at(-1).attempt,"synthetic-append-attempt");
    await f.update({state:"append-complete",progressKey:"append-record",taskPhase:"append-complete",
      stats:{sourceBytes:100,uploadBytes:20},startedAt:4000,finishedAt:4000,diagnostic:null});
    assert.match(f.root.querySelector(".main").textContent,/追加已完成/);
    assert.match(f.root.querySelector(".progress-rows [data-stage=server]").textContent,/已确认追加/);
  }finally{f.close();}
});
test("different opaque display records and account removal cannot blend or retain another task's measurements",async()=>{
  const f=await fixture({state:"paused",progressKey:"first",stats:{sourceBytes:9000,textBytes:8000},startedAt:1000,finishedAt:2000,
    diagnostic:{category:"network",stage:"upload",code:"NETWORK_UNAVAILABLE"}});
  try{
    await f.update({state:"saving",progressKey:"second",stats:{sourceBytes:50},startedAt:3000,finishedAt:null,diagnostic:null});
    assert.deepEqual((await f.diagnostic()).stats,{sourceBytes:50});
    await f.update({state:"connect",progressKey:null});
    assert.equal(f.root.querySelector(".read-progress").hidden,true);
    assert.deepEqual((await f.diagnostic()).stats,{});
    assert.equal((await f.diagnostic()).diagnostic,null);
  }finally{f.close();}
});
