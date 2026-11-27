// Source-local adapter. Only explicit extension-page requests can discover this tab.
// Session credentials stay inside this isolated world; only a hashed owner scope leaves it.
globalThis.ReaderWorkspace = ({capture,busy}) => {
  const nonce=crypto.randomUUID(),valid=s=>typeof s==="string"&&/^[\w-]{1,128}$/.test(s);
  const privatePath=()=>ReaderRoutes.eligible(location.pathname);
  async function scope(session){
    // No account-id guesses, email matching, JWT decoding or default-workspace assumption.
    const user=session?.user?.id,account=session?.account?.id;
    if(!valid(user)||!valid(account))throw Error("scope-unverified");
    const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(["reader-workspace-v1",user,account])));
    return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,"0")).join("");
  }
  async function current(){
    const r=await fetch("/api/auth/session",{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
    if(!r.ok)throw Error("scope-unverified");return scope(await r.json());
  }
  let namesRevision=0,namesObserver,observedOwner,observedPath,knownProjects=new Set(),homeChecks=new Map(),stopHomes=false;
  const nameSurface=ReaderRoutes.directorySelector+",[data-project-id],main h1,main [role=heading][aria-level='1']";
  function changedNames(records){
    for(const record of records){
      const node=record.target.nodeType===1?record.target:record.target.parentElement;
      if(!node||node.closest(ReaderRoutes.bodySelector))continue;
      if(node.closest(nameSurface)||node.id||record.attributeName==="data-project-id"||
          [...record.addedNodes,...record.removedNodes].some(n=>n.nodeType===1&&!n.matches(ReaderRoutes.bodySelector)&&(n.matches(nameSurface)||n.querySelector(nameSurface)))){
        namesRevision++;break;
      }
    }
  }
  function observeNames(){
    if(!namesObserver&&typeof MutationObserver==="function"){
      namesObserver=new MutationObserver(changedNames);
      namesObserver.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,
        attributeFilter:["href","title","aria-label","aria-labelledby","role","data-project-id","data-project-name","hidden","inert","aria-hidden","class","style"]});
    }
    if(namesObserver)changedNames(namesObserver.takeRecords());
  }
  async function homeName(id){
    const url=new URL(`/g/${encodeURIComponent(id)}/project`,location.origin);
    const response=await fetch(url,{credentials:"same-origin",redirect:"error",referrerPolicy:"no-referrer",
      headers:{Accept:"text/html"},signal:AbortSignal.timeout(3500)});
    if([401,403,429].includes(response.status))return {reason:"access"};
    if(!response.ok||response.url!==url.href||!/^text\/html\b/i.test(response.headers.get("content-type")||""))return {reason:"unavailable"};
    const reader=response.body?.getReader(),limit=512*1024;
    if(!reader)return {reason:"unavailable"};
    const decoder=new TextDecoder();let bytes=0,html="";
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;
        bytes+=value.byteLength;if(bytes>limit)return {reason:"size-limit"};
        html+=decoder.decode(value,{stream:true});
      }
    }finally{await reader.cancel().catch(()=>{});}
    // A template keeps remote markup inert, including images and custom elements.
    // Never execute scripts or treat a generic app-shell title as a project name.
    const template=document.createElement("template");template.innerHTML=html+decoder.decode();
    const doc=template.content;
    const identified=[...doc.querySelectorAll("[data-project-id][data-project-name]")].filter(n=>
      !n.closest(ReaderRoutes.bodySelector)&&ReaderRoutes.projectId(n.getAttribute("data-project-id"))===id);
    const names=new Set(identified.map(n=>ReaderRoutes.projectName(n.getAttribute("data-project-name"),id)).filter(Boolean));
    const metadata=ReaderRoutes.homeMetadata(doc,url,id);if(metadata)names.add(metadata);
    const canonical=doc.querySelector('link[rel~="canonical"]')?.getAttribute("href");
    if(canonical){
      const link=new URL(canonical,url);
      if(link.origin!==url.origin||ReaderRoutes.projectHome(link.pathname)!==id)return {reason:"unavailable"};
      const headings=[...doc.querySelectorAll("main h1")].filter(n=>!n.closest(ReaderRoutes.bodySelector+",[hidden],[inert],[aria-hidden=true]"));
      if(headings.length===1){const name=ReaderRoutes.projectName(headings[0].textContent,id);if(name)names.add(name);}
    }
    return names.size===1?{name:[...names][0]}:{reason:names.size?"conflict":"no-server-label"};
  }
  async function discover(){
    if(!privatePath())throw Error("source-changed");
    const rows=new Map(),claims=new Map(),path=location.pathname,project=ReaderRoutes.project(path);
    let owner=null;try{owner=await current();}catch{/* A partial directory is still available. */}
    if(location.pathname!==path)throw Error("source-changed");
    if(observedOwner!==owner||observedPath!==path){homeChecks=new Map();stopHomes=false;}
    observedOwner=owner;observedPath=path;observeNames();
    const {groups,evidence,links}=ReaderRoutes.projectCatalogue(document,path);
    const add=(id,title,p)=>{
      const known=claims.get(id)||new Set();if(p)known.add(p);claims.set(id,known);
      rows.set(id,{id,title,group:known.size===1?"project:"+[...known][0]:"unknown"});
    };
    // A private chat's own header is also an explicitly visible discovery, not an account scan.
    const own=ReaderRoutes.chat(path);
    if(own)add(own,document.title.replace(/\s*[-|]\s*ChatGPT\s*$/,"").slice(0,512)||"ChatGPT",project);
    for(const a of links){
      const u=new URL(a.href,location.origin);if(u.origin!=="https://chatgpt.com")continue;
      const id=ReaderRoutes.chat(u.pathname);if(!id)continue;
      const p=ReaderRoutes.project(u.pathname);
      const title=(a.innerText||a.textContent||"").trim().slice(0,512);if(!title)continue;
      // Conflicting directory claims become unknown, never silently adopt one project.
      add(id,title,p);
    }
    knownProjects=new Set([...rows.values()].map(r=>r.group).filter(ReaderRoutes.groupKey));
    return {rows:[...rows.values()],groups,evidence,namesRevision,scope:owner,nonce,path,complete:false,hint:project?"project:"+project:null};
  }
  chrome.runtime.onMessage.addListener((m,s,reply)=>{
    if(s.id!==chrome.runtime.id||s.tab||!["reader-batch-discover","reader-batch-names","reader-batch-check","reader-batch-capture"].includes(m?.kind))return;
    if(m.kind==="reader-batch-discover"){discover().then(reply,e=>reply({error:e.message}));return true;}
    const changed=()=>Object.assign(Error("source-changed"),{code:"SOURCE_BRANCH_UNVERIFIED"});
    const check=()=>{if(m.nonce!==nonce||m.path!==location.pathname||!privatePath())throw changed();};
    const assert=async()=>{check();if(!m.scope||await current()!==m.scope)throw changed();check();};
    if(m.kind==="reader-batch-names"){
      (async()=>{
        check();if(!observedOwner||observedOwner!==m.scope)throw changed();
        observeNames();
        const project=knownProjects.has(m.missing)&&!homeChecks.has(m.missing)&&!stopHomes?m.missing:null;
        if(m.revision===namesRevision&&!m.recheck&&!project)return {unchanged:true};
        await assert();observeNames();
        const {groups,evidence}=ReaderRoutes.projectCatalogue(document,location.pathname);
        const revision=namesRevision;
        if(project&&!Object.hasOwn(groups,project)){
          const checks=homeChecks;checks.set(project,{reason:"pending"});
          let result;try{result=await homeName(project.slice(8));}catch{result={reason:"unavailable"};}
          await assert();if(homeChecks!==checks)throw changed();
          checks.set(project,{...result,at:Date.now()});if(result.reason==="access")stopHomes=true;
        }
        for(const [key,result] of homeChecks){
          if(Object.hasOwn(groups,key)||result.at<Date.now()-12*3600*1000){homeChecks.delete(key);continue;}
          if(result.name){groups[key]=result.name;evidence[key]={source:"project-document",confidence:"explicit",at:result.at};}
          else evidence[key]={source:result.reason,confidence:"none"};
        }
        return {groups,evidence,namesRevision:revision,at:Date.now()};
      })().then(reply,()=>reply({error:"source-changed"}));return true;
    }
    if(m.kind==="reader-batch-check"){assert().then(()=>reply({current:true}),()=>reply({current:false}));return true;}
    if(busy()){reply({error:"source-busy"});return;}
    assert().then(()=>{
      if(!valid(m.id)||busy())throw Error("source-busy");
      // Reader target, device tokens and receipt contents are never exposed here.
      const batch={id:m.id,ticket:m.ticket,attempt:m.attempt,textOnly:m.textOnly,check,assert,
        validate:async session=>{if(await scope(session)!==m.scope)throw changed();}};
      const work=capture(()=>{},false,batch);
      reply({started:true});
      work.catch(e=>chrome.runtime.sendMessage({kind:"batch-source-error",attempt:m.attempt,nonce,
        diagnostic:ReaderProgress.sourceDiagnostic(e)}).catch(()=>{}));
    }).catch(e=>reply({error:e.message}));return true;
  });
};
