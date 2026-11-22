/* global fflate */
// ZIP STORE writes one bounded chunk at a time. Same contract in reader_package.py.
globalThis.ReaderArchive = (() => {
  const enc = new TextEncoder(), CHUNK = 262144, ID = /^[\w-]{1,128}$/;
  const hex = a => Array.from(a, x=>x.toString(16).padStart(2,"0")).join("");
  const sha = async a => new Uint8Array(await crypto.subtle.digest("SHA-256",a));
  async function assetRoot(file) {
    let chain=new Uint8Array(32);
    for(let pos=0;pos<file.size;pos+=CHUNK){
      const chunk=new Uint8Array(await file.slice(pos,pos+CHUNK).arrayBuffer()), joined=new Uint8Array(32+chunk.length);
      joined.set(chain); joined.set(chunk,32); chain=await sha(joined);
    }
    return hex(chain);
  }
  async function member(zip,path,file,drain){
    const entry=new fflate.ZipPassThrough(path); entry.mtime=new Date(2000,0,1); zip.add(entry);
    for(let pos=0;pos<file.size;pos+=CHUNK){
      entry.push(new Uint8Array(await file.slice(pos,pos+CHUNK).arrayBuffer()),false); await drain();
    }
    entry.push(new Uint8Array(0),true); await drain();
  }
  async function build(dir, meta, readRows, assets){
    if(!ID.test(meta.id)||!["tree","list"].includes(meta.lineage))throw Error("Invalid conversation identity");
    const title=String(meta.title||"ChatGPT").replace(/[\r\n]/g," ").slice(0,512)||"ChatGPT";
    const entries=await Promise.all(["body.tmp","index.tmp","import.zip"].map(name=>dir.getFileHandle(name,{create:true})));
    const [md,index,out]=await Promise.all(entries.map(entry=>entry.createWritable()));
    let pending=[], closing=false;
    const drain=async()=>{for(const chunk of pending) await out.write(chunk);pending=[];};
    try{
      const zip=new fflate.Zip((err,data)=>{if(err)throw err;pending.push(data)});
      const manifest={version:"reader-chat-v1",source_id:meta.id,title,lineage:meta.lineage,messages:[],assets:[],partial:!!meta.partial};
      for(const [path,handle] of assets){
        const file=await handle.getFile();
        manifest.assets.push({path,kind:meta.images.includes(path)?"image":"file",root:await assetRoot(file)});
        await member(zip,path,file,drain);
      }
      const top=enc.encode(`# ${title}\n\n`); await md.write(top); let pos=top.length, prev=null, count=0;
      for await(const row of readRows()){
        if(!ID.test(row.id)||!["user","assistant"].includes(row.role)||++count>50000)throw Error("Invalid message");
        const body=enc.encode(row.body); if(!body.length||body.length>2*1024*1024)throw Error("Message exceeds the single-message limit");
        const label=enc.encode(`## ${row.role==="user"?"User":"Assistant"}\n\n`);
        await md.write(label); pos+=label.length;
        if(meta.lineage==="tree"&&(!Array.isArray(row.sourcePath)||!row.sourcePath.length||row.sourcePath.length>128||!row.sourcePath.every(x=>ID.test(x))))throw Error("Missing selected tree path");
        const item={id:row.id,parent:meta.lineage==="tree"?prev:null,source_path:meta.lineage==="tree"?row.sourcePath:[],role:row.role,offset:pos,bytes:body.length,
          sha256:hex(await sha(body)),assets:row.assets,at:row.at||null};
        await index.write(JSON.stringify(item)+"\n");await md.write(body);await md.write("\n\n");pos+=body.length+2;prev=row.id;
      }
      if(!count)throw Error("No displayed messages");
      await md.close(); await index.close();
      await member(zip,"conversation.md",await entries[0].getFile(),drain);
      await member(zip,"reader/source.jsonl",await entries[1].getFile(),drain);
      await member(zip,"manifest.json",new Blob([JSON.stringify(manifest)]),drain);
      zip.end();await drain();await out.close();closing=true;return await entries[2].getFile();
    }finally{if(!closing)await Promise.allSettled([md,index,out].map(w=>w.abort()));}
  }
  return {CHUNK,build,assetRoot};
})();
