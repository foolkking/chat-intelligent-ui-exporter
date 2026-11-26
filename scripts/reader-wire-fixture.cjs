// Feed the installed candidate's actual JS to a synthetic source, then hand the resulting ZIPs to an isolated Reader.
// No browser, personal data, real network or credentials. Both inputs must be locally built by package-reader.cjs.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const {capture,unpack,sha}=require("../tests/support/reader-wire.cjs"),{unzipSync}=require("../reader/vendor/fflate-0.8.3.js");
const [pkgArg,outArg]=process.argv.slice(2);assert.equal(process.argv.length,4);
const temp=fs.realpathSync(process.env.TEMP),pkg=fs.realpathSync(pkgArg),out=path.resolve(outArg);
const inside=p=>{const rel=path.relative(temp,p);return !!rel&&!rel.startsWith("..")&&!path.isAbsolute(rel);};
assert.ok(inside(pkg)&&inside(out)&&inside(fs.realpathSync(path.dirname(out)))&&!fs.existsSync(out),"Use a new subdirectory of the task TEMP");
const manifest=JSON.parse(fs.readFileSync(path.join(pkg,"manifest.json")));
assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
const install=fs.readFileSync(path.join(path.dirname(pkg),`chat-reader-${manifest.version}.zip`)),members=unzipSync(install);
for(const [name,bytes] of Object.entries(members)){
  assert.ok(name.split("/").every(p=>/^[a-z0-9][a-z0-9_.-]*$/i.test(p)));assert.deepEqual(fs.readFileSync(path.join(pkg,name)),Buffer.from(bytes));
}
function verifyModules(modules){
  for(const [file,digest] of Object.entries(modules))assert.equal(sha(members[file.replace(/^(reader|extension)\//,"")]),digest);
}
function write(name,data){fs.writeFileSync(path.join(out,name),data,{flag:"wx"});}
(async()=>{
  const run=await capture({packageDir:pkg}),{manifest,rows,bodies}=unpack(run);
  assert.equal(manifest.partial,true);assert.equal(bodies[0],run.expectedFallback);assert.equal(rows.length,2);verifyModules(run.modules);
  const digest=crypto.createHash("sha256").update(manifest.lineage+"\n"),roots=new Map(manifest.assets.map(a=>[a.path,a.root]));
  for(const r of rows)digest.update(JSON.stringify([r.id,r.parent,r.source_path,r.role,r.at,r.sha256,r.assets.map(a=>[a,roots.get(a)])])+"\n");
  const large=await capture({packageDir:pkg,image:false,text:"Synthetic first question",excerptCount:251,hostExtended:true});
  verifyModules(large.modules);const archive=unzipSync(large.bytes);
  const index=Buffer.from(archive["reader/source.jsonl"]).toString().trim().split("\n").map(line=>JSON.parse(line));
  assert.deepEqual(index.map(row=>row.id),["u","a",...Array.from({length:249},(_,i)=>"m"+(i+2))]);
  assert.equal(large.jobs[0].phase,"append-ready");assert.equal(large.binding.sha256,sha(large.bytes));
  assert.ok(!large.requests.some(r=>r.route.endsWith("/commit")));assert.equal(index.length,251);
  const proof={generatedAt:new Date().toISOString(),syntheticOnly:true,installerSHA256:sha(install),modules:run.modules,
    inputs:Object.entries(run.modules).map(([file,sha256])=>({path:file,sha256})),
    provenance:"Reviewed JS read from the installable package; synthetic DOM/source/OPFS and transport here. The separate backend gate consumes the exact output bytes via real HTTP."};
  fs.mkdirSync(out);const fixture="installed-image-partial.zip";write(fixture,run.bytes);
  write("installed-image-partial.expected.json",JSON.stringify({...proof,fixture,partial:true,messageCount:rows.length,
    zipBytes:run.bytes.length,zipSHA256:sha(run.bytes),sourceDigest:digest.digest("hex"),losses:run.finish.losses,
    bodyHashes:rows.map((r,i)=>({role:r.role,bytes:r.bytes,sha256:r.sha256,expectedSyntheticBody:bodies[i]}))},null,2)+"\n");
  write("installed-append-251.zip",large.bytes);write("installed-append-251.expected.json",JSON.stringify({...proof,
    fixture:"installed-append-251.zip",count:index.length,zipSHA256:sha(large.bytes),bodyHashes:index.map(r=>({role:r.role,sha256:r.sha256})),
    confirmedInThisStep:false},null,2)+"\n");
  console.log(JSON.stringify({installer:proof.installerSHA256,executedModules:Object.keys(run.modules).length,
    partial:sha(run.bytes),append251:sha(large.bytes)}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
