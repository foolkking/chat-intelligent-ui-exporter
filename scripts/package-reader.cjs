// Build a fixed-origin private extension separately from the upstream exporter.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const [originArg, outArg] = process.argv.slice(2);
if (!originArg || !outArg) throw Error("Usage: node scripts/package-reader.cjs https://reader.example.test NEW_OUTPUT_DIRECTORY");
const u = new URL(originArg);
if (originArg !== u.origin || !(u.protocol === "https:" || u.protocol === "http:" && ["127.0.0.1","localhost"].includes(u.hostname))) throw Error("An exact HTTPS Reader origin (or local test loopback) is required.");
if (["chatgpt.com","chat.openai.com"].includes(u.hostname)) throw Error("Reader and capture origins must be different.");
const root = path.resolve(__dirname,".."), out = path.resolve(outArg);
fs.mkdirSync(out); // Refuse to overwrite an installed build.
for (const name of ["background.js","client.js","capture.js","visible.js","package.js","host.js","host.html","panel.html","panel.js","panel.css","vendor"])
  fs.cpSync(path.join(root,"reader",name),path.join(out,name),{recursive:true});
for (const name of ["fast-text.js","i18n.js","locales/en.js","locales/zh_CN.js","icons/icon128.png","THIRD_PARTY_NOTICES.md"]) {
  const dest = path.join(out,name);
  fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.copyFileSync(path.join(root,"extension",name),dest);
}
fs.cpSync(path.join(root,"extension/licenses"),path.join(out,"licenses"),{recursive:true});
fs.copyFileSync(path.join(root,"LICENSE"),path.join(out,"LICENSE"));
const key=fs.readFileSync(path.join(root,"reader/public-key.txt"),"ascii").trim();
const id=crypto.createHash("sha256").update(Buffer.from(key,"base64")).digest("hex").slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
fs.writeFileSync(path.join(out,"config.js"),`globalThis.READER_ORIGIN=${JSON.stringify(u.origin)};\n`);
fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify({
  manifest_version:3, minimum_chrome_version:"116", name:"Chat Reader", version:"0.1.0", key,
  description:"Browse your Reader library and save the current conversation.",
  action:{default_title:"Chat Reader"},icons:{"128":"icons/icon128.png"},
  permissions:["identity","storage","sidePanel","offscreen","downloads","alarms"],
  host_permissions:[u.origin+"/*","https://chatgpt.com/*"],
  background:{service_worker:"background.js"},side_panel:{default_path:"panel.html"},
  content_scripts:[{matches:["https://chatgpt.com/*"],js:["locales/en.js","locales/zh_CN.js","i18n.js","fast-text.js","visible.js","capture.js"]}],
  content_security_policy:{extension_pages:"script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'self' "+u.origin},
  incognito:"not_allowed"
},null,2));
console.log(`Built private Reader extension ${id} for ${u.origin}`);
