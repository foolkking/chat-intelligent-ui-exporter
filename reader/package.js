/* global fflate, ReaderSHA256 */
globalThis.ReaderArchive = (() => {
  const enc=new TextEncoder(), CHUNK=262144, id=s=>typeof s==="string"&&/^[\w-]{1,128}$/.test(s);
  const hex=a=>Array.from(a,x=>x.toString(16).padStart(2,"0")).join("");
  async function nextRoot(previous,bytes) {
    const joined=new Uint8Array(32+bytes.length);joined.set(previous);joined.set(bytes,32);
    return new Uint8Array(await crypto.subtle.digest("SHA-256",joined));
  }
  async function assetRoot(file) {
    let digest=new Uint8Array(32);
    for(let p=0;p<file.size;p+=CHUNK)digest=await nextRoot(digest,new Uint8Array(await file.slice(p,p+CHUNK).arrayBuffer()));
    return hex(digest);
  }
  // Buffer only a disk-write unit. A 50,000-message thread does not need 200,000 tiny OPFS writes.
  function buffered(w) {
    const parts=[];let size=0;
    async function flush(){if(size){await w.write(new Blob(parts));parts.length=0;size=0;}}
    return {async write(bytes){parts.push(bytes);size+=bytes.length;if(size>=CHUNK)await flush();},
      async close(){await flush();await w.close();},abort:()=>w.abort()};
  }
  async function writer(dir,meta) {
    if(!id(meta.id)||!["tree","list"].includes(meta.lineage))throw Error("Invalid conversation identity");
    const title=String(meta.title||"ChatGPT").replace(/[\r\n]/g," ").slice(0,512)||"ChatGPT";
    const [bodyFile,indexFile]=await Promise.all(["body.tmp","index.tmp"].map(k=>dir.getFileHandle(k,{create:true})));
    const body=buffered(await bodyFile.createWritable()),index=buffered(await indexFile.createWritable());
    const header=enc.encode(`# ${title}\n\n`),newline=enc.encode("\n\n");
    let position=header.length,prev=null,count=0,row,hash,bytes;await body.write(header);
    async function begin(r) {
      if(row||!id(r.id)||!["user","assistant"].includes(r.role)||!Array.isArray(r.assets))throw Error("Invalid source message");
      if(meta.lineage==="tree"&&(!Array.isArray(r.sourcePath)||!r.sourcePath.length||!r.sourcePath.every(id)))throw Error("Missing selected tree path");
      const label=enc.encode(`## ${r.role==="user"?"User":"Assistant"}\n\n`);await body.write(label);position+=label.length;
      row=r;bytes=0;hash=new ReaderSHA256();
    }
    async function text(value) {
      if(!row||typeof value!=="string")throw Error("No open source message");
      const part=enc.encode(value);hash.update(part);bytes+=part.length;await body.write(part);
    }
    async function end(){
      if(!row||!bytes)throw Error("Empty source message");
      const item={id:row.id,parent:meta.lineage==="tree"?prev:null,source_path:meta.lineage==="tree"?row.sourcePath:[],role:row.role,
        offset:position,bytes,sha256:hash.hex(),assets:row.assets,at:row.at||null};
      if(meta.excerpt&&row.question)item.question=row.question;
      await index.write(enc.encode(JSON.stringify(item)+"\n"));await body.write(newline);
      position+=bytes+2;prev=row.id;row=hash=null;count++;
    }
    async function finish(assets,report=()=>{}){
      if(row||!count)throw Error("Incomplete message stream");
      await body.close();await index.close();
      const output=await dir.getFileHandle("import.zip",{create:true}),out=await output.createWritable(),pending=[];
      const zip=new fflate.Zip((e,data)=>{if(e)throw e;pending.push(data);});
      let written=0;const archiveHash=new ReaderSHA256();
      async function drain(){for(const part of pending){await out.write(part);archiveHash.update(part);written+=part.length;}pending.length=0;report({stage:"package",done:written});}
      async function member(name,file,computeRoot=false){
        const entry=new fflate.ZipPassThrough(name);entry.mtime=new Date(2000,0,1);zip.add(entry);let digest=new Uint8Array(32);
        for(let p=0;p<file.size;p+=CHUNK){
          const part=new Uint8Array(await file.slice(p,p+CHUNK).arrayBuffer());
          if(computeRoot)digest=await nextRoot(digest,part);entry.push(part,false);await drain();
        }
        entry.push(new Uint8Array(),true);await drain();return hex(digest);
      }
      try{
        const manifest={version:"reader-chat-v1",source_id:meta.id,title,lineage:meta.lineage,messages:[],assets:[],partial:!!meta.partial};
        const images=new Set(meta.images);
        for(const [path,handle] of assets)manifest.assets.push({path,kind:images.has(path)?"image":"file",root:await member(path,await handle.getFile(),true)});
        await member("conversation.md",await bodyFile.getFile());await member("reader/source.jsonl",await indexFile.getFile());
        await member("manifest.json",new Blob([JSON.stringify(manifest)]));zip.end();await drain();await out.close();
        meta.zipDigest=archiveHash.hex();
        return output.getFile();
      }catch(e){await out.abort().catch(()=>{});throw e;}
    }
    return {begin,text,end,finish,abort:()=>Promise.allSettled([body.abort(),index.abort()])};
  }
  async function build(dir,meta,readRows,assets,report){
    const archive=await writer(dir,meta);
    try{for await(const row of readRows()){
      await archive.begin(row);await archive.text(row.body);await archive.end();
    }return await archive.finish(assets,report);}
    catch(e){await archive.abort();throw e;}
  }
  return {writer,build,assetRoot,CHUNK};
})();
