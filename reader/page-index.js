// Transient reading model. No extension storage, network requests, or writes to the transcript.
globalThis.ReaderPageIndex = (() => {
  const selector="[data-message-id]", idOf=el=>el?.dataset.messageId;
  const mounted=()=>[...document.querySelectorAll(selector)].filter(el=>
    ["user","assistant"].includes(el.dataset.messageAuthorRole)&&!el.closest('[hidden],[aria-hidden="true"]')&&el.getClientRects().length);
  const surface=el=>el.querySelector(".markdown,[data-message-content],.whitespace-pre-wrap")||el;
  const tidy=s=>(s||"").replace(/\s+/g," ").trim();
  const titles=el=>[...surface(el).querySelectorAll("h1,h2,h3,h4,h5,h6")];
  const fileName=el=>tidy(el.getAttribute("data-file-name")||el.getAttribute("download")||el.getAttribute("alt")||el.textContent);
  function fileNodes(el){
    const result=new Set();
    for(const n of el.querySelectorAll("a[download],a[href*='/files/'],a[href^='sandbox:'],[data-file-name],img[alt]")){
      const owner=n.closest("a[download],a[href*='/files/'],a[href^='sandbox:'],[data-file-name]")||n;
      if(fileName(owner)&&owner.getClientRects().length)result.add(owner);
    }
    return [...result];
  }
  const fileID=el=>el.getAttribute("data-file-id")||el.querySelector("[data-file-id]")?.getAttribute("data-file-id")||
    el.getAttribute("href")?.match(/(?:\/files\/|file-service:\/\/)([\w-]+)/)?.[1]||"";
  function files(items){
    const seen=new Map();
    return items.map(f=>{const row=typeof f==="string"?{name:f}:f,key=row.name;
      const occurrence=seen.get(key)||0;seen.set(key,occurrence+1);return {...row,occurrence};});
  }
  function domRows(){
    return mounted().map(el=>({id:idOf(el),role:el.dataset.messageAuthorRole,body:textMap(surface(el)).text,
      headings:titles(el).map(h=>({text:tidy(h.textContent),level:Number(h.tagName[1])})),
      files:files(fileNodes(el).map(n=>({name:fileName(n),id:fileID(n),type:n.tagName==="IMG"?"image":"file"})))}));
  }
  function headings(body){
    const result=[];let fence=null;
    const lines=body.split("\n");
    for(let i=0;i<lines.length;i++){const line=lines[i];
      const f=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if(f){if(!fence)fence=f[1];else if(f[1][0]===fence[0]&&f[1].length>=fence.length&&!f[2].trim())fence=null;continue;}
      const h=!fence&&/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      const setext=!fence&&!h&&line.trim()&&/^ {0,3}(=+|-+)\s*$/.exec(lines[i+1]||"");
      if(h||setext){const value=h?h[2]:line;
        result.push({level:h?h[1].length:setext[1][0]==="="?1:2,text:tidy(value.replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/[*_`]/g,""))});
        if(setext)i++;
      }
    }return result;
  }
  function fromBranch(data){
    return data.messages.map(m=>{
      const body=ReaderVisible(m,FastTextExporter).body||"";
      return {id:m.id,role:m.role,body,headings:headings(body),files:files([
        ...(m.images||[]).map(a=>({...a,type:"image"})),...(m.attachments||[]).map(a=>({...a,type:"file"})),
        ...(m.tables||[]).map(a=>({...a,type:"table"}))
      ].map(a=>({name:a.name||a.alt||a.title||a.fileId,id:a.fileId||"",type:a.type})).filter(a=>a.name))};
    });
  }
  // Small slices must own their bytes: a sliced preview can otherwise keep a
  // multi-megabyte V8 backing string alive after its message has been released.
  const copy=s=>Array.from(s||"").join("");
  const metadata=row=>({id:copy(row.id),role:row.role,title:copy((row.title??tidy(row.body)).slice(0,220)),
    headings:(row.headings||[]).map(h=>({level:h.level,text:copy(h.text)})),
    files:(row.files||[]).map(f=>typeof f==="string"?copy(f):{name:copy(f.name),id:copy(f.id),type:f.type,occurrence:f.occurrence})});
  function domBody(id){
    const el=mounted().find(n=>idOf(n)===id);if(!el)throw Error("The message is not mounted.");
    return textMap(surface(el)).text;
  }
  // Body bytes stay in the source provider. The navigation model retains only
  // lightweight metadata, a sparse cursor per 64 hits, and one page of snippets.
  async function search(rows,loadBody,query,{signal,index,page=0,onProgress=()=>{},onPage=()=>{}}={}){
    const size=64,cursors=index?.cursors||[],hits=[],cursor=index?.cursors[page],first=cursor?.row||0;
    let total=index?.total||0,scanned=0,nextYield=performance.now()+8;
    if(!query.trim())return {hits,total:0,cursors:[],page:0};
    if(index&&!cursor)return {hits,total,cursors,page};
    for(let i=first;i<rows.length;i++){
      signal?.throwIfAborted();const body=await loadBody(rows[i].id,signal);signal?.throwIfAborted();
      if(typeof body!=="string")throw Error("Message body unavailable.");
      for(const hit of matches(body,query)){
        if(index&&i===first&&hit.occurrence<cursor.occurrence)continue;
        if(!index){if(total%size===0)cursors.push({row:i,occurrence:hit.occurrence});total++;}
        if(hits.length<size){
          hits.push({id:rows[i].id,role:rows[i].role,occurrence:hit.occurrence,start:hit.start,end:hit.end,
            before:copy(body.slice(Math.max(0,hit.start-24),hit.start)),match:copy(body.slice(hit.start,Math.min(hit.end,hit.start+50))),
            after:copy(body.slice(hit.end,hit.end+24)),truncated:hit.end-hit.start>50});
          if(hits.length===1||hits.length%16===0)onPage([...hits]);
        }
        if(index&&hits.length===size)return {hits,total,cursors,page};
        if(!index&&total%1024===0){
          onProgress({scanned:i,rows:rows.length,matches:total});
          if(performance.now()>=nextYield){await new Promise(r=>setTimeout(r,0));nextYield=performance.now()+8;}signal?.throwIfAborted();
        }
      }
      scanned++;
      if(scanned%64===0){
        onProgress({scanned:i+1,rows:rows.length,matches:total});
        if(performance.now()>=nextYield){await new Promise(r=>setTimeout(r,0));nextYield=performance.now()+8;}
      }
    }
    onProgress({scanned:rows.length,rows:rows.length,matches:total});return {hits,total,cursors,page};
  }
  const leaf=()=>document.querySelector("[data-current-node-id]")?.getAttribute("data-current-node-id")||undefined;
  let revision=0,route="",slots=new Map(),contents=new Map(),marker;
  const generating=()=>!!document.querySelector('[data-testid="stop-button"],[data-talvt-turn-state="in_progress"]');
  let wasGenerating=false;
  function fingerprint(text){
    let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
    return `${text.length}:${hash}`;
  }
  function sample(){
    if(location.pathname!==route){slots.clear();contents.clear();marker=undefined;revision++;route=location.pathname;}
    const current=leaf();if(current&&marker&&current!==marker)revision++;if(current)marker=current;
    const active=generating();if(active&&!wasGenerating)revision++;wasGenerating=active;
    const messages=mounted(),positions=new Map();
    for(const el of messages){
      const id=idOf(el),turn=el.closest("[data-testid^='conversation-turn-']")?.dataset.testid;
      const key=turn&&turn+"/"+el.dataset.messageAuthorRole;
      if(key){const ids=positions.get(key)||[];ids.push(id);positions.set(key,ids);}
      const text=tidy(surface(el).textContent);
      if(text){const signature=fingerprint(text);
        if(contents.has(id)&&contents.get(id)!==signature)revision++;contents.set(id,signature);}
    }
    for(const [key,ids] of positions){
      if(ids.length!==1)continue;
      if(slots.has(key)&&slots.get(key)!==ids[0])revision++;
      slots.set(key,ids[0]);
    }
    if(contents.size>6000)contents.delete(contents.keys().next().value);
    if(slots.size>6000)slots.delete(slots.keys().next().value);
    return revision;
  }
  function scroller(el){
    for(let n=el?.parentElement;n;n=n.parentElement)
      if(n.scrollHeight>n.clientHeight+2&&/auto|scroll/.test(getComputedStyle(n).overflowY))return n;
    return document.scrollingElement;
  }
  function range(root){
    const r=root===document.scrollingElement?{top:0,bottom:innerHeight}:root.getBoundingClientRect();
    const composer=document.querySelector("#prompt-textarea,[data-testid='composer-text-input']");
    const bottom=composer?.getBoundingClientRect().top;
    return {top:Math.max(0,r.top)+12,bottom:Math.min(innerHeight,r.bottom,bottom>80?bottom:innerHeight)-12};
  }
  // Keep the literal UTF-16 offsets returned by RegExp; lowercasing a string can
  // change its length (e.g. dotted I), which would select the wrong DOM bytes.
  function* matches(text,query){
    const q=query.trim();if(!q)return;
    const pattern=q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");
    let occurrence=0;for(const m of text.matchAll(new RegExp(pattern,"giu")))
      yield {start:m.index,end:m.index+m[0].length,occurrence:occurrence++,text:m[0]};
  }
  function textMap(root){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),segments=[],parts=[];let at=0,block;
    for(let n=walker.nextNode();n;n=walker.nextNode()){
      const el=n.parentElement;
      if(!el||el.closest('script,style,button,textarea,[hidden],[aria-hidden="true"],.katex-mathml')||
        getComputedStyle(el).visibility==="hidden"||!el.getClientRects().length)continue;
      const next=el.closest("p,li,pre,td,th,h1,h2,h3,h4,h5,h6,blockquote,div")||root;
      if(block&&block!==next){parts.push("\n");at++;}block=next;
      segments.push({node:n,start:at,end:at+n.data.length});parts.push(n.data);at+=n.data.length;
    }
    return {text:parts.join(""),segments};
  }
  const context=s=>tidy(s.replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/[*_`#]/g,"")).toLowerCase();
  function textTarget(msg,row,target){
    const model=textMap(surface(msg)),hits=[...matches(model.text,target.query)],source=[...matches(row.body,target.query)];
    const expected=source[target.occurrence];if(!expected)return null;
    const before=context(row.body.slice(Math.max(0,expected.start-48),expected.start)).slice(-24);
    const after=context(row.body.slice(expected.end,expected.end+48)).slice(0,24);
    const compatible=h=>{
      const left=context(model.text.slice(Math.max(0,h.start-64),h.start)),right=context(model.text.slice(h.end,h.end+64));
      return (!before||left.endsWith(before))&&(!after||right.startsWith(after));
    };
    let hit=hits.length===source.length&&compatible(hits[target.occurrence])?hits[target.occurrence]:null;
    if(!hit){const candidates=hits.filter(compatible);if(candidates.length===1)hit=candidates[0];}
    if(!hit)return null;
    const first=model.segments.find(s=>s.start<=hit.start&&s.end>hit.start);
    const last=model.segments.find(s=>s.start<hit.end&&s.end>=hit.end);
    if(!first||!last)return null;
    const r=document.createRange();r.setStart(first.node,hit.start-first.start);r.setEnd(last.node,hit.end-last.start);
    return {range:r,node:first.node.parentElement};
  }
  function destination(msg,row,target){
    if(target.query){
      const match=textTarget(msg,row,target);
      return match?{...match,kind:"text",rect:()=>[...match.range.getClientRects()].find(r=>r.width&&r.height)||match.range.getBoundingClientRect()}:null;
    }
    let node=msg,kind="message";
    if(target.heading!==undefined){
      const h=row.headings[target.heading];if(!h)return null;
      const same=row.headings.slice(0,target.heading).filter(a=>a.text===h.text&&a.level===h.level).length;
      node=titles(msg).filter(el=>tidy(el.textContent)===h.text&&Number(el.tagName[1])===h.level)[same];
      kind="heading";if(!node)return null;
    }
    if(target.file!==undefined){
      const file=row.files[target.file];if(!file)return null;
      const known=typeof file==="string"?{name:file}:file,candidates=fileNodes(msg);
      const exact=known.id?candidates.filter(n=>fileID(n)===known.id):[];
      const named=candidates.filter(n=>fileName(n)===known.name);
      // A duplicate name is not proof of which file this is. Never pick the
      // first one by accident; a safe message-level fallback is labelled by UI.
      node=exact.length===1?exact[0]:named.length===1&&row.files.filter(f=>(f.name||f)===known.name).length===1?named[0]:msg;
      kind=node===msg?"message-fallback":"file";
    }
    return {node,kind,rect:()=>node.getBoundingClientRect()};
  }
  const pause=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  async function jump(rows,target,signal,report=()=>{},targetBody){
    const index=rows.findIndex(r=>r.id===target.id),path=location.pathname,version=sample(),order=new Map(rows.map((r,i)=>[r.id,i]));
    const fail=reason=>({ok:false,reason});
    if(index<0)return fail("missing");
    const known=mounted()[0];if(!known)return fail("unmounted");
    const root=scroller(known), until=performance.now()+12000;
    let previous=-1,stalls=0,probes=0,low=0,high=Infinity;
    while(performance.now()<until){
      signal.throwIfAborted();
      if(path!==location.pathname||sample()!==version)return fail("changed");
      const els=mounted(),msg=els.find(el=>idOf(el)===target.id);
      const view=range(root);
      if(msg){
        let stable=0,rectBefore;const settle=performance.now()+900;
        while(performance.now()<settle){
          signal.throwIfAborted();if(path!==location.pathname||sample()!==version)return fail("changed");
          const current=mounted().find(el=>idOf(el)===target.id);if(!current)break;
          const row=targetBody===undefined?rows[index]:{...rows[index],body:targetBody};
          const dest=destination(current,row,target);if(!dest)return fail("target");
          const v=range(root),r=dest.rect();if(!r||!r.width||!r.height)return fail("hidden");
          const delta=r.top-v.top,max=Math.max(0,root.scrollHeight-root.clientHeight);
          const next=Math.max(0,Math.min(max,root.scrollTop+delta));
          // The first/last real target can be visible without enough scroll
          // range for the reading inset. Verify it at the attainable boundary;
          // do not keep requesting a negative offset until the jump stalls.
          if(Math.abs(next-root.scrollTop)>1){
            root.scrollTo({top:next,behavior:"instant"});stable=0;
          }else if(rectBefore!==undefined&&Math.abs(r.top-rectBefore)<=1)stable++;else stable=0;
          rectBefore=r.top;await pause();
          const verified=dest.rect();
          if(stable>=3&&dest.node.isConnected&&idOf(dest.node.closest(selector))===target.id&&verified.bottom>v.top&&verified.top<v.bottom){
            signal.throwIfAborted();return {ok:true,kind:dest.kind,probes};
          }
        }
      }else{
        const top=root===document.scrollingElement?0:root.getBoundingClientRect().top;
        const anchors=els.map(el=>({index:order.get(idOf(el)),r:el.getBoundingClientRect()}))
          .filter(a=>a.index!==undefined&&a.r.height>0).sort((a,b)=>a.index-b.index);
        if(!anchors.length)return fail("unmounted");
        const visible=anchors.filter(a=>a.r.bottom>view.top&&a.r.top<view.bottom);
        // React may still be displaying the old window after a jump. Do not
        // derive new bounds from stale, entirely offscreen DOM.
        if(!visible.length){await pause();continue;}
        const max=Math.max(0,root.scrollHeight-root.clientHeight),first=anchors[0],last=anchors.at(-1);
        for(const a of anchors){
          const y=root.scrollTop+a.r.top-top;
          if(a.index<index)low=Math.max(low,Math.min(max,y+a.r.height));
          if(a.index>index)high=Math.min(high,Math.max(0,y));
        }
        const average=last.index>first.index?Math.abs(last.r.top-first.r.top)/(last.index-first.index):Math.max(80,first.r.height);
        let y=root.scrollTop+first.r.top-top+(index-first.index)*average;
        if(Number.isFinite(high)&&low<high)y=Math.max(low,Math.min(high,y));
        y=Math.max(0,Math.min(max,y));
        if(Math.abs(y-root.scrollTop)<2&&low<Math.min(high,max))y=(low+Math.min(high,max))/2;
        report({probes:++probes});root.scrollTo({top:y,behavior:"instant"});await pause();
      }
      if(Math.abs(root.scrollTop-previous)<1){if(++stalls>10)return fail("stalled");await new Promise(r=>setTimeout(r,60));}
      else stalls=0;previous=root.scrollTop;
    }return fail("timeout");
  }
  function visible(){
    const els=mounted();if(!els.length)return null;
    const line=range(scroller(els[0])).top;
    return idOf(els.find(el=>el.getBoundingClientRect().bottom>line));
  }
  function layout(){
    const viewport=globalThis.visualViewport,top=viewport?.offsetTop||0,height=viewport?.height||innerHeight,width=viewport?.width||innerWidth;
    const input=document.querySelector("#prompt-textarea,[data-testid='composer-text-input'],form [contenteditable=true]");
    const composer=input?.closest("form")||input,rect=composer?.getBoundingClientRect();
    const edge=rect?.height&&rect.top>top+44?Math.min(rect.top-12,top+height-8):top+height-8;
    const reading=mounted().find(n=>n.getBoundingClientRect().bottom>top)?.getBoundingClientRect();
    return {top,height,width,edge,composer,compact:width<760||!!reading&&reading.right>width-352,bottom:Math.max(76,innerHeight-edge)};
  }
  const layoutListeners=new Set();let layoutObserver,composer,scheduled=false;
  function observeLayout(listener){
    layoutListeners.add(listener);
    const update=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{
      scheduled=false;const state=layout();
      if(composer!==state.composer){if(composer)layoutObserver?.unobserve(composer);composer=state.composer;if(composer)layoutObserver?.observe(composer);}
      for(const notify of layoutListeners)notify(state);
    });};
    if(!layoutObserver&&typeof ResizeObserver!=="undefined"){
      layoutObserver=new ResizeObserver(update);layoutObserver.observe(document.documentElement);
      new MutationObserver(update).observe(document.documentElement,{childList:true,subtree:true});
      addEventListener("resize",update);globalThis.visualViewport?.addEventListener("resize",update);globalThis.visualViewport?.addEventListener("scroll",update);
    }
    listener(layout());update();return ()=>layoutListeners.delete(listener);
  }
  return {mounted,domRows,domBody,fromBranch,metadata,search,leaf,sample,visible,jump,matches,textTarget,destination,layout,observeLayout,generating};
})();
