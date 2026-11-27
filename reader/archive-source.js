// Official-export adapter: catalogue and parse one selected conversation at a time.
// The original archive and unselected conversations never go to Reader.
globalThis.ReaderLocalArchive=(()=>{
  const valid=v=>typeof v==="string"&&/^[\w-]{1,128}$/.test(v);
  const fail=()=>{throw Error("source-format");};
  async function fingerprint(file,check=()=>{},report=()=>{}) {
    const hash=new ReaderSHA256();
    for(let p=0;p<file.size;p+=262144){
      check();hash.update(new Uint8Array(await file.slice(p,p+262144).arrayBuffer()));
      report({stage:"source",done:Math.min(file.size,p+262144),total:file.size});
    }
    return hash.hex();
  }
  async function open(file,dir,check=()=>{},report=()=>{}) {
    const digest=await fingerprint(file,check,report),magic=new Uint8Array(await file.slice(0,4).arrayBuffer());
    let zip,source=file,projectDirectory;
    if(magic.join(",")==="80,75,3,4"){
      zip=await ReaderZipSource.open(file,check);
      const candidates=[...zip.members.values()].filter(m=>/(^|\/)conversations\.json$/i.test(m.name));
      if(candidates.length!==1)throw Error("conversation-file");
      source=await zip.extract(candidates[0],await dir.getFileHandle("catalogue.json",{create:true}),report);
      projectDirectory=zip.members.get(candidates[0].name.replace(/conversations\.json$/i,"projects.json"));
    }
    const rows=[],ids=new Set(),names=new Map(),projectGroups=new Set();
    function claim(group,value,claims=names){
      const name=ReaderRoutes.projectName(value,group.slice(8));
      if(!name)return;
      if(!claims.has(group))claims.set(group,name);
      else if(claims.get(group)!==name)claims.set(group,null);
    }
    for await(const span of ReaderSourceFile.entries(source,0,source.size,false,check)){
      check();const piece=source.slice(span.start,span.end),h=await ReaderSourceFile.header(piece,check,true);
      const id=h.conversation_id??h.id;
      if(!valid(id)||h.id!=null&&h.id!==id||ids.has(id)||!h.mapping||!valid(h.current_node))fail();
      ids.add(id);
      // Missing membership is unknown. A Custom GPT's gizmo_id is never a project.
      const group=valid(h.project_id)?"project:"+h.project_id:h.project_id===null?"unclassified":"unknown";
      if(group.startsWith("project:")){
        projectGroups.add(group);claim(group,h.project_name);claim(group,h.project_title);
      }
      rows.push({id,title:String(h.title||"ChatGPT").slice(0,512),group,start:span.start,end:span.end,
        ...(Number.isFinite(h.update_time)?{update_time:h.update_time}:{})});
      report({stage:"index",done:rows.length});
    }
    // Optional sibling directory of explicit {id,name} records. It can name an
    // already proven group, never assign conversations or turn a GPT into a project.
    if(projectDirectory&&projectGroups.size){
      try{
        const catalog=await zip.extract(projectDirectory,await dir.getFileHandle("project-names.json",{create:true}),report);
        const read=ReaderSourceFile.fileReader(catalog),pending=new Map(names),keys=new Set(["id","project_id","name","title","project_name"]);
        for await(const span of ReaderSourceFile.entries(catalog,0,catalog.size,false,check)){
          const entry={};
          for await(const f of ReaderSourceFile.entries(catalog,span.start,span.end,true,check)){
            if(!keys.has(f.key))continue;
            if(Object.hasOwn(entry,f.key))throw Error("optional-directory");
            entry[f.key]=f.end-f.start<=8192?await read(f.start,f.end):null;
          }
          const id=entry.project_id??entry.id;
          if(!valid(id)||entry.id!=null&&entry.id!==id||!projectGroups.has("project:"+id))continue;
          for(const name of [entry.name,entry.title,entry.project_name])claim("project:"+id,name,pending);
        }
        for(const [group,name] of pending)names.set(group,name);
      }catch(e){
        // Optional names are advisory. Never publish a partially read directory,
        // weaken conversation/member checks, or swallow cancellation / I/O failures.
        if(!(e instanceof SyntaxError)&&!["Unrecognized conversation source.","optional-directory","archive-format"].includes(e.message))throw e;
        check();
      }
    }
    const index=new Map(rows.map(r=>[r.id,r]));
    function memberFor(ref,filename){
      if(!zip)return null;
      const exact=zip.members.get(ref);if(exact&&!exact.name.endsWith("/"))return exact;
      // Never resolve by display name alone or guess a sandbox file's basename.
      const matches=[...zip.members.values()].filter(m=>{
        const b=m.name.split("/").at(-1);
        return b===ref||filename&&b===ref+"-"+filename;
      });
      return matches.length===1?matches[0]:null;
    }
    async function build(id,output,{attachments=true,check:guard=check,report:progress=report}={}){
      const row=index.get(id);if(!row)fail();guard();
      const piece=source.slice(row.start,row.end),h=await ReaderSourceFile.header(piece,guard);
      const data=await ReaderSourceFile.tree(piece,h,null,guard,progress),assets=new Map(),images=new Set(),seen=new Map();
      const meta={id,title:row.title,lineage:"tree",images:[],partial:false};
      const losses={files:0,interactions:0,links:0},writer=await ReaderArchive.writer(output,meta);let count=0,fileCount=0;
      try{
        for await(const m of data.rows()){
          guard();const visible=ReaderVisible(m,FastTextExporter),paths=new Set();let body=visible.body;
          const refs=new Map();
          for(const a of m.images||[])refs.set("asset:"+a.fileId,{ref:a.fileId,image:true});
          for(const a of m.attachments||[])refs.set("attachment:"+a.fileId,{ref:a.fileId,name:a.name});
          for(const a of m.tables||[])refs.set("datatable:"+a.fileId,{ref:a.fileId,name:(a.title||"table")+".csv"});
          for(const a of body.matchAll(/\]\(sandbox:(\/mnt\/data\/[^()\s]+)\)/g))refs.set("sandbox:"+a[1],{ref:a[1]});
          for(const [link,a] of refs){
            if(!attachments){body=body.split("]("+link+")").join("] [text only]");continue;}
            const member=memberFor(a.ref,a.name);let path=member&&seen.get(member.name);
            if(member&&!path){
              path="assets/"+(++fileCount)+"-"+member.name.split("/").at(-1).replace(/[^\p{L}\p{N}_.-]/gu,"_").slice(-100);
              const handle=await output.getFileHandle("asset-"+fileCount,{create:true});
              try{await zip.extract(member,handle,p=>progress({stage:"asset",files:fileCount,done:p.done,total:p.total}));}
              catch(e){
                if(e.message==="archive-format")throw Object.assign(Error("Archive attachment failed integrity checks"),{code:"SOURCE_ATTACHMENT_FAILED"});
                throw e;
              }
              seen.set(member.name,path);assets.set(path,handle);
            }
            if(path){
              if(!body.includes("]("+link+")"))body+="\n\n["+(a.image?"Image":"File")+"]("+link+")";
              body=body.split("]("+link+")").join("]("+path+")");paths.add(path);if(a.image)images.add(path);
            }else{losses.files++;body=body.split("]("+link+")").join("] [unavailable]");}
          }
          if(visible.missing||m.needsUI&&!m.dil)losses.interactions++;
          if(m.needsAssets&&attachments)losses.files++;
          body=body.replace(/!\[([^\]]*)\]\(https?:\/\/[^)\s]+\)/gi,(_,alt)=>{losses.links++;return `[${alt||"Image"} unavailable]`;})
            .replace(/https?:\/\/[^\s)<>]*(?:[?&](?:x-amz-signature|x-goog-signature|sig|access_token)=)[^\s)<>]*/gi,()=>{losses.links++;return "[temporary link omitted]";});
          await writer.begin({id:m.id,role:m.role,sourcePath:m.sourcePath,assets:[...paths],
            at:Number.isFinite(m.createTime)?new Date(m.createTime*1000).toISOString():null});
          for(let p=0;p<body.length;){guard();let end=Math.min(body.length,p+65536);
            if(end<body.length&&/[\ud800-\udbff]/.test(body[end-1]))end--;
            await writer.text(body.slice(p,end));p=end;}
          await writer.end();progress({stage:"messages",done:++count});
        }
        losses.interactions+=data.warnings.length;meta.partial=Object.values(losses).some(Boolean);meta.images=[...images];
        const archive=await writer.finish(assets,progress);return {file:archive,sha256:meta.zipDigest,partial:meta.partial,losses};
      }catch(e){await writer.abort();throw e;}
    }
    const evidence={};
    for(const group of projectGroups)evidence[group]=names.get(group)?{source:"export-metadata",confidence:"explicit"}:
      {source:names.has(group)?"conflict":"missing",confidence:"none"};
    return {digest,rows,groups:Object.fromEntries([...names].filter(([,name])=>name)),evidence,build,complete:true};
  }
  return {open,fingerprint};
})();
