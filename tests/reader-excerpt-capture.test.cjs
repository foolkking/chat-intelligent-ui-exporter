// Tests the real capture/selection transport with an instrumented lazy provider.
// The existing reader-capture tests separately exercise the actual Fork parser.
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm");
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"..");
async function fixture({count=1001,extended=true,picks,excerpt=true,warnings=[]}={}){
  const operations=[],sourceReads=[],progress=[];
  let control,chooseCount=0;
  const row=i=>({id:"m"+i,role:i%2?"assistant":"user",md:`Message ${i} · 潮汐 🪐`,sourcePath:["n"+i]});
  const data={source:"conversation-tree",title:"Synthetic selection",warnings,ids:new Set(Array.from({length:count},(_,i)=>"m"+i)),
    async *rows(){for(let i=0;i<count;i++)yield row(i);},
    async row(id){sourceReads.push(id);return row(Number(id.slice(1)));}};
  const event=()=>({addListener(){}});
  const env=vm.createContext({console,URL,Blob,Response,Headers,ReadableStream,TransformStream,TextEncoder,TextDecoder,
    AbortController,DOMException,crypto:crypto.webcrypto,performance,setTimeout,clearTimeout,setInterval,clearInterval,
    navigator:{language:"en-US",deviceMemory:2},location:{pathname:"/c/synthetic",origin:"https://chatgpt.com"},
    document:{querySelector:()=>null,documentElement:{}},MutationObserver:class{observe(){}disconnect(){}},
    addEventListener(){},removeEventListener(){},fetch(){throw Error("No network expected");},
    ChatExportI18n:{setLocale(){}},FastTextExporter:{loadConversation:async()=>data},
    ReaderSourceFile:{conversation:()=>({})},ReaderVisible:m=>({body:m.md}),
    ReaderPageIndex:{leaf:()=>undefined,sample:()=>1},
    ChatExportSourceDOM:{generating:()=>false,verify:()=>true,remember(){}},
    ReaderOverlay(){},ReaderSourceControl(opts){control=opts;},
    chrome:{runtime:{
      sendMessage:async m=>m.kind==="open-append"?{ok:true}:{ticket:"ticket",attempt:"attempt",extendedSelection:extended},
      connect(){
        let receive;
        return {onMessage:{addListener(fn){receive=fn;}},onDisconnect:event(),disconnect(){},
          postMessage(m){operations.push(JSON.parse(JSON.stringify(m)));
            if(m.op!=="observe")queueMicrotask(()=>receive({ok:true}));}};
      }
    }}
  });
  for(const file of ["reader/progress.js","reader/append-picker.js","reader/capture.js"])
    vm.runInContext(fs.readFileSync(path.join(root,file),"utf8"),env,{filename:file});
  env.ReaderExcerpt.choose=async(messages,title,preview,signal,options)=>{
    chooseCount++;
    assert.equal(messages.length,count);
    assert.ok(messages.every(m=>Object.keys(m).sort().join(",")==="id,role,title"));
    assert.ok(messages.every(m=>m.title.length<=220),"The selector must not retain full normalized messages.");
    assert.equal(options.extended,extended);
    assert.equal(await preview(messages[count-1],signal),row(count-1).md);
    return new Set(picks??messages.map((_,i)=>i));
  };
  let error;
  try{await control.capture(()=>{},excerpt,null,step=>progress.push(step));}catch(e){error=e;}
  return {operations,sourceReads,progress,chooseCount,error};
}
test("1001 selected messages hydrate one at a time and all reach the existing excerpt transport",async()=>{
  const r=await fixture();assert.ifError(r.error);
  const rows=r.operations.filter(m=>m.op==="message-start").map(m=>m.row);
  assert.equal(rows.length,1001);assert.equal(r.sourceReads.length,1002);
  assert.equal(r.sourceReads[0],"m1000","One preview is independent from the later transport pass.");
  assert.deepEqual(r.sourceReads.slice(1),Array.from({length:1001},(_,i)=>"m"+i));
  for(let i=0;i<rows.length;i++){
    assert.equal(rows[i].id,"m"+i);assert.equal(rows[i].role,i%2?"assistant":"user");
    assert.equal(rows[i].sourcePath,undefined,"An excerpt never impersonates continuous source lineage.");
    assert.equal(rows[i].question,i%2?"m"+(i-1):undefined);
  }
  const header=r.operations.find(m=>m.op==="header");assert.equal(header.lineage,"list");
  const finish=r.operations.find(m=>m.op==="finish");assert.equal(finish.partial,false);
  assert.ok(r.progress.some(p=>p.stage==="messages"&&p.done===1001&&p.total===1001));
});
test("a sparse cross-page selection sends only selected bodies and no unselected question association",async()=>{
  const r=await fixture({picks:[1,248,249,999,1000]});assert.ifError(r.error);
  const rows=r.operations.filter(m=>m.op==="message-start").map(m=>m.row);
  assert.deepEqual(rows.map(m=>m.id),["m1","m248","m249","m999","m1000"]);
  assert.deepEqual(rows.map(m=>m.question??null),[null,null,"m248",null,null]);
  assert.deepEqual(r.sourceReads,["m1000","m1","m248","m249","m999","m1000"]);
});
test("legacy Reader cannot silently truncate or begin uploading an oversized selected excerpt",async()=>{
  const r=await fixture({extended:false});
  assert.match(r.error?.message||"",/Invalid selection/);
  assert.ok(!r.operations.some(m=>["header","message-start","text","finish"].includes(m.op)));
  assert.equal(r.chooseCount,1);
});
test("a complete capture counts each source conversion warning once and keeps a partial result",async()=>{
  const r=await fixture({count:2,excerpt:false,warnings:[{type:"thoughts"},{type:"reasoning_recap"}]});
  assert.ifError(r.error);
  const finish=r.operations.find(m=>m.op==="finish");
  assert.equal(finish.partial,true);assert.equal(finish.losses.interactions,2);
});
