const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),cp=require("node:child_process");
test("Reader keeps its ID, ChatGPT-only injection and a private native import surface for other webpages",()=>{
  const task=fs.mkdtempSync(path.join(os.tmpdir(),"reader-surface-contract-")),out=path.join(task,"extension");
  const built=cp.spawnSync(process.execPath,[path.join(__dirname,"../scripts/package-reader.cjs"),"https://reader.example.test",out],{encoding:"utf8"});
  assert.equal(built.status,0,built.stderr);const m=JSON.parse(fs.readFileSync(path.join(out,"manifest.json")));
  assert.ok(m.permissions.includes("sidePanel"));assert.deepEqual(m.side_panel,{default_path:"center.html"});
  assert.deepEqual(m.web_accessible_resources,[{resources:["frame.html"],matches:["https://chatgpt.com/*"],use_dynamic_url:true}]);
  assert.deepEqual(m.content_scripts[0].matches,["https://chatgpt.com/*"]);
  const scripts=m.content_scripts[0].js;
  assert.ok(scripts.indexOf("routes.js")>=0&&scripts.indexOf("routes.js")<scripts.indexOf("workspace.js"));
  assert.ok(scripts.indexOf("workspace.js")<scripts.indexOf("capture.js"));
  assert.ok(scripts.indexOf("surface-state.js")>=0&&scripts.indexOf("surface-state.js")<scripts.indexOf("overlay.js"));
  assert.ok(scripts.indexOf("outline-tree.js")>scripts.indexOf("page-index.js")&&scripts.indexOf("outline-tree.js")<scripts.indexOf("overlay.js"));
  assert.equal(m.version,"0.3.1");
  for(const name of ["center.html","center.css","center.js","center-selection.js","batch-model.js","zip-source.js","archive-source.js","workspace.js","batch-worker.js","i18n.js","fast-text.js"])
    assert.ok(fs.existsSync(path.join(out,name)),"Unpackaged import-center dependency: "+name);
  for(const name of ["local-picker.js","local-source.js"])assert.ok(!fs.existsSync(path.join(out,name)),"Obsolete import path packaged: "+name);
  const crypto=require("node:crypto"),id=crypto.createHash("sha256").update(Buffer.from(m.key,"base64")).digest("hex").slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
  assert.equal(id,"gihbiofiiflkckcmomddkkjkoifkddfi");
  for(const size of [16,32,48,128]){
    const data=fs.readFileSync(path.join(out,m.icons[String(size)]));
    assert.equal(data.subarray(1,4).toString(),"PNG");assert.equal(data.readUInt32BE(16),size);assert.equal(data.readUInt32BE(20),size);
  }
  assert.ok(!fs.readFileSync(path.join(out,m.icons["128"])).equals(fs.readFileSync(path.join(__dirname,"../extension/icons/icon128.png"))));
  // Include navigation URLs, not just imports. A getURL("center.html") that
  // produces ERR_FILE_NOT_FOUND must stop release even when Node modules pass.
  const refs=new Set(["panel.html","host.html","frame.html"]);
  for(const name of fs.readdirSync(out).filter(n=>n.endsWith(".js")))
    for(const match of fs.readFileSync(path.join(out,name),"utf8").matchAll(/getURL\(["']([\w/.-]+\.html)["']\)/g))refs.add(match[1]);
  for(const name of refs)assert.ok(fs.existsSync(path.join(out,name)),"Unpackaged navigation target: "+name);
  // Verify both HTML imports and service-worker dependencies, not only entry URLs.
  for(const name of fs.readdirSync(out).filter(n=>n.endsWith(".html")))
    for(const match of fs.readFileSync(path.join(out,name),"utf8").matchAll(/(?:src|href)=["']([^"'#?]+\.(?:js|css))["']/g))
      assert.ok(fs.existsSync(path.join(out,match[1])),`${name}: unpackaged dependency ${match[1]}`);
  for(const name of ["background.js"])
    for(const call of fs.readFileSync(path.join(out,name),"utf8").matchAll(/importScripts\(([^)]+)\)/g))
      for(const match of call[1].matchAll(/["']([^"']+)["']/g))
        assert.ok(fs.existsSync(path.join(out,match[1])),`${name}: unpackaged worker dependency ${match[1]}`);
});
