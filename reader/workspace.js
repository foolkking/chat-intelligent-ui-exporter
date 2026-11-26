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
  async function discover(){
    if(!privatePath())throw Error("source-changed");
    const rows=new Map(),claims=new Map(),groups={},path=location.pathname,project=ReaderRoutes.project(path);
    const add=(id,title,p)=>{
      const known=claims.get(id)||new Set();if(p)known.add(p);claims.set(id,known);
      rows.set(id,{id,title,group:known.size===1?"project:"+[...known][0]:"unknown"});
    };
    // A private chat's own header is also an explicitly visible discovery, not an account scan.
    const own=ReaderRoutes.chat(path);
    if(own)add(own,document.title.replace(/\s*[-|]\s*ChatGPT\s*$/,"").slice(0,512)||"ChatGPT",project);
    const anchors=[...document.querySelectorAll("nav a[href],aside a[href]"),
      ...(ReaderRoutes.projectHome(path)?[...document.querySelectorAll("main a[href]")].filter(a=>!a.closest("[data-message-id]")):[])];
    for(const a of anchors){
      const u=new URL(a.href,location.origin);if(u.origin!=="https://chatgpt.com")continue;
      const id=ReaderRoutes.chat(u.pathname);if(!id)continue;
      const p=ReaderRoutes.project(u.pathname);
      const title=(a.innerText||a.textContent||"").trim().slice(0,512);if(!title)continue;
      // Conflicting directory claims become unknown, never silently adopt one project.
      add(id,title,p);
    }
    for(const a of document.querySelectorAll("nav a[href],aside a[href]")){
      const u=new URL(a.href,location.origin),p=u.origin===location.origin&&ReaderRoutes.projectHome(u.pathname);
      const name=(a.innerText||a.textContent||"").trim()||a.getAttribute("aria-label")?.trim()||a.title?.trim(),group="project:"+p;
      if(!p||!name||name===p)continue;
      if(!Object.hasOwn(groups,group))groups[group]=name;
      else if(groups[group]!==name)groups[group]=null;
    }
    let owner=null;try{owner=await current();}catch{/* Directory remains browsable; capture stays gated. */}
    if(location.pathname!==path)throw Error("source-changed");
    return {rows:[...rows.values()],groups,scope:owner,nonce,path,complete:false,hint:project?"project:"+project:null};
  }
  chrome.runtime.onMessage.addListener((m,s,reply)=>{
    if(s.id!==chrome.runtime.id||s.tab||!["reader-batch-discover","reader-batch-check","reader-batch-capture"].includes(m?.kind))return;
    if(m.kind==="reader-batch-discover"){discover().then(reply,e=>reply({error:e.message}));return true;}
    const check=()=>{if(m.nonce!==nonce||m.path!==location.pathname||!privatePath())throw Error("source-changed");};
    const assert=async()=>{check();if(!m.scope||await current()!==m.scope)throw Error("source-changed");check();};
    if(m.kind==="reader-batch-check"){assert().then(()=>reply({current:true}),()=>reply({current:false}));return true;}
    if(busy()){reply({error:"source-busy"});return;}
    assert().then(()=>{
      if(!valid(m.id)||busy())throw Error("source-busy");
      // Reader target, device tokens and receipt contents are never exposed here.
      const batch={id:m.id,ticket:m.ticket,attempt:m.attempt,textOnly:m.textOnly,check,assert,
        validate:async session=>{if(await scope(session)!==m.scope)throw Error("source-changed");}};
      const work=capture(()=>{},false,batch);
      reply({started:true});
      work.catch(()=>chrome.runtime.sendMessage({kind:"batch-source-error",attempt:m.attempt,nonce}).catch(()=>{}));
    }).catch(e=>reply({error:e.message}));return true;
  });
};
