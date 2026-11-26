// End-to-end synthetic boundaries; actual product modules and original assertions.
const test=require("node:test"),assert=require("node:assert/strict"),fflate=require("../reader/vendor/fflate-0.8.3.js");
const {capture,unpack,sha,iid}=require("./support/reader-wire.cjs");
test("extended append must pass the actual host, archive and uploader with all 251 messages and a staged receipt",async()=>{
  const run=await capture({image:false,text:"First question",excerptCount:251,hostExtended:true});
  const zip=fflate.unzipSync(run.bytes);
  const rows=Buffer.from(zip["reader/source.jsonl"]).toString().trim().split("\n").map(line=>JSON.parse(line));
  assert.deepEqual(rows.map(row=>row.id),["u","a",...Array.from({length:249},(_,i)=>"m"+(i+2))]);
  assert.equal(run.binding.excerpt,true);assert.equal(run.binding.sha256,sha(run.bytes));
  assert.equal(run.jobs[0].phase,"append-ready");assert.equal(run.jobs[0].iid,iid);
  assert.ok(!run.requests.some(r=>r.route.endsWith("/commit")));
});
test("a source claiming extended selection cannot exceed a legacy host ticket",async()=>{
  await assert.rejects(capture({image:false,text:"First question",excerptCount:251}),/250|connection closed|cancelled/i);
});
test("image-only missing media survives actual capture -> host -> package -> upload as explicitly partial",async()=>{
  const run=await capture(),{manifest,bodies}=unpack(run);
  assert.equal(bodies[0],run.expectedFallback);assert.equal(bodies[1],"Synthetic answer 🪐 must survive.");
  assert.equal(run.finish.partial,true);assert.equal(manifest.partial,true);assert.equal(run.jobs[0].partial,true);
  assert.equal(run.finish.losses.files,1);assert.equal(run.finish.losses.interactions,1);
});
test("whitespace beside unsupported image cannot silently remove the source message from the completed ZIP",async()=>{
  const run=await capture({text:" \n\t"}),{manifest,bodies}=unpack(run);
  assert.equal(bodies[0],run.expectedFallback);assert.equal(manifest.partial,true);
  assert.equal(run.finish.losses.files,1);assert.equal(run.finish.losses.interactions,1);
});
test("normal text control keeps complete status through the same real host and wire path",async()=>{
  const run=await capture({image:false,text:"Keep exact text 潮汐 🪐."}),{manifest,bodies}=unpack(run);
  assert.equal(bodies[0],"Keep exact text 潮汐 🪐.");assert.equal(manifest.partial,false);
  assert.equal(run.finish.partial,false);assert.deepEqual(run.finish.losses,{files:0,interactions:0,links:0});
});
test("explicit DOM mapping-node aliases keep canonical message IDs through the complete wire path",async()=>{
  const run=await capture({image:false,text:"Node identity is not message identity.",nodeIDs:true}),{bodies}=unpack(run);
  assert.equal(bodies[0],"Node identity is not message identity.");assert.equal(run.finish.partial,false);
});
