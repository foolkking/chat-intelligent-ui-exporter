const test=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto");
globalThis.FastTextExporter=require("../extension/fast-text.js");
require("../reader/source-file.js");require("../reader/progress.js");require("../reader/sha256.js");
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
function source(rows){
  const mapping={};
  for(let i=0;i<rows;i++)mapping["n"+i]={parent:i?"n"+(i-1):null,children:i+1<rows?["n"+(i+1)]:[],
    message:{id:"m"+i,author:{role:i%2?"assistant":"user"},content:{content_type:"text",parts:["Message "+i]}}};
  return {conversation_id:"example",title:"Tide",mapping,current_node:"n"+(rows-1)};
}
async function parse(data,leaf){
  const f=new Blob([JSON.stringify(data)]),h=await ReaderSourceFile.header(f,()=>{});
  return ReaderSourceFile.tree(f,h,leaf,()=>{},()=>{});
}
test("streamed source: more than 8 MiB, long message, Unicode byte ranges, no full JSON decode",async()=>{
  const data=source(3),body="潮汐 🪐 \\\" } ],\n".repeat(220000);
  data.mapping.n1.message.content.parts=[body];
  const result=await parse(data,"m0"),rows=[];
  for await(const r of result.rows())rows.push(r);
  assert.equal(result.branch,"n2");assert.equal(rows.length,3);
  assert.equal(rows[1].md,body);assert.equal(rows[2].id,"m2");
  assert.deepEqual(rows[0].sourcePath,["n0"]);
  assert.equal((await result.row("m1")).md,body);
  assert.equal(await result.row("unknown"),null);
});
test("streamed source: 50,001 messages keep the last row, no 50k rejection",async()=>{
  const result=await parse(source(50001));let n=0,last;
  for await(const m of result.rows()){n++;last=m;}
  assert.equal(n,50001);assert.equal(last.id,"m50000");assert.equal(result.ids.size,50001);
});
test("streamed JSON scans escaped delimiters across bytes and rejects truncation and wrong outer shape",async()=>{
  const file=new Blob(['{"x":',JSON.stringify({text:' ] },\\" 🪐'}),',"list":[1,2]}']);
  const entries=[];for await(const e of ReaderSourceFile.entries(file,0,file.size,true))entries.push(e);
  assert.deepEqual(entries.map(e=>e.key),["x","list"]);
  assert.deepEqual(await ReaderSourceFile.fileReader(file)(entries[0].start,entries[0].end),{text:' ] },\\" 🪐'});
  for(const text of ['{"x":[2,3}', '{"x":1,}', '[1,2]', '{"x":1} ignored']){
    await assert.rejects(async()=>{for await(const _ of ReaderSourceFile.entries(new Blob([text]),0,text.length,true))void _;});
  }
});
test("hidden ancestry, duplicate ids and broken/looping branches do not turn into successful partial captures",async()=>{
  const d=source(132);for(let i=1;i<131;i++)d.mapping["n"+i].message.author.role="system";
  const r=await parse(d),rows=[];for await(const x of r.rows())rows.push(x);
  assert.equal(rows.length,2);assert.equal(rows[1].sourcePath.length,131);
  d.mapping.n0.parent="n131";await assert.rejects(()=>parse(d));
  await assert.rejects(()=>parse(source(3),"unknown-visible-branch"));
  const disconnected=source(3);
  disconnected.mapping.n0.children=["n2"];disconnected.mapping.n2.parent=null;
  await assert.rejects(()=>parse(disconnected,"n0"));
});
test("incremental SHA matches independent crypto across padding, large and tiny chunks",()=>{
  for(const n of [0,1,55,56,63,64,65,65536,1048577]){
    const input=crypto.randomBytes(n),h=new ReaderSHA256();
    for(let i=0;i<n;i+=37)h.update(input.subarray(i,i+37));
    assert.equal(h.hex(),hash(input));
  }
});
test("progress never invents totals or returns source text, filenames, ids or credentials",()=>{
  assert.deepEqual(ReaderProgress.snapshot({stage:"asset",done:100,total:90,files:2,token:"secret",title:"private"}),{stage:"asset",done:100,files:2});
  assert.equal(ReaderProgress.snapshot({stage:"command"}),null);
  assert.match(ReaderProgress.describe({stage:"source",done:1024,pages:2},true),/读取对话.*第 2 页.*1.0 KiB/);
  assert.match(ReaderProgress.describe({stage:"messages",done:12,total:80},false),/12 \/ 80/);
});
