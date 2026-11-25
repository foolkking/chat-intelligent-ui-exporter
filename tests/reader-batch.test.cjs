const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
globalThis.fflate=require("../reader/vendor/fflate-0.8.3.js");
globalThis.FastTextExporter=require("../extension/fast-text.js");
for(const f of ["sha256","source-file","package","visible","zip-source","archive-source","batch-model"])require("../reader/"+f+".js");
function folder(){
  const files=new Map();return {files,async getFileHandle(name){return {
    async getFile(){return files.get(name);},async createWritable(){const parts=[];return {
      async write(b){parts.push(b);},async close(){files.set(name,new Blob(parts));},async abort(){files.delete(name);}
    };}
  };}};
}
function chat(id="source-1",body="Synthetic tide",extra={}){
  return {id,title:"Tides "+id,current_node:"n2",mapping:{
    n1:{parent:null,children:["n2"],message:{id:"m1",author:{role:"user"},content:{content_type:"text",parts:["Question"]}}},
    n2:{parent:"n1",children:[],message:{id:"m2",author:{role:"assistant"},content:{content_type:"text",parts:[body]},...extra}}
  }};
}
const zip=files=>new Blob([fflate.zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,typeof v==="string"?new TextEncoder().encode(v):v])))]);
test("ZIP local source indexes unknown membership separately, builds only selected chat and keeps exact lineage",async()=>{
  const a=chat("one"),b=chat("two");a.project_id=null;b.project_id="project-b";
  const source=await ReaderLocalArchive.open(zip({"conversations.json":JSON.stringify([a,b,chat("three")])}),folder());
  assert.deepEqual(source.rows.map(r=>r.group),["unclassified","project:project-b","unknown"]);
  const result=await source.build("two",folder());
  const files=fflate.unzipSync(new Uint8Array(await result.file.arrayBuffer())),manifest=JSON.parse(Buffer.from(files["manifest.json"]));
  assert.equal(manifest.source_id,"two");assert.equal(result.partial,false);
  const lines=Buffer.from(files["reader/source.jsonl"]).toString().trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map(r=>r.id),["m1","m2"]);assert.deepEqual(lines[1].source_path,["n2"]);assert.equal(lines[1].parent,"m1");
  assert.equal(result.sha256,require("node:crypto").createHash("sha256").update(new Uint8Array(await result.file.arrayBuffer())).digest("hex"));
});
test("official ZIP selected attachment bytes are verified; missing files are explicit partials, never fetched",async()=>{
  const c=chat("with-file","Data");
  c.mapping.n1.message.metadata={attachments:[{id:"file-123",name:"table.csv",mime_type:"text/csv"}]};
  const bytes=Buffer.from("a,b\n1,2\n");
  const source=await ReaderLocalArchive.open(zip({"conversations.json":JSON.stringify([c]),"file-123-table.csv":bytes,"unrelated.txt":"private-unselected"}),folder());
  const result=await source.build(c.id,folder());assert.equal(result.partial,false);
  const files=fflate.unzipSync(new Uint8Array(await result.file.arrayBuffer())),manifest=JSON.parse(Buffer.from(files["manifest.json"]));
  assert.equal(manifest.assets.length,1);assert.deepEqual(Buffer.from(files[manifest.assets[0].path]),bytes);
  assert.ok(!Object.keys(files).some(k=>k.includes("unrelated")));
  const missing=await ReaderLocalArchive.open(zip({"conversations.json":JSON.stringify([c])}),folder());
  const partial=await missing.build(c.id,folder());assert.equal(partial.partial,true);assert.equal(partial.losses.files,1);
  const text=await missing.build(c.id,folder(),{attachments:false});assert.equal(text.partial,false);
});
test("local archive accepts a message over old 2 MiB and source over 8 MiB without an arbitrary conversation limit",async()=>{
  const body="潮汐星图".repeat(750000),data=chat("large",body);
  const source=await ReaderLocalArchive.open(new Blob([JSON.stringify([data])]),folder());
  assert.equal(source.rows.length,1);
  const result=await source.build("large",folder()),files=fflate.unzipSync(new Uint8Array(await result.file.arrayBuffer()));
  const lines=Buffer.from(files["reader/source.jsonl"]).toString().trim().split("\n").map(JSON.parse),md=Buffer.from(files["conversation.md"]);
  assert.equal(md.subarray(lines[1].offset,lines[1].offset+lines[1].bytes).toString(),body);
});
test("ZIP rejects traversal, symlinks, duplicated names and corrupt contents before claiming success",async()=>{
  await assert.rejects(()=>ReaderZipSource.open(zip({"../outside":"bad"})),/archive-format/);
  const raw=new Uint8Array(await zip({"one":"payload"}).arrayBuffer()),v=new DataView(raw.buffer);
  let central=raw.findIndex((_,i)=>i+4<=raw.length&&v.getUint32(i,true)===0x02014b50);
  const symlink=raw.slice(),sv=new DataView(symlink.buffer);sv.setUint32(central+38,0xa1ff0000,true);
  await assert.rejects(()=>ReaderZipSource.open(new Blob([symlink])),/archive-format/);
  const corrupt=raw.slice(),cv=new DataView(corrupt.buffer);cv.setUint32(central+16,0,true);
  const source=await ReaderZipSource.open(new Blob([corrupt])),dir=folder();
  await assert.rejects(async()=>source.extract(source.members.get("one"),await dir.getFileHandle("out")),/archive-format/);
  assert.equal(dir.files.has("out"),false);
});
test("catalogue rejects duplicate source identities and aborted reads retain no claimed result",async()=>{
  await assert.rejects(()=>ReaderLocalArchive.open(new Blob([JSON.stringify([chat(),chat()])]),folder()),/source-format/);
  let n=0;await assert.rejects(()=>ReaderLocalArchive.open(new Blob([JSON.stringify([chat()])]),folder(),()=>{if(++n>2)throw Error("cancelled");}),/cancelled/);
});
test("fixed batch plan is account-scoped, holds cross-project ids and never changes existing destination",()=>{
  const device={id:"device",user:"owner",origin:"https://reader.test"},source={kind:"archive",scope:"digest"};
  const plan=ReaderBatch.create({device,origin:device.origin,source,rows:[{id:"a",title:"Same name",group:"unknown"},{id:"b",title:"Same name",group:"project:p"}],
    targets:{unknown:null,"project:p":"00000000-0000-4000-8000-000000000001"},attachments:true});
  assert.notEqual(plan.items[0].key,plan.items[1].key);assert.equal(plan.items[1].project,"00000000-0000-4000-8000-000000000001");
  assert.ok(ReaderBatch.owned(plan,device,device.origin));
  assert.ok(!ReaderBatch.owned(plan,{...device,user:"other"},device.origin));
  assert.ok(!ReaderBatch.owned(plan,device,"https://other.test"));
  const jobs=[{key:plan.items[0].key,device:"device",phase:"done",active:false}];
  assert.deepEqual(ReaderBatch.candidates(plan,jobs).map(r=>r.id),["b"]);
  assert.deepEqual(ReaderBatch.candidates(plan,jobs,true),[]); // retry failures must not silently start unsubmitted rows
  jobs.push({key:plan.items[1].key,device:"device",phase:"upload-paused",active:false,packageReady:true});
  assert.deepEqual(ReaderBatch.candidates(plan,jobs,true).map(r=>r.id),["b"]);
  assert.throws(()=>ReaderBatch.create({device,origin:device.origin,source,rows:[{id:"a",group:"unknown"},{id:"a",group:"unknown"}],targets:{unknown:null}}));
  assert.ok(!JSON.stringify(plan).includes("mapping\""));
});
test("source workspace never guesses a default workspace or exposes its session credentials",async()=>{
  const {JSDOM}=require("jsdom"),dom=new JSDOM('<nav><a href="/c/one">One</a><a href="/g/g-p-two/c/two">Two</a></nav>',{url:"https://chatgpt.com/"});
  const listeners=[],sent=[],session={accessToken:"not-a-real-token",user:{id:"user-one"},account:{id:"workspace-one"}};
  const env=vm.createContext({document:dom.window.document,location:dom.window.location,URL,TextEncoder,crypto:require("node:crypto").webcrypto,
    fetch:async()=>Response.json(session),chrome:{runtime:{id:"test",onMessage:{addListener:f=>listeners.push(f)},sendMessage:m=>{sent.push(m);return Promise.resolve();}}}});
  vm.runInContext(fs.readFileSync("reader/routes.js","utf8"),env);vm.runInContext(fs.readFileSync("reader/workspace.js","utf8"),env);
  vm.runInContext("ReaderWorkspace({capture:()=>Promise.resolve(),busy:()=>false})",env);
  const discover=()=>new Promise(resolve=>listeners[0]({kind:"reader-batch-discover"},{id:"test"},resolve));
  const r=await discover();assert.equal(r.rows.length,2);assert.equal(r.complete,false);assert.match(r.scope,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(r).includes("not-a-real-token"));assert.ok(!JSON.stringify(r).includes("user-one"));assert.equal(sent.length,0);
  delete session.account;const partial=await discover();assert.equal(partial.scope,null);assert.equal(partial.rows.length,2);
  dom.window.close();
});
