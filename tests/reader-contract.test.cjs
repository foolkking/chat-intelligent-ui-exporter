const test = require("node:test"), assert = require("node:assert/strict"), {createHash}=require("node:crypto");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process");
const Fast=require("../extension/fast-text.js");
require("../reader/visible.js");
require("../reader/append-picker.js");
globalThis.fflate=require("../reader/vendor/fflate-0.8.3.js");require("../reader/sha256.js");require("../reader/package.js");
const sha=x=>createHash("sha256").update(x).digest("hex");
function directory(){
  const entries=new Map();
  return {async getFileHandle(key){
    return {async getFile(){return entries.get(key);},async createWritable(){
      const chunks=[];return {async write(x){chunks.push(x);},async close(){entries.set(key,new Blob(chunks));},async abort(){}};
    }};
  }};
}
function fixture(){
  const input={title:"Tide notebook",current_node:"node-3",mapping:{}};
  ["user","system","assistant","assistant"].forEach((role,i)=>{
    input.mapping["node-"+i]={parent:i?"node-"+(i-1):null,children:i<3?["node-"+(i+1)]:[],
      message:{id:"message-"+i,author:{role},content:{content_type:"text",parts:[["紫色潮汐","Hidden plumbing","```md\n## User\n```","A final answer"][i]]}}};
  });return input;
}
test("the existing selected-tree parser gives the Reader three visible IDs and their actual node chains",()=>{
  const d=fixture();const r=Fast.parseTree(d,undefined,{sourcePaths:true});
  assert.deepEqual(r.messages.map(x=>[x.id,x.sourcePath]),[["message-0",["node-0"]],["message-2",["node-1","node-2"]],["message-3",["node-3"]]]);
  assert.equal(Fast.parseTree(d).messages[0].sourcePath,undefined); // upstream exporter remains unchanged
  assert.throws(()=>Fast.parseTree(d,undefined,{sourcePaths:true,maxMessages:2}));
});
test("a model-authored program is never exported instead of the static card, including code-type messages",()=>{
  const card={id:"card",author:{role:"assistant"},content:{content_type:"code",text:"private-compiled-program"},
    metadata:{model_dil_v2:{fallbackMarkdown:"| Tide | Depth |\n| --- | --- |\n| A | 2 |",compiled:"private-interactive-program"}}};
  assert.equal(ReaderVisible(Fast.records([card]).messages[0],Fast).body,card.metadata.model_dil_v2.fallbackMarkdown);
  delete card.metadata.model_dil_v2.fallbackMarkdown;
  assert.deepEqual(ReaderVisible(Fast.records([card]).messages[0],Fast),{body:"[Interactive content unavailable]",missing:true});
});
test("Reader ZIP preserves UTF-8 message boundaries, hidden ancestry and multi-chunk attachment bytes",async()=>{
  const parsed=Fast.parseTree(fixture(),undefined,{sourcePaths:true}),dir=directory(),path="assets/example.csv",h=await dir.getFileHandle("f");
  const bytes=Buffer.alloc(262144+11,47),w=await h.createWritable();await w.write(bytes);await w.close();
  const records=parsed.messages.map((m,i)=>({id:m.id,role:m.role,sourcePath:m.sourcePath,
    body:m.md+(i===1?`\n[file](${path})`:""),assets:i===1?[path]:[]}));
  const result=await ReaderArchive.build(dir,{id:"synthetic",lineage:"tree",title:"Tide notebook",images:[]},()=>records,new Map([[path,h]]));
  const zip=fflate.unzipSync(new Uint8Array(await result.arrayBuffer())),md=Buffer.from(zip["conversation.md"]);
  const index=Buffer.from(zip["reader/source.jsonl"]).toString().trim().split("\n").map(x=>JSON.parse(x));
  assert.equal(index.length,3);index.forEach((r,i)=>{const part=md.subarray(r.offset,r.offset+r.bytes);
    assert.equal(r.sha256,sha(part));assert.equal(part.toString(),records[i].body);assert.equal(r.parent,i?records[i-1].id:null);});
  let hash=Buffer.alloc(32);for(let i=0;i<bytes.length;i+=262144)hash=Buffer.from(sha(Buffer.concat([hash,bytes.subarray(i,i+262144)])),"hex");
  assert.deepEqual(Buffer.from(zip[path]),bytes);
  assert.equal(JSON.parse(Buffer.from(zip["manifest.json"])).assets[0].root,hash.toString("hex"));
});
test("private package is origin-bound, has no generic tab/cookie permissions, and cannot overwrite a build",()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),"reader-contract-")), out=path.join(folder,"ext");
  const build=(url)=>cp.spawnSync(process.execPath,[path.resolve(__dirname,"../scripts/package-reader.cjs"),url,out],{encoding:"utf8"});
  assert.notEqual(build("http://remote.example.test").status,0);
  assert.notEqual(build("https://*.example.test").status,0);
  assert.equal(build("https://reader.example.test").status,0);const m=JSON.parse(fs.readFileSync(path.join(out,"manifest.json")));
  assert.deepEqual(m.host_permissions,["https://reader.example.test/*","https://chatgpt.com/*"]);assert.equal(m.incognito,"not_allowed");
  assert.ok(!m.permissions.some(x=>["cookies","tabs","debugger","webRequest","scripting","<all_urls>"].includes(x))&&!m.externally_connectable);
  const text=name=>fs.readFileSync(path.join(out,name),"utf8");
  assert.equal(m.side_panel,undefined);assert.ok(!m.permissions.includes("sidePanel"));
  const pages=["panel.html","host.html","frame.html","center.html"];
  const included=[m.background.service_worker,...m.content_scripts.flatMap(x=>x.js),...pages];
  for(const doc of pages)
    for(const ref of text(doc).matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g))included.push(ref[1]);
  for(const imp of text(m.background.service_worker).matchAll(/importScripts\(([^)]+)\)/g))
    for(const ref of imp[1].matchAll(/"([^"]+)"/g))included.push(ref[1]);
  for(const name of included){assert.match(name,/^[\w/.-]+$/);assert.ok(fs.statSync(path.join(out,name)).isFile(),name);}
  assert.ok(included.includes("transfer-state.js")&&included.includes("source-actions.js")&&included.includes("append-picker.js"));
  for(const name of ["center.js","center.css","workspace.js","batch-worker.js","batch-model.js","zip-source.js","archive-source.js"])
    assert.ok(included.includes(name),"Missing import center resource: "+name);
  const captureScripts=m.content_scripts[0].js;
  assert.ok(captureScripts.indexOf("routes.js")<captureScripts.indexOf("workspace.js")&&captureScripts.indexOf("workspace.js")<captureScripts.indexOf("capture.js"));
  assert.ok(!fs.existsSync(path.join(out,"local-picker.js"))&&!fs.existsSync(path.join(out,"local-source.js")));
  assert.notEqual(build("https://reader.example.test").status,0);
});
test("installable ZIP is reproducible and its root is the same allowlisted directory that was tested",()=>{
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"reader-zip-")),builds=[];
  for(const name of ["one","two"]){
    const dir=path.join(scratch,name);fs.mkdirSync(dir);
    const out=path.join(dir,"ext"),result=cp.spawnSync(process.execPath,[path.resolve(__dirname,"../scripts/package-reader.cjs"),"https://reader.example.test",out,"--zip"],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    const m=JSON.parse(fs.readFileSync(path.join(out,"manifest.json"))),leaf=`chat-reader-${m.version}.zip`,zip=fs.readFileSync(path.join(dir,leaf)),files=fflate.unzipSync(zip);
    assert.equal(fs.readFileSync(path.join(dir,leaf+".sha256"),"utf8"),`${sha(zip)}  ${leaf}\n`);
    assert.equal(JSON.parse(Buffer.from(files["manifest.json"])).name,"Chat Reader");
    for(const [n,b] of Object.entries(files)){assert.ok(!n.startsWith("/")&&!n.includes(".."));assert.ok(fs.readFileSync(path.join(out,n)).equals(b));}
    assert.ok(files["append-picker.js"]&&files["vendor/fflate-LICENSE.txt"]&&files["THIRD_PARTY_NOTICES.md"]);
    builds.push(zip);
  }
  assert.ok(builds[0].equals(builds[1]));
});
test("a sparse ZIP contains only selected rows in source order, and never claims a missing parent or source asset",async()=>{
  const source="```md\n## User\n```\nAdjacent answer ![Image](asset:fixture) [tide.csv](attachment:fixture)";
  assert.equal(ReaderExcerpt.snippet(source),"User Adjacent answer Image tide.csv");
  assert.equal(ReaderExcerpt.snippet("[file](https://synthetic.test/"+"a".repeat(1400)+")"),"file");
  const rows=["user","assistant","user","assistant","user","assistant"].map((role,i)=>({role,id:`id-${i}`,body:`body-${i}`,assets:[],sourcePath:[`hidden-node-${i}`]}));
  rows[2].body+=" [private](assets/omitted.bin)";rows[2].assets=["assets/omitted.bin"];
  const picks=new Set([5,3,1,0]);
  const items=ReaderExcerpt.selected(rows,picks,true);
  assert.deepEqual(items.map(({row,question})=>[row.id,question]),[["id-0",null],["id-1","id-0"],["id-3",null],["id-5",null]]);
  assert.ok(ReaderExcerpt.selected(rows,picks,false).every(x=>!x.question));
  assert.throws(()=>ReaderExcerpt.selected(rows,new Set([6]),true));
  assert.throws(()=>ReaderExcerpt.selected(rows,new Set(),true));
  assert.throws(()=>ReaderExcerpt.selected(Array(251).fill(rows[0]),new Set(Array.from({length:251},(_,i)=>i)),true));
  const file=await ReaderArchive.build(directory(),{id:"synthetic",lineage:"list",excerpt:true,title:"Subset",images:[]},
    ()=>items.map(({row,question})=>({...row,question})),new Map());
  const bits=fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
  assert.deepEqual(Object.keys(bits).sort(),["conversation.md","manifest.json","reader/source.jsonl"]);
  const text=Buffer.from(bits["conversation.md"]),index=Buffer.from(bits["reader/source.jsonl"]).toString().trim().split("\n").map(s=>JSON.parse(s));
  assert.deepEqual(index.map(r=>r.id),["id-0","id-1","id-3","id-5"]);
  assert.ok(index.every(r=>!r.parent&&!r.source_path.length&&!r.assets.length));
  assert.deepEqual(index.filter(r=>"question" in r).map(r=>r.question),["id-0"]);
  for(const row of index)assert.equal(sha(text.subarray(row.offset,row.offset+row.bytes)),row.sha256);
  for(const content of Object.values(bits))assert.doesNotMatch(Buffer.from(content).toString(),/omitted\.bin|body-[24]|id-[24]|hidden-node-/);
});
test("settlement and completeness are independent; a historical or unknown receipt is never proof of this page",()=>{
  const vm=require("node:vm"),env=vm.createContext({chrome:{runtime:{onConnect:{addListener(){}}}}});
  for(const file of ["transfer-state.js","source-actions.js"])
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../reader",file),"utf8"),env);
  const id="00000000-0000-4000-8000-000000000001", settle=(r,cid=id)=>env.ReaderTransferState({status:"committed",conversation_id:cid,result:r});
  const show=(r,a="one")=>env.sourceDisplay({...settle(r),key:"one"},a);
  assert.equal(show({version:1,action:"created",completeness:"complete"}),"saved");
  assert.equal(show({version:1,action:"appended",completeness:"complete"},"another"),"previous");
  assert.equal(show({version:1,action:"separate_copy",completeness:"complete"}),"copy");
  assert.equal(show({version:1,action:"unchanged",completeness:"partial"},"another"),"partial");
  assert.equal(show({version:1,completeness:"unknown"}),"previous");assert.equal(show(null),"previous");
  assert.equal(settle(null,null).phase,"result-unavailable");assert.equal(env.ReaderTransferState({status:"canceled"}).active,false);
  assert.equal(env.ReaderTransferState({status:"unrecognized"}).phase,"check");
});
test("without a retained local receipt, source status looks up only the open ChatGPT conversation",async()=>{
  const vm=require("node:vm"),sourceId="conversation-123",savedId="00000000-0000-4000-8000-000000000007";
  async function run({boundId=savedId,capability=true,destination=true,current=true,
    consent="device-1",kind="source-state",revokeDuring=null}={}){
    const device={id:"device-1",origin:"https://reader.example.test"},requests=[];
    const local={device,sourceLookupDevice:consent,...(destination?{destination:{device:device.id,project:null}}:{}),jobs:[]};
    const env=vm.createContext({
      READER_ORIGIN:device.origin,TextEncoder,crypto:require("node:crypto").webcrypto,
      source:()=>true,currentSource:async()=>current,
      chrome:{
        runtime:{id:"extension-id",onConnect:{addListener(){}}},
        storage:{local:{get:async()=>local,onChanged:{addListener(){}}}},
        tabs:{onActivated:{addListener(){}}},
      },
      ReaderClient:{
        trust:Promise.resolve(),
        json:(method,body)=>({method,body:JSON.stringify(body)}),
        request:async(deviceId,path,options)=>{
          requests.push({deviceId,path,options});
          if(path===revokeDuring)delete local.sourceLookupDevice;
          const value=path==="capabilities"?{source_lookup:capability}:
            path==="sources/status"?{conversation_id:boundId}:{};
          return {json:async()=>value};
        },
      },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../reader/source-actions.js"),"utf8"),env);
    const invoke=async(k=kind,doc="document-1",id=sourceId,tab=4)=>JSON.parse(JSON.stringify(await env.ReaderSourceAction(
      {kind:k,path:`/c/${id}`},{tab:{id:tab},documentId:doc},`/c/${id}`,async()=>{})));
    return {result:await invoke(),requests,local,invoke};
  }

  const found=await run();
  assert.deepEqual(found.result,{state:"previous",name:"",canSave:true});
  assert.deepEqual(found.requests.map(r=>r.path),["capabilities","sources/status"]);
  assert.equal(found.requests[1].deviceId,"device-1");
  assert.deepEqual(JSON.parse(found.requests[1].options.body),{source_id:sourceId});
  assert.ok(!JSON.stringify(found.result).includes(savedId),"Reader identity must not be sent to the ChatGPT document");

  const absent=await run({boundId:null});
  assert.equal(absent.result.state,"save");
  const oldServer=await run({capability:false});
  assert.equal(oldServer.result.state,"save");
  assert.deepEqual(oldServer.requests.map(r=>r.path),["capabilities"]);
  const switched=await run({current:false});
  assert.deepEqual(switched.result,{error:"changed"});
  assert.deepEqual(switched.requests.map(r=>r.path),["capabilities"]);
  const noDestination=await run({destination:false});
  assert.deepEqual(noDestination.result,{state:"previous",name:"",canSave:false});
  for(const consent of [null,"another-device"]){
    const privateByDefault=await run({consent});
    assert.equal(privateByDefault.result.state,"save");assert.deepEqual(privateByDefault.requests,[]);
  }
  const optedOut=await run({revokeDuring:"capabilities"});
  assert.deepEqual(optedOut.requests.map(r=>r.path),["capabilities"]);assert.equal(optedOut.result.state,"save");
  assert.equal((await run({revokeDuring:"sources/status"})).result.state,"save");
  const manual=await run({consent:null,kind:"find-saved",destination:false});
  assert.deepEqual(manual.result,{state:"previous"});
  assert.deepEqual(manual.requests.map(r=>r.path),["capabilities","sources/status"]);
  assert.equal((await manual.invoke("source-state")).state,"previous"); // same visible document, no further source request
  assert.equal((await manual.invoke("source-state","document-1",sourceId,7)).state,"destination");
  assert.equal((await manual.invoke("source-state","document-2")).state,"destination");
  await manual.invoke("find-saved");
  assert.equal((await manual.invoke("source-state","document-1","different-chat")).state,"destination");
  await manual.invoke("find-saved");
  manual.local.device={...manual.local.device,id:"device-2"};
  assert.equal((await manual.invoke("source-state")).state,"destination");
  assert.ok(manual.requests.every(r=>r.deviceId==="device-1"));
  assert.deepEqual(manual.requests.map(r=>r.path),Array.from({length:3},()=>["capabilities","sources/status"]).flat());
});
test("changing the configured Reader origin forgets only the old device data, without any network request",async()=>{
  const vm=require("node:vm"),device={id:"fixture-device",origin:"https://previous.example.test"};
  const local={device,jobs:[{}],destination:{},exportJob:{},seenWarnings:["seen"],sourceLookupDevice:device.id,unrelated:"keep"};
  const session={access:{},pending:{}};let requests=0,restricted=0;
  const store=obj=>({setAccessLevel:async o=>{assert.equal(o.accessLevel,"TRUSTED_CONTEXTS");restricted++;},
    async get(k){return {[k]:obj[k]};},async remove(keys){for(const k of keys)delete obj[k];},
    async clear(){for(const k of Object.keys(obj))delete obj[k];}});
  const env=vm.createContext({READER_ORIGIN:"https://current.example.test",chrome:{storage:{local:store(local),session:store(session)}},
    TextEncoder,navigator:{locks:{request:async(k,fn)=>fn()}},fetch:()=>{requests++;throw Error("unexpected network");}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../reader/client.js"),"utf8"),env);
  await env.ReaderClient.trust;assert.equal(restricted,2);assert.deepEqual(local,{unrelated:"keep"});
  assert.deepEqual(session,{});assert.equal(requests,0);
});
