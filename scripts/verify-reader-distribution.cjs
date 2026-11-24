// Offline verifier for archives created by package-reader.cjs. Never execute or extract their members.
// The neutral ZIP digest MUST come from the independently verified Fork CI run, not the installer.
const fs=require("node:fs"),crypto=require("node:crypto");
const {zipSync,unzipSync}=require("../reader/vendor/fflate-0.8.3.js");
const neutral="https://reader.example.test", source="https://chatgpt.com/*",maxZip=4*1024**2;
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const config=origin=>`globalThis.READER_ORIGIN=${JSON.stringify(origin)};\n`;
const csp=origin=>"script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'self' "+origin;
const serial=m=>Buffer.from(JSON.stringify(m,null,2));
const encode=files=>Buffer.from(zipSync(files,{level:6,mtime:new Date(2000,0,1)}));
const requireMatch=(ok,msg)=>{if(!ok)throw Error(msg);};
function verify(zip,receipt,origin,testOnly=false){
  let u;try{u=new URL(origin);}catch{throw Error("Expected a fixed Reader origin");}
  const host=u.hostname,local=["localhost","127.0.0.1","[::1]"].includes(host);
  const reserved=local||/(\.|^)(?:test|invalid|example|localhost)$/.test(host)
    ||/(^|\.)(?:example\.com|example\.net|example\.org)$/.test(host)||/^127\./.test(host);
  requireMatch(origin===u.origin&&!host.includes("*")&&!["chatgpt.com","chat.openai.com"].includes(host)
    &&(u.protocol==="https:"||testOnly&&u.protocol==="http:"&&local)
    &&(testOnly||!reserved),"Not an approved distribution origin");
  const pin=/^([a-f0-9]{64})  chat-reader-(\d+(?:\.\d+){1,3})\.zip\r?\n?$/.exec(receipt);
  requireMatch(pin&&pin[0]===receipt,"Expected the single neutral CI ZIP checksum");
  requireMatch(Buffer.isBuffer(zip)&&zip.length>0&&zip.length<=maxZip,"Unexpected installer size");
  let bytes=0;const names=new Set();
  const files=unzipSync(zip,{filter:info=>{
    const n=info.name; bytes+=info.originalSize;
    requireMatch(n.length<=192&&n.split("/").every(s=>/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s))
      &&!names.has(n)&&names.size<128&&bytes<=16*1024**2,"Unexpected package member");
    names.add(n);return true;
  }});
  requireMatch(encode(files).equals(zip),"ZIP does not match the canonical package format");
  requireMatch(files["config.js"]&&Buffer.from(files["config.js"]).equals(Buffer.from(config(origin))),"Wrong instance binding");
  let m;try{m=JSON.parse(Buffer.from(files["manifest.json"]));}catch{throw Error("Invalid packaged manifest");}
  requireMatch(m?.version===pin[2]&&serial(m).equals(Buffer.from(files["manifest.json"]))
    &&JSON.stringify(m.host_permissions)===JSON.stringify([origin+"/*",source])
    &&m.content_security_policy?.extension_pages===csp(origin),"Unexpected manifest or binding");
  // Change only the three origin occurrences written by the packager. Re-encode the entire
  // ZIP: other permissions, code, assets, license bytes, names and ordering must all match.
  m.host_permissions[0]=neutral+"/*";m.content_security_policy.extension_pages=csp(neutral);
  files["manifest.json"]=serial(m);files["config.js"]=Buffer.from(config(neutral));
  requireMatch(sha(encode(files))===pin[1],"Program differs from the pinned CI reference");
  return {version:m.version,files:names.size,installSha256:sha(zip),referenceSha256:pin[1]};
}
module.exports={verify};
if(require.main===module){
  try{
    const [zip,proof,mode]=process.argv.slice(2);requireMatch(zip&&proof&&(!mode||mode==="--test-only")&&process.argv.length<=5,
      "Usage: set READER_DISTRIBUTION_ORIGIN; pass INSTANCE_ZIP CI_REFERENCE_CHECKSUM [--test-only]");
    for(const [p,limit] of [[zip,maxZip],[proof,256]]){
      const s=fs.lstatSync(p);requireMatch(s.isFile()&&s.size<=limit,"Unexpected verification input");
    }
    console.log(JSON.stringify(verify(fs.readFileSync(zip),fs.readFileSync(proof,"utf8"),process.env.READER_DISTRIBUTION_ORIGIN,mode==="--test-only")));
  }catch{console.error("Reader installer verification failed. Check the trusted run, instance binding and package bytes.");process.exitCode=1;}
}
