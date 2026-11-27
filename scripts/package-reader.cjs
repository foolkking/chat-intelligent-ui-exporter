// Build a fixed-origin private extension separately from the upstream exporter.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const [originArg, outArg, option] = process.argv.slice(2);
if (!originArg || !outArg || (option && option !== "--zip") || process.argv.length>5) throw Error("Usage: node scripts/package-reader.cjs HTTPS_ORIGIN NEW_OUTPUT_DIRECTORY [--zip]");
const u = new URL(originArg);
if (originArg !== u.origin || u.hostname.includes("*") || !(u.protocol === "https:" || u.protocol === "http:" && ["127.0.0.1","localhost"].includes(u.hostname))) throw Error("An exact HTTPS Reader origin (or local test loopback) is required.");
if (["chatgpt.com","chat.openai.com"].includes(u.hostname)) throw Error("Reader and capture origins must be different.");
const root = path.resolve(__dirname,".."), out = path.resolve(outArg);
fs.mkdirSync(out); // Refuse to overwrite an installed build.
// Git for Windows may check text out as CRLF. Canonicalize only packaged text, not images
// or user data, so the unpacked installer matches Linux CI byte for byte.
function copyMember(src,dest){
  if(!fs.lstatSync(src).isFile())throw Error("Only regular package members are supported");
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  const b=fs.readFileSync(src);
  const text=path.basename(src)==="LICENSE" || /\.(?:js|css|html|md|txt)$/.test(src);
  fs.writeFileSync(dest,text?Buffer.from(b.toString("latin1").replace(/\r\n/g,"\n"),"latin1"):b,{flag:"wx"});
}
for (const name of ["background.js","client.js","source-actions.js","source-control.js","append-picker.js","capture.js","glyphs.js","visible.js","package.js","host.js","host.html","transfer-state.js",
                    "progress.js","progress-view.js","sha256.js","upload.js","source-file.js","routes.js","surface-state.js","surfaces.js","frame.html","frame.js","page-index.js","outline-tree.js","overlay.js",
                    "center.html","center.css","center.js","center-selection.js","center-projects.js","batch-model.js","zip-source.js","archive-source.js","workspace.js","batch-worker.js",
                    "panel.html","panel.js","panel-jobs.js","panel-export.js","panel.css","vendor/fflate-0.8.3.js","vendor/fflate-LICENSE.txt"]){
  copyMember(path.join(root,"reader",name),path.join(out,name));
}
for (const size of [16,32,48,128])copyMember(path.join(root,"reader/icons",`icon${size}.png`),path.join(out,"icons",`icon${size}.png`));
for (const name of ["fast-text.js","source-dom.js","i18n.js","locales/en.js","locales/zh_CN.js","THIRD_PARTY_NOTICES.md"]) {
  copyMember(path.join(root,"extension",name),path.join(out,name));
}
const licenseDir=path.join(root,"extension/licenses");
for(const name of fs.readdirSync(licenseDir))copyMember(path.join(licenseDir,name),path.join(out,"licenses",name));
copyMember(path.join(root,"LICENSE"),path.join(out,"LICENSE"));
const key=fs.readFileSync(path.join(root,"reader/public-key.txt"),"ascii").trim();
const id=crypto.createHash("sha256").update(Buffer.from(key,"base64")).digest("hex").slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
fs.writeFileSync(path.join(out,"config.js"),`globalThis.READER_ORIGIN=${JSON.stringify(u.origin)};\n`);
fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify({
  manifest_version:3, minimum_chrome_version:"116", name:"Chat Reader", version:"0.3.1", key,
  description:"Browse your Reader library and save the current conversation.",
  action:{default_title:"Chat Reader",default_icon:{"16":"icons/icon16.png","32":"icons/icon32.png"}},icons:{"16":"icons/icon16.png","32":"icons/icon32.png","48":"icons/icon48.png","128":"icons/icon128.png"},
  permissions:["identity","storage","offscreen","downloads","alarms","sidePanel"],
  side_panel:{default_path:"center.html"},
  host_permissions:[u.origin+"/*","https://chatgpt.com/*"],
  background:{service_worker:"background.js"},
  web_accessible_resources:[{resources:["frame.html"],matches:["https://chatgpt.com/*"],use_dynamic_url:true}],
  content_scripts:[{matches:["https://chatgpt.com/*"],js:["locales/en.js","locales/zh_CN.js","i18n.js","fast-text.js","source-dom.js","progress.js","progress-view.js","source-file.js","visible.js","glyphs.js","routes.js","surface-state.js","page-index.js","outline-tree.js","overlay.js","source-control.js","append-picker.js","workspace.js","capture.js"]}],
  content_security_policy:{extension_pages:"script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'self' "+u.origin},
  incognito:"not_allowed"
},null,2));
console.log(`Built private Reader extension ${id}`);
if(option==="--zip"){
  const {zipSync,unzipSync}=require("../reader/vendor/fflate-0.8.3.js");
  const files={},visit=(dir,prefix="")=>{
    for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const file=path.join(dir,e.name),name=prefix+e.name;
      if(e.isDirectory())visit(file,name+"/");
      else if(e.isFile())files[name]=fs.readFileSync(file);
      else throw Error("Unexpected non-regular entry in new package");
    }
  };
  visit(out);
  const m=JSON.parse(files["manifest.json"]),zip=zipSync(files,{level:6,mtime:new Date(2000,0,1)}),read=unzipSync(zip);
  if(Object.keys(files).length!==Object.keys(read).length||Object.keys(files).some(k=>!files[k].equals(read[k])))throw Error("Installable ZIP read-back failed");
  const filename=`chat-reader-${m.version}.zip`,digest=crypto.createHash("sha256").update(zip).digest("hex"),dest=path.join(path.dirname(out),filename);
  fs.writeFileSync(dest,zip,{flag:"wx"});fs.writeFileSync(dest+".sha256",`${digest}  ${filename}\n`,{flag:"wx"});
  console.log(`${filename} · ${Object.keys(files).length} verified files · SHA-256 ${digest}`);
}
