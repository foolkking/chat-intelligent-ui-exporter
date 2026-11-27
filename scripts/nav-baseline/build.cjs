// Build local observational copies of the reviewed Reader ZIP, including a
// control with every navigation module byte-identical to the installed package.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const {Script} = require("node:vm");
const {zipSync,unzipSync} = require("../../reader/vendor/fflate-0.8.3.js");
const baseCommit = "6725193cfe6f34e8f15f40f3be0e6c5f775e0d4e";
const baseZip = "3638a1d71d4c18d979581592d704e534af66551f93d353696389fa7ead1a9e79";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const text = bytes => Buffer.from(bytes).toString("utf8");
const loopback = "http://127.0.0.1:18383";
function replaceOnce(source, anchor, replacement) {
  const at = source.indexOf(anchor);
  if (at < 0 || at !== source.lastIndexOf(anchor)) throw Error("Missing or ambiguous measurement point: " + anchor);
  return source.slice(0,at) + replacement + source.slice(at+anchor.length);
}
function instrument(files) {
  function edit(file, anchor, replacement) {
    files[file] = Buffer.from(replaceOnce(text(files[file]),anchor,replacement));
  }
  function after(file, anchor, probe) {edit(file,anchor,anchor+"\n"+probe);}
  after("capture.js","sourceBytes+=bytes.byteLength;",'ReaderNavMeter.add("responseBytes",bytes.byteLength);');
  after("capture.js","sourcePages++;",'ReaderNavMeter.add("completedSourcePages");');
  after("source-file.js","await stream.read();if(done)break;",'ReaderNavMeter.add("scannerBytes",value.byteLength);');
  after("source-file.js","function decode(bytes){",'ReaderNavMeter.add("decodedJsonBytes",bytes.byteLength);');
  after("fast-text.js","function records(messages, {allowEmpty=false}={}) {",'ReaderNavMeter.add("converterInputs",messages.length);');
  after("visible.js","globalThis.ReaderVisible = (row, parser) => {",'ReaderNavMeter.add("visibleBodyCalls");');
  after("page-index.js","function headings(body){",'ReaderNavMeter.add("markdownHeadingParses");');
  after("outline-tree.js","const add=(key,kind,target,label,parent,row)=>{",'if(kind==="section")ReaderNavMeter.add("sectionNodes");');
  after("source-dom.js","function messageNodes() {",'ReaderNavMeter.add("messageDomScans");');
  after("page-index.js","function sample(messages=mounted()){",'ReaderNavMeter.add("revisionSamples");ReaderNavMeter.add("revisionSampleElements",messages.length);');
  after("page-index.js","function textMap(root){",'ReaderNavMeter.add("domTextWalks");');

  // Include the synchronous DOM-only first render and the source read in the
  // same clock, finishing even if that first render throws before the old try.
  after("overlay.js","if(busy()){pauseForCapture();return;}","const measuredRead=ReaderNavMeter.readStart();try{");
  after("overlay.js","partial=true;group();render();","ReaderNavMeter.renderRead(measuredRead,turns.length,false);");
  after("overlay.js","partial=!data.complete;loadedVersion=ReaderPageIndex.sample();group();render();",
    "if(data.complete)ReaderNavMeter.renderRead(measuredRead,turns.length,true);");
  edit("overlay.js","  }\n  async function open(want,remember=true){",
    "    }finally{ReaderNavMeter.readEnd(measuredRead);}\n  }\n  async function open(want,remember=true){");
  after("overlay.js","async function locate(target,owner){",
    'const measuredJump=ReaderNavMeter.jumpStart(target.query?"search":target.heading!==undefined?"chapter":target.file!==undefined?"file":"message");try{');
  after("overlay.js","},body);if(ctl.signal.aborted)return;",
    'if(measuredJump&&result.ok)measuredJump.outcome=result.kind==="message-fallback"?"fallback":"verified";');
  after("overlay.js",'finally{owner?.removeAttribute("aria-busy");',
    'if(measuredJump&&ctl.signal.aborted)measuredJump.outcome="cancelled";');
  edit("overlay.js","  }\n  function activeRow(confirmed){",
    "    }finally{ReaderNavMeter.jumpEnd(measuredJump);}\n  }\n  function activeRow(confirmed){");
}
function build(zipBytes, counted) {
  if (sha(zipBytes) !== baseZip) throw Error("This kit requires the exact reviewed 0.3.0 ZIP.");
  const files = unzipSync(zipBytes), manifest = JSON.parse(text(files["manifest.json"]));
  const prior = new URL(manifest.host_permissions[0]).origin;
  manifest.host_permissions[0] = loopback+"/*";
  manifest.content_security_policy.extension_pages = replaceOnce(manifest.content_security_policy.extension_pages,prior,loopback);
  files["config.js"] = Buffer.from(`globalThis.READER_ORIGIN="${loopback}";\n`);
  delete manifest.key; // A test copy gets its own storage, even if loaded next to the private release.
  manifest.name = counted ? "Chat Reader · 导航计数" : "Chat Reader · 导航对照";
  manifest.content_scripts[0].js.unshift("nav-meter.js");
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest,null,2));
  if (counted) instrument(files);
  const meter = fs.readFileSync(path.join(__dirname,"meter.js"),"utf8").replace(/\r\n/g,"\n");
  files["nav-meter.js"] = Buffer.from(replaceOnce(meter,"__READER_NAV_MEASUREMENT_BUILD__",
    JSON.stringify({baseCommit,baseZip,counted})));
  for (const n of manifest.content_scripts[0].js) new Script(text(files[n]),{filename:n});
  const zip = Buffer.from(zipSync(files,{level:6,mtime:new Date(2000,0,1)}));
  const read = unzipSync(zip);
  if(Object.keys(files).length!==Object.keys(read).length ||
     Object.keys(files).some(n=>!Buffer.from(files[n]).equals(read[n]))) throw Error("ZIP readback differs");
  return {files,zip,sha256:sha(zip)};
}
if (require.main === module) {
  const [source,out] = process.argv.slice(2);
  if (process.argv.length!==4) throw Error("Usage: node build.cjs REVIEWED_ZIP NEW_OUTPUT_DIRECTORY");
  const input = fs.readFileSync(source);
  const builds = ["control","counted"].map(name=>[name,build(input,name==="counted")]);
  fs.mkdirSync(out);
  const receipt = {baseCommit,baseZip,builds:{}};
  for (const [name,b] of builds) {
    const dir = path.join(out,name);
    fs.mkdirSync(dir);
    for (const [member,bytes] of Object.entries(b.files)) {
      const dest = path.join(dir,member);
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.writeFileSync(dest,bytes,{flag:"wx"});
    }
    fs.writeFileSync(path.join(out,name+".zip"),b.zip,{flag:"wx"});
    receipt.builds[name] = {sha256:b.sha256, bytes:b.zip.length, files:Object.keys(b.files).length};
  }
  fs.writeFileSync(path.join(out,"checksums.json"),JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify(receipt));
}
module.exports = {build,instrument,replaceOnce};
