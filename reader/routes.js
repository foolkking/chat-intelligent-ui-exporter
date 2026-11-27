globalThis.ReaderRoutes = (() => {
  function projectId(segment=""){
    // Project-home URLs can append a localized slug to the stable hex identifier.
    let decoded;try{decoded=decodeURIComponent(segment);}catch{return "";}
    const stable=/^(g-p-(?:[\da-f]{32}|[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}))(?:-[\p{L}\p{N}\p{M}_-]+)?$/iu.exec(decoded);
    return stable?.[1].toLowerCase() || (/^g-p-[\w-]{1,180}$/.test(segment)?segment:"");
  }
  function projectName(value,id=""){
    const name=typeof value==="string"?value.trim():"";
    const key=String(id||"").toLowerCase();
    if(!name||name.length>256||/[\u0000-\u001f]/.test(name)||name.toLowerCase()===key||name.toLowerCase()==="project:"+key||projectId(name)||
      /^(?:project:g-p-|\/g\/g-p-)|^(?:[\da-f]{32}|[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i.test(name))return "";
    return name;
  }
  const chat = path => {
    const match=/^\/(?:g\/([^/]+)\/)?c\/([\w-]{1,128})\/?$/.exec(path);
    return match&&(!match[1]||/^[\w-]+$/.test(match[1])||projectId(match[1]))?match[2]:"";
  };
  const projectHome = path => projectId(/^\/g\/([^/]+)(?:\/project)?\/?$/.exec(path)?.[1]);
  // A project chat carries a useful source hint, not proof of a complete directory.
  // Custom GPT URLs without the g-p- project prefix must not acquire membership.
  const project = path => projectHome(path) || (chat(path) && projectId(/^\/g\/([^/]+)\/c\//.exec(path)?.[1])) || "";
  const eligible = path => !!(chat(path) || projectHome(path) || path === "/" || /^\/w\/[\w-]+\/?$/.test(path));
  const bodySelector="[data-message-id],[data-chatgpt-search-message-ids],[data-message-author-role],[data-response-body],[data-turn-key],[data-thread-find-target=conversation],[data-testid^='conversation-turn-']";
  const directorySelector='nav,aside,[role=navigation],[role=tree],[data-testid=sidebar],header';
  const excluded=bodySelector+",[hidden],[inert],[aria-hidden=true],[role=dialog]";
  const groupKey=g=>typeof g==="string"&&/^project:[\w-]{1,184}$/.test(g);
  function directoryNode(n){
    return !!n&&!n.closest(excluded)&&(!globalThis.ChatExportSourceDOM||ChatExportSourceDOM.visible(n));
  }
  function routeOf(link,doc){
    try{const u=new URL(link.getAttribute("href"),doc.location.href);return u.origin===doc.location.origin?u.pathname:"";}catch{return "";}
  }
  function homeMetadata(root,url,id){
    const canonical=root.querySelector('link[rel~="canonical"]')?.getAttribute("href"),ogURL=root.querySelector('meta[property="og:url"]')?.content;
    const exact=href=>{try{const u=new URL(href,url);return u.origin===url.origin&&projectHome(u.pathname)===id;}catch{return false;}};
    if(!canonical||!exact(canonical)||ogURL&&!exact(ogURL))return "";
    const clean=s=>{
      const n=projectName((s||"").replace(/^ChatGPT\s+[-–—|]\s+|\s+[-–—|]\s+ChatGPT$/gi,"").trim(),id);
      return /^(?:ChatGPT|OpenAI|Project|Projects|Sign in|Log in|项目|登录)$/i.test(n)?"":n;
    };
    // Neither a URL slug nor a conversation's document.title is evidence.
    const title=clean(root.querySelector("title")?.textContent),explicit=clean(root.querySelector('meta[property="og:title"]')?.content);
    return title&&title===explicit?title:"";
  }
  function projectCatalogue(doc,path){
    const groups={},evidence={},links=[],home=projectHome(path);
    const claim=(id,value,source)=>{
      if(!id)return;
      const key="project:"+id,name=projectName(value,id);
      if(!name){evidence[key]||={source:"missing",confidence:"none"};return;}
      if(Object.hasOwn(groups,key)&&groups[key]!==name){
        groups[key]=null;evidence[key]={source:"conflict",confidence:"none"};return;
      }
      groups[key]=name;evidence[key]={source,confidence:"explicit"};
    };
    function label(node,id){
      const labelled=(node.getAttribute("aria-labelledby")||"").split(/\s+/).filter(Boolean).map(key=>doc.getElementById(key));
      const reference=labelled.length&&labelled.every(n=>n&&!n.closest(bodySelector))?labelled.map(n=>n.textContent).join(" "):"";
      // Buttons on expandable rows sometimes wrap the entire conversation list.
      const labels=[...node.querySelectorAll('[data-project-name],[data-testid=project-name],[data-testid=project-title],.truncate')]
        .filter(n=>n.closest("a,button,[role=button]")===node&&directoryNode(n));
      const values=new Set(labels.map(n=>projectName(n.getAttribute("data-project-name")||n.innerText||n.textContent,id)).filter(Boolean));
      const primary=values.size===1?[...values][0]:"";
      const plain=!node.querySelector("a,button,[role=menu],ul,ol")&&(node.innerText||node.textContent);
      const aria=node.getAttribute("aria-label")||"";
      return [node.getAttribute("data-project-name"),primary,reference,plain,/^(?:(?:open|expand|collapse) project|打开项目|展开项目|折叠项目)$/i.test(aria)?"":aria,node.title]
        .map(value=>projectName(typeof value==="string"?value.replace(/\s+/g," "):"",id)).find(Boolean);
    }
    claim(project(path),"","missing");
    const selector=directorySelector.split(",").map(s=>s+" a[href]").concat(home?["main a[href]"]:[]).join(",");
    for(const a of doc.querySelectorAll(selector)){
      if(!directoryNode(a))continue;
      const route=routeOf(a,doc),id=project(route);
      if(chat(route)){links.push(a);claim(id,"","missing");}
      else if(projectHome(route))claim(id,label(a,id),"project-link");
    }
    for(const node of doc.querySelectorAll("[data-project-id]")){
      if(!directoryNode(node))continue;
      const raw=node.getAttribute("data-project-id");
      const hex=/^(?:[\da-f]{32}|[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i.test(raw);
      const paired=hex?"g-p-"+raw.toLowerCase():"";
      const id=projectId(raw)||(paired&&Object.hasOwn(evidence,"project:"+paired)?paired:"");
      if(!id)continue;
      if(node.hasAttribute("data-project-name")||node.matches("button,[role=button]")&&(node.closest(directorySelector)||node.hasAttribute("aria-label")||node.hasAttribute("aria-labelledby"))){
        if(node.matches("a[href]")&&projectHome(routeOf(node,doc))!==id)continue;
        claim(id,label(node,id),"project-control");
      }
    }
    if(home){
      const headers=[...doc.querySelectorAll('main h1,main [role=heading][aria-level="1"]')].filter(directoryNode);
      // During route transitions a second heading can still belong to the old view.
      if(headers.length===1&&!doc.querySelector('main [data-thread-find-target=conversation]:not([hidden])'))
        claim(home,label(headers[0],home),"project-heading");
      const metadata=homeMetadata(doc,doc.location,home);if(metadata)claim(home,metadata,"project-metadata");
    }
    return {groups,evidence,complete:false,links};
  }
  // Only explicitly present catalogue keys can receive a cached label. A new
  // owner or an unverified owner cannot read another workspace's evidence.
  function projectNameCache(seed=[]){
    const entries=new Map(seed),ttl=12*3600*1000;
    function merge(scope,found,now=Date.now()){
      const groups={},evidence={},keys=new Set([...Object.keys(found.evidence||{}),...Object.keys(found.groups||{})]);
      for(const [key,entry] of entries)if(now-entry.at>=ttl)entries.delete(key);
      for(const key of keys){
        if(!groupKey(key))continue;
        const cacheKey=JSON.stringify([scope,key]),name=projectName(found.groups?.[key],key.slice(8));
        const proof=found.evidence?.[key],conflict=found.groups?.[key]===null||proof?.source==="conflict";
        const prior=scope&&entries.get(cacheKey);
        if(conflict||name){
          const at=Number.isFinite(proof?.at)?Math.min(proof.at,now):now;
          if(prior&&prior.at>at){
            groups[key]=prior.name;evidence[key]={source:prior.name?"workspace-cache":"conflict",confidence:prior.name?"cached":"none"};continue;
          }
          groups[key]=conflict?null:name;
          evidence[key]=conflict?{source:"conflict",confidence:"none"}:{source:proof?.source||"project-link",confidence:"explicit"};
          if(scope){entries.delete(cacheKey);entries.set(cacheKey,{name:groups[key],at});}
        }else if(prior){
          groups[key]=prior.name;evidence[key]={source:prior.name?"workspace-cache":"conflict",confidence:prior.name?"cached":"none"};
        }else evidence[key]={source:["missing","access","unavailable","size-limit","no-server-label","pending"].includes(proof?.source)?proof.source:"missing",confidence:"none"};
      }
      while(entries.size>2048)entries.delete(entries.keys().next().value);
      return {groups,evidence};
    }
    return {merge,entries:()=>[...entries]};
  }
  function projectReport({groups={},evidence={}}){
    const keys=new Set([...Object.keys(evidence),...Object.keys(groups)]);
    return {projects:[...keys].filter(groupKey).map((key,i)=>({n:i+1,named:!!projectName(groups[key],key.slice(8)),
      evidence:evidence[key]?.source||"missing"}))};
  }
  return {chat,project,projectHome,projectId,projectName,eligible,directorySelector,bodySelector,groupKey,homeMetadata,projectCatalogue,projectNameCache,projectReport};
})();
