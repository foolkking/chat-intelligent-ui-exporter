// The actual source parser, capture, host, archive and resumable uploader, with
// synthetic DOM/API/OPFS/runtime boundaries. Never opens a browser or real session.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const crypto=require("node:crypto"),{JSDOM}=require("jsdom"),fflate=require("../../reader/vendor/fflate-0.8.3.js");
const root=path.resolve(__dirname,"../.."),sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const sourceId="synthetic-image",device="00000000-0000-4000-8000-000000000001",key="00000000-0000-4000-8000-000000000002";
const iid="00000000-0000-4000-8000-000000000003",ticket="00000000-0000-4000-8000-000000000004";
function directory(){
  const files=new Map(),dirs=new Map();
  return {files,dirs,async *[Symbol.asyncIterator](){yield* dirs;yield* files;},
    async getDirectoryHandle(name,{create=false}={}){
      if(!dirs.has(name)&&!create)throw Object.assign(Error("Missing staged directory"),{name:"NotFoundError"});
      if(!dirs.has(name))dirs.set(name,directory());return dirs.get(name);
    },
    async getFileHandle(name,{create=false}={}){
      if(!files.has(name)&&!create)throw Object.assign(Error("Missing staged file"),{name:"NotFoundError"});
      if(!files.has(name))files.set(name,new Blob());
      return {name,async getFile(){return files.get(name);},async createWritable(){
        const chunks=[];return {async write(value){chunks.push(value);},
          async close(){files.set(name,new Blob(chunks));},async abort(){chunks.length=0;}};
      }};
    },async removeEntry(name){files.delete(name);dirs.delete(name);}
  };
}
function locks(){
  const tails=new Map();
  return {request(name,options,fn){
    const run=fn||options;
    if(options?.ifAvailable&&tails.has(name))return Promise.resolve(run(null));
    const next=(tails.get(name)||Promise.resolve()).catch(()=>{}).then(()=>run({name}));
    tails.set(name,next);return next.finally(()=>{if(tails.get(name)===next)tails.delete(name);});
  }};
}
async function capture({image=true,text="",nodeIDs=false,excerptCount=0,hostExtended=false,packageDir=null}={}){
  // Only execute reviewed, locally built packages. The caller pins the complete ZIP first.
  const modules={};
  const resolveProduct=file=>packageDir?path.join(packageDir,file.replace(/^(?:reader|extension)\//,"")):path.join(root,file);
  function product(file){
    const bytes=fs.readFileSync(resolveProduct(file));
    if(packageDir)assert.deepEqual(bytes,Buffer.from(fs.readFileSync(path.join(root,file),"latin1").replace(/\r\n/g,"\n"),"latin1"),
      "Refusing to execute an unreviewed package member: "+file);
    modules[file]=sha(bytes);return bytes;
  }
  const vendor="reader/vendor/fflate-0.8.3.js";product(vendor);
  const archiveLibrary=require(resolveProduct(vendor));
  const source={conversation_id:sourceId,title:"Synthetic image 潮汐",current_node:"n1",mapping:{
    root:{parent:null,children:["n0"],message:null},
    n0:{parent:"root",children:["n1"],message:{id:"u",author:{role:"user"},create_time:1700000000,
      content:{content_type:image?"multimodal_text":"text",parts:image?
        [text,{content_type:"image_asset_pointer",asset_pointer:"https://example.invalid/synthetic.png"}]:[text]}}},
    n1:{parent:"n0",children:[],message:{id:"a",author:{role:"assistant"},create_time:1700000001,
      content:{content_type:"text",parts:["Synthetic answer 🪐 must survive."]}}}
  }};
  for(let i=2;i<excerptCount;i++){
    const parent=source.current_node,id="n"+i;
    source.mapping[parent].children.push(id);
    source.mapping[id]={parent,children:[],message:{id:"m"+i,author:{role:i%2?"assistant":"user"},
      create_time:1700000000+i,content:{content_type:"text",parts:["Synthetic message "+i]}}};
    source.current_node=id;
  }
  const opfs=directory(),requests=[],sourceRequests=[],trace=[],pending=new Set();
  let connectHost,control,jobs=[],binding,bytes=Buffer.alloc(0),accepted,finish;
  const host=vm.createContext({console,URL,Blob,Response,Headers,FormData,TextEncoder,TextDecoder,performance,fflate:archiveLibrary,crypto:crypto.webcrypto,
    setTimeout,clearTimeout,setInterval(){return 1;},clearInterval(){},
    atob:value=>Buffer.from(value,"base64").toString("latin1"),READER_ORIGIN:"https://reader.example.test",
    navigator:{language:"en",storage:{getDirectory:async()=>opfs},locks:locks()},
    async fetch(url,opts={}){
      const route=new URL(url).pathname.replace("/api/extension/v1/","");
      requests.push({route,method:opts.method||"GET"});
      if(route==="requests/"+key)return Response.json({id:null});
      if(route==="transfers/"+key){
        assert.equal(opts.method,"POST");binding=JSON.parse(opts.body);
        return Response.json({id:null,offset:0,size:binding.size,chunk_bytes:4*1024*1024});
      }
      if(route==="transfers/"+key+"/chunks"){
        const part=Buffer.from(await opts.body.get("chunk").arrayBuffer());
        assert.equal(Number(opts.body.get("offset")),bytes.length);assert.equal(opts.body.get("sha256"),sha(part));
        bytes=Buffer.concat([bytes,part]);return Response.json({offset:bytes.length,size:binding.size});
      }
      if(route==="transfers/"+key+"/finish"){
        assert.equal(bytes.length,binding.size);assert.equal(sha(bytes),binding.sha256);
        accepted=bytes;return Response.json({id:iid});
      }
      throw Error("No real network: unexpected Reader request "+route);
    },
    chrome:{runtime:{id:"a".repeat(32),onMessage:{addListener(){}},onConnect:{addListener(fn){connectHost=fn;}},
      async sendMessage(m){
        if(m.op==="device")return {value:device};
        if(m.op==="ticket")return {value:{attempt:key,device,sourceId,sourceKey:"synthetic-only",
          path:"/c/"+sourceId,mode:excerptCount?"append":"save",extendedSelection:hostExtended,tab:1,doc:"synthetic-document"}};
        if(m.op==="source-current")return {value:true};
        if(m.op==="jobs")return {value:structuredClone(jobs)};
        if(m.op==="saveJobs"){jobs=structuredClone(m.jobs);return {};}
        if(m.op==="batch")return {value:null};
        if(m.op==="access")return {value:"synthetic-only-no-credential"};
        throw Error("Unexpected synthetic host RPC "+m.op);
      }}}
  });
  for(const file of ["sha256.js","package.js","progress.js","upload.js","transfer-state.js","host.js"])
    vm.runInContext(product("reader/"+file).toString("utf8"),host,{filename:file});
  await vm.runInContext("initialized",host);
  function connect(){
    let receiveContent,receiveHost,disconnectContent,disconnectHost,closed=false;
    const disconnect=()=>{if(closed)return;closed=true;disconnectContent?.();disconnectHost?.();};
    connectHost({name:"reader:"+ticket,sender:{tab:{id:1},frameId:0,documentId:"synthetic-document",url:"https://chatgpt.com/c/"+sourceId},
      onMessage:{addListener(fn){receiveHost=fn;}},onDisconnect:{addListener(fn){disconnectHost=fn;}},
      postMessage(m){queueMicrotask(()=>receiveContent(structuredClone(m)));},disconnect});
    return {onMessage:{addListener(fn){receiveContent=fn;}},onDisconnect:{addListener(fn){disconnectContent=fn;}},
      postMessage(m){
        trace.push(m.op);if(m.op==="finish")finish=structuredClone(m);
        queueMicrotask(()=>{
          const operation=Promise.resolve(receiveHost(structuredClone(m)));pending.add(operation);
          void operation.finally(()=>pending.delete(operation));
        });
      },disconnect};
  }
  const dom=new JSDOM(`<main data-current-node-id="${source.current_node}">`+
    `<article data-testid="conversation-turn-0"><div data-message-id="${nodeIDs?"n0":"u"}" data-message-author-role="user"><div class="markdown">Synthetic image</div></div></article>`+
    `<article data-testid="conversation-turn-1"><div data-message-id="${nodeIDs?"n1":"a"}" data-message-author-role="assistant"><div class="markdown">Synthetic answer</div></div></article></main>`,
    {url:"https://chatgpt.com/c/"+sourceId,pretendToBeVisual:true,runScripts:"outside-only"});
  const w=dom.window;
  Object.assign(w,{TextEncoder,TextDecoder,Blob,Response,Headers,ReadableStream,TransformStream,AbortController,
    ReaderOverlay(){},ReaderSourceControl(value){control=value;},
    chrome:{runtime:{connect,sendMessage:async m=>m.kind==="open-append"?{ok:true}:{ticket,attempt:key,extendedSelection:true}}},
    async fetch(input){
      const url=new URL(input,"https://chatgpt.com");sourceRequests.push(url.pathname);
      if(url.pathname==="/api/auth/session")return Response.json({accessToken:"synthetic-only-no-credential"});
      if(url.pathname==="/backend-api/conversation/"+sourceId)return Response.json(source);
      throw Error("No real network: unexpected source request "+url.pathname);
    }});
  Object.defineProperty(w,"crypto",{value:crypto.webcrypto});
  w.Element.prototype.getClientRects=()=>[{top:0,left:0,bottom:40,right:300,width:300,height:40}];
  w.Element.prototype.checkVisibility=()=>true;
  try{
    for(const file of ["extension/locales/en.js","extension/i18n.js","extension/fast-text.js","extension/source-dom.js","reader/progress.js",
      "reader/source-file.js","reader/visible.js","reader/page-index.js","reader/append-picker.js","reader/capture.js"])
      w.eval(product(file).toString("utf8"));
    const expectedFallback="> "+w.ChatExportI18n.t("md.needsImages");
    if(excerptCount)w.ReaderExcerpt.choose=async messages=>w.ReaderExcerpt.model(messages).picks;
    await control.capture(()=>{},excerptCount>0,null,()=>{});
    await Promise.all([...pending]);
    return {modules,bytes:accepted,binding,jobs,finish,trace,requests,sourceRequests,opfs,expectedFallback};
  }finally{await Promise.allSettled([...pending]);w.close();}
}
function unpack(run){
  assert.ok(run.bytes,"the actual host must finish uploading a sealed package");
  const zip=fflate.unzipSync(run.bytes);
  assert.deepEqual(Object.keys(zip).sort(),["conversation.md","manifest.json","reader/source.jsonl"]);
  const manifest=JSON.parse(Buffer.from(zip["manifest.json"])),md=Buffer.from(zip["conversation.md"]);
  const rows=Buffer.from(zip["reader/source.jsonl"]).toString().trim().split("\n").map(line=>JSON.parse(line));
  const bodies=rows.map(row=>{
    const body=md.subarray(row.offset,row.offset+row.bytes);
    assert.ok(row.bytes>0);assert.equal(sha(body),row.sha256);return body.toString();
  });
  assert.equal(manifest.version,"reader-chat-v1");assert.equal(manifest.source_id,sourceId);
  assert.equal(run.binding.sha256,sha(run.bytes));assert.equal(run.binding.size,run.bytes.length);
  assert.deepEqual(rows.map(r=>[r.id,r.parent,r.source_path]),[["u",null,["root","n0"]],["a","u",["n1"]]]);
  assert.deepEqual(rows.map(r=>r.assets),[[],[]]);assert.deepEqual(manifest.assets,[]);
  assert.equal(run.jobs[0].phase,"received");assert.equal(run.jobs[0].iid,iid);
  assert.equal(run.jobs[0].packageReady,false);assert.equal(run.opfs.dirs.has(key),false);
  assert.deepEqual(run.sourceRequests,["/api/auth/session","/backend-api/conversation/"+sourceId]);
  assert.deepEqual(run.requests.map(r=>[r.route,r.method]),[
    ["requests/"+key,"GET"],["transfers/"+key,"POST"],["transfers/"+key+"/chunks","POST"],["transfers/"+key+"/finish","POST"]
  ]);
  return {manifest,rows,bodies};
}

module.exports={capture,unpack,sha,iid};
