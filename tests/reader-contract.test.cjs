const test = require("node:test"), assert = require("node:assert/strict"), {createHash}=require("node:crypto");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process");
const Fast=require("../extension/fast-text.js");
require("../reader/visible.js");
globalThis.fflate=require("../reader/vendor/fflate-0.8.3.js");require("../reader/package.js");
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
  assert.equal(build("https://reader.example.test").status,0);const m=JSON.parse(fs.readFileSync(path.join(out,"manifest.json")));
  assert.deepEqual(m.host_permissions,["https://reader.example.test/*","https://chatgpt.com/*"]);assert.equal(m.incognito,"not_allowed");
  assert.ok(!m.permissions.some(x=>["cookies","tabs","debugger","webRequest","scripting","<all_urls>"].includes(x))&&!m.externally_connectable);
  assert.notEqual(build("https://reader.example.test").status,0);
});
