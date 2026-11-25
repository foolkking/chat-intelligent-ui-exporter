// Synthetic source API and transport only. Executes the actual isolated capture + fork parser,
// without a personal ChatGPT/Reader session or any external requests.
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm");
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),sha=x=>crypto.createHash("sha256").update(x).digest("hex");

async function fixture({brokenFile=false,textOnly=false}={}){
  const body=("Tidal observations 🪐 "+ "x".repeat(101)+"\n").repeat(18000);
  const media=Buffer.alloc(17*1024*1024+7,31),progress=[],rows=[],assets=new Map(),requests=[];
  let control,liveRow,liveFile,finish,maxText=0,maxChunk=0;
  const source={conversation_id:"synthetic",title:"Synthetic tidal notebook",current_node:"n2",mapping:{
    n0:{parent:null,children:["n1"],message:{id:"m0",author:{role:"user"},content:{content_type:"text",parts:["Keep the source file."]},
      metadata:{attachments:[{id:"file-synthetic",name:"data.bin"}]}}},
    n1:{parent:"n0",children:["n2"],message:{id:"m1",author:{role:"system"},content:{content_type:"text",parts:["NOT_FOR_READER".repeat(700000)]}}},
    n2:{parent:"n1",children:[],message:{id:"m2",author:{role:"assistant"},content:{content_type:"text",parts:[body]}}}
  }};
  const raw=JSON.stringify(source);
  assert.ok(Buffer.byteLength(raw)>8*1024*1024);
  const response=async(input,options)=>{
    const u=new URL(input,"https://chatgpt.com");requests.push(u.pathname);
    if(u.pathname==="/api/auth/session")return Response.json({accessToken:"synthetic-only-not-a-credential"});
    if(u.pathname==="/backend-api/conversation/synthetic")return new Response(raw,{headers:{"Content-Length":String(Buffer.byteLength(raw))}});
    if(u.pathname==="/backend-api/files/download/file-synthetic")
      return Response.json({download_url:"https://fixture.oaiusercontent.com/synthetic.bin"});
    if(u.hostname==="fixture.oaiusercontent.com"){
      assert.equal(options.credentials,"omit");assert.deepEqual(Object.keys(options.headers),[]);
      let pos=0;
      return new Response(new ReadableStream({pull(c){
        if(brokenFile&&pos>400000){c.error(Error("Synthetic interrupted response"));return;}
        if(pos===media.length){c.close();return;}
        const end=Math.min(pos+128*1024,media.length);c.enqueue(new Uint8Array(media.subarray(pos,end)));pos=end;
      }}),{headers:{"Content-Length":String(media.length),"Content-Type":"application/octet-stream"}});
    }
    throw Error("Unexpected fixture request: "+u.pathname);
  };
  function port(){
    let receive,disconnect;return {onMessage:{addListener(fn){receive=fn;}},onDisconnect:{addListener(fn){disconnect=fn;}},
      disconnect(){disconnect?.();},
      postMessage(m){
        if(m.op==="observe")return;
        queueMicrotask(()=>{
          try{
            if(m.op==="asset"){liveFile={name:m.path,chunks:[]};}
            else if(m.op==="chunk"){const data=Buffer.from(m.data,"base64");maxChunk=Math.max(maxChunk,data.length);liveFile.chunks.push(data);}
            else if(m.op==="endAsset"){assets.set(liveFile.name,Buffer.concat(liveFile.chunks));liveFile=null;}
            else if(m.op==="dropAsset"){liveFile=null;}
            else if(m.op==="message-start"){liveRow={...m.row,parts:[]};}
            else if(m.op==="text"){maxText=Math.max(maxText,m.value.length);liveRow.parts.push(m.value);}
            else if(m.op==="message-end"){rows.push({...liveRow,body:liveRow.parts.join("")});liveRow=null;}
            else if(m.op==="finish")finish=m;
            receive({ok:true});
          }catch(e){receive({error:e.message});}
        });
      }};
  }
  const env=vm.createContext({console,URL,Blob,Response,Headers,ReadableStream,TransformStream,TextEncoder,TextDecoder,
    AbortController,crypto:crypto.webcrypto,performance,setTimeout,clearTimeout,setInterval,clearInterval,
    btoa:s=>Buffer.from(s,"latin1").toString("base64"),
    navigator:{language:"zh-CN",deviceMemory:2},location:{pathname:"/c/synthetic",origin:"https://chatgpt.com"},
    document:{querySelector:()=>null,documentElement:{}},MutationObserver:class{observe(){}disconnect(){}},
    addEventListener(){},removeEventListener(){},fetch:response,
    ReaderPageIndex:{leaf:()=>undefined,sample:()=>1,mounted:()=>["m0","m2"].map(id=>({dataset:{messageId:id}}))},
    ReaderOverlay(){},ReaderSourceControl(opts){control=opts;},
    chrome:{runtime:{sendMessage:async()=>({ticket:"ticket",attempt:"attempt",textOnly}),connect:port}}
  });
  for(const file of ["extension/locales/en.js","extension/i18n.js","extension/fast-text.js","reader/progress.js",
                    "reader/source-file.js","reader/visible.js","reader/capture.js"])
    vm.runInContext(fs.readFileSync(path.join(root,file),"utf8"),env,{filename:file});
  await control.capture(()=>{},false,null,step=>progress.push(step));
  return {body,media,rows,assets,finish,progress,maxText,maxChunk,requests,rawBytes:Buffer.byteLength(raw)};
}

test("capture beyond old JSON/message/resource caps is lossless and reports real reading/asset counters",async()=>{
  const r=await fixture();
  assert.equal(r.rows.length,2);
  assert.equal(r.rows[1].body,r.body);
  assert.deepEqual(Array.from(r.rows[1].sourcePath),["n1","n2"]);
  assert.ok(Buffer.byteLength(r.body)>2*1024*1024);
  assert.equal(r.assets.size,1);
  assert.equal(sha([...r.assets.values()][0]),sha(r.media));
  assert.ok(r.maxText<=65536&&r.maxChunk<=196608);
  assert.equal(r.finish.partial,false);
  const stages=new Set(r.progress.map(p=>p.stage));
  for(const stage of ["source","index","messages","asset"])assert.ok(stages.has(stage),stage);
  assert.ok(r.progress.some(p=>p.stage==="index"&&p.done===3));
  assert.ok(r.progress.some(p=>p.stage==="asset"&&p.done===r.media.length&&p.total===r.media.length));
  assert.ok(r.progress.some(p=>p.stage==="source"&&p.done===r.rawBytes));
  assert.ok(r.rows.every(row=>!row.body.includes("NOT_FOR_READER")));
});

test("an interrupted large media response is dropped, explicitly partial, never silently complete",async()=>{
  const r=await fixture({brokenFile:true});
  assert.equal(r.assets.size,0);assert.equal(r.rows.length,2);
  assert.equal(r.finish.partial,true);assert.equal(r.finish.losses.files,1);
  assert.match(r.rows[0].body,/\[unavailable\]/);
  assert.equal(r.rows[1].body,r.body);
});

test("an explicit text-only choice does not fetch media and never truncates long text",async()=>{
  const r=await fixture({textOnly:true});
  assert.equal(r.assets.size,0);assert.equal(r.rows[1].body,r.body);
  assert.equal(r.finish.partial,false);
  assert.match(r.rows[0].body,/\[text only\]/);
  assert.ok(!r.requests.some(p=>p.includes("files/")));
});
