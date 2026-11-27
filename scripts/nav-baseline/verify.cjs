// Offline synthetic smoke check of the two generated packages, including the
// download boundary. Takes the independently verified ZIP as a local input.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const {JSDOM} = require("jsdom");
const {unzipSync} = require("../../reader/vendor/fflate-0.8.3.js");
const {build} = require("./build.cjs");
const zip = fs.readFileSync(process.argv[2]), base = unzipSync(zip);
const privateText = "private-synthetic-body-marker", privateId = "synthetic-id-must-not-leave";
async function check(counted) {
  const b = build(zip,counted), unpacked = unzipSync(b.zip);
  assert.equal(Object.keys(unpacked).length,60);
  const changed = Object.keys(base).filter(n=>!Buffer.from(unpacked[n]).equals(base[n])).sort();
  assert.deepEqual(changed,(counted ? ["capture.js","fast-text.js","outline-tree.js","overlay.js","page-index.js","source-dom.js","source-file.js","visible.js"] : []).concat(["config.js","manifest.json"]).sort());
  const manifest = JSON.parse(Buffer.from(unpacked["manifest.json"]));
  assert.equal(manifest.key,undefined); assert.deepEqual(manifest.host_permissions,["http://127.0.0.1:18383/*","https://chatgpt.com/*"]);
  const dom = new JSDOM("<!doctype html><body></body>",{url:"https://chatgpt.com/c/"+privateId,runScripts:"outside-only",pretendToBeVisual:true});
  const w = dom.window, origAttach = w.Element.prototype.attachShadow;
  let root, reportBlob;
  w.Element.prototype.attachShadow = function(opts){root=origAttach.call(this,opts);return root;};
  Object.assign(w,{Blob,TextEncoder,TextDecoder,URL});
  // Override only the jsdom globals, never the producer's shared URL class.
  w.URL = class extends URL {static createObjectURL(blob){reportBlob=blob;return "blob:synthetic";}static revokeObjectURL(){}};
  w.HTMLAnchorElement.prototype.click = ()=>{};
  try {
    for (const n of ["nav-meter.js","routes.js","locales/en.js","i18n.js","fast-text.js","source-dom.js","visible.js","source-file.js","page-index.js"])
      w.eval(Buffer.from(unpacked[n]).toString("utf8"));
    await new Promise(r=>setTimeout(r,10));
    const button=root.querySelector("button");
    button.click(); assert.match(button.textContent,/开始/,"synthetic untrusted click must be ignored");
    button.onclick({isTrusted:true}); assert.match(button.textContent,/下载/);
    const raw={id:privateId,author:{role:"user"},content:{content_type:"text",parts:["# "+privateText]}};
    const file=new Blob([JSON.stringify({id:"fixture",current_node:"n",mapping:{n:{parent:null,children:[],message:raw}}})]);
    const header=await w.ReaderSourceFile.header(file,()=>{});
    const branch=await w.ReaderSourceFile.tree(file,header,null,()=>{},()=>{});
    for await(const row of branch.rows()) {
      const entry=w.ReaderPageIndex.fromBranch({messages:[row]})[0];
      assert.equal(entry.headings[0].text,privateText);
    }
    w.ReaderPageIndex.sample();
    if(counted) {
      const load=w.ReaderNavMeter.readStart(); w.ReaderNavMeter.renderRead(load,3,false); w.ReaderNavMeter.renderRead(load,101,true); w.ReaderNavMeter.readEnd(load);
      const cancelled=w.ReaderNavMeter.jumpStart("message");cancelled.outcome="cancelled";w.ReaderNavMeter.jumpEnd(cancelled);
      w.ReaderNavMeter.jumpStart("chapter"); // In flight when the user stops, never marked successful.
    }
    button.onclick({isTrusted:true});
    const json=await reportBlob.text(), r=JSON.parse(json);
    for(const marker of [privateText,privateId,"chatgpt.com", "blob:synthetic","# "]) assert.ok(!json.includes(marker));
    assert.equal(r.counted,counted); assert.equal(r.pageChanged,false);
    assert.equal(r.longTasksMs,null); assert.equal(r.eventDelayMsOver16msDuration,null); assert.equal(r.tabHeapBytes,null);
    assert.equal(r.inputDispatchLagMs.maxMs,null);
    if(counted) {
      assert.equal(r.counts.converterInputs,1); assert.equal(r.counts.visibleBodyCalls,1); assert.equal(r.counts.markdownHeadingParses,1);
      assert.ok(r.counts.messageDomScans>0); assert.equal(r.counts.revisionSamples,1); assert.ok(r.counts.scannerBytes>=file.size);
      assert.ok(r.counts.decodedJsonBytes>0); assert.equal(r.counts.responseBytes,0);
      assert.equal(r.jumpAttempts,2); assert.equal(r.jumpOutcomes.cancelled,1); assert.equal(r.jumpOutcomes.verified,0);
      assert.equal(r.sourceOutline.turns,101);
    } else {assert.equal(r.counts,null); assert.equal(r.jumpAttempts,null); assert.equal(r.sourceOutline,null);}
    return {counted, files:Object.keys(unpacked).length, changedOriginalFiles:changed, sha256:b.sha256};
  } finally {dom.window.close();}
}
(async()=>{
  assert.throws(()=>build(Buffer.from("wrong input"),false),/exact reviewed/);
  const control=await check(false), counted=await check(true);
  console.log(JSON.stringify({kind:"offline synthetic package verification",control,counted}));
})().catch(e=>{console.error(e);process.exitCode=1;});
