const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{spawnSync}=require("node:child_process");
const {unzipSync,zipSync}=require("../reader/vendor/fflate-0.8.3.js");
const root=path.resolve(__dirname,".."),reference="https://reader.example.test",lab="http://127.0.0.1:18383";
const sha=b=>require("node:crypto").createHash("sha256").update(b).digest("hex");
function build(src,into,origin){
  fs.mkdirSync(into);
  const r=spawnSync(process.execPath,[path.join(src,"scripts/package-reader.cjs"),origin,path.join(into,"extension"),"--zip"],{encoding:"utf8"});
  assert.equal(r.status,0,r.stderr);
  const leaf=fs.readdirSync(into).find(n=>n.endsWith(".zip"));
  return {bytes:fs.readFileSync(path.join(into,leaf)),sum:fs.readFileSync(path.join(into,leaf+".sha256"),"utf8"),output:r.stdout};
}
test("the CI reference and private installer are independent of Git checkout line endings",()=>{
  const t=fs.mkdtempSync(path.join(os.tmpdir(),"reader-lines-")),original=build(root,path.join(t,"original"),reference);
  const members=Object.keys(unzipSync(original.bytes)).filter(n=>!["config.js","manifest.json"].includes(n));
  const inputs=["scripts/package-reader.cjs","reader/public-key.txt",...members.map(n=>n==="LICENSE"?n:
    (/^(?:licenses\/|locales\/|THIRD_PARTY_NOTICES\.md$|fast-text\.js$|i18n\.js$)/.test(n)?"extension/":"reader/")+n)];
  const results=["lf","crlf"].map(mode=>{
    const src=path.join(t,mode);
    for(const rel of inputs){const dest=path.join(src,rel),raw=fs.readFileSync(path.join(root,rel));
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.writeFileSync(dest,rel.endsWith(".png")?raw:Buffer.from(raw.toString("latin1").replace(/\r?\n/g,mode==="lf"?"\n":"\r\n"),"latin1"));
    }
    return [build(src,path.join(t,mode+"-neutral"),reference),build(src,path.join(t,mode+"-install"),lab)];
  });
  for(let i=0;i<2;i++)assert.ok(results[0][i].bytes.equals(results[1][i].bytes),"checkout changed ZIP bytes");
  assert.ok(original.bytes.equals(results[0][0].bytes));
  const packed=unzipSync(original.bytes);
  assert.equal(JSON.parse(Buffer.from(packed["manifest.json"])).version,"0.3.0");
  assert.ok(packed["center-selection.js"],"The actual selection model must be in both checkout variants.");
  for(const size of [16,32,48,128])
    assert.ok(Buffer.from(unzipSync(original.bytes)[`icons/icon${size}.png`]).equals(fs.readFileSync(path.join(root,`reader/icons/icon${size}.png`))));
});
test("verify private binding against a pinned neutral ZIP checksum, not a self-declared program hash",()=>{
  const {verify}=require("../scripts/verify-reader-distribution.cjs");
  const t=fs.mkdtempSync(path.join(os.tmpdir(),"reader-bind-")),ref=build(root,path.join(t,"ref"),reference);
  const origin="https://private-reader.example.test",instance=build(root,path.join(t,"private"),origin);
  const check=bytes=>verify(bytes,ref.sum,origin,true);
  const good=check(instance.bytes);assert.equal(good.installSha256,sha(instance.bytes));assert.equal(good.referenceSha256,sha(ref.bytes));
  assert.equal(good.files,Object.keys(unzipSync(ref.bytes)).length);
  assert.ok(!JSON.stringify(good).includes(origin)&&!instance.output.includes(origin));
  assert.throws(()=>verify(instance.bytes,ref.sum,origin,false)); // reserved domain is not a production destination
  assert.throws(()=>verify(instance.bytes,ref.sum,"https://different.example.test",true));
  assert.throws(()=>verify(instance.bytes,instance.sum,origin,true));
  const noEnd=instance.bytes.subarray(0,instance.bytes.length-22);assert.throws(()=>check(noEnd));
  assert.throws(()=>check(Buffer.concat([instance.bytes,Buffer.from("tail")])));
  const corrupt=fn=>{const files=unzipSync(instance.bytes);fn(files);return zipSync(files,{level:6,mtime:new Date(2000,0,1)});};
  for(const change of [
    f=>{f["background.js"]=Buffer.concat([f["background.js"],Buffer.from("\n// Other build\n")]);},
    f=>{f["extra.txt"]=Buffer.from("unexpected member");},f=>{delete f["host.js"];},
    f=>{f["config.js"]=Buffer.from("globalThis.READER_ORIGIN=\"https://another.example.test\";\n");},
    f=>{const m=JSON.parse(Buffer.from(f["manifest.json"]));m.permissions.push("bookmarks");f["manifest.json"]=Buffer.from(JSON.stringify(m,null,2));},
    f=>{const m=JSON.parse(Buffer.from(f["manifest.json"]));m.host_permissions.push("https://extra.example.test/*");f["manifest.json"]=Buffer.from(JSON.stringify(m,null,2));},
    f=>{const m=JSON.parse(Buffer.from(f["manifest.json"]));m.content_security_policy.extension_pages+=" https://extra.example.test";f["manifest.json"]=Buffer.from(JSON.stringify(m,null,2));},
  ])assert.throws(()=>check(corrupt(change)));
});
