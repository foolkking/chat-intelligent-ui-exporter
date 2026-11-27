// Transient reading model. No extension storage, network requests, or writes to the transcript.
globalThis.ReaderPageIndex = (() => {
  const source=globalThis.ChatExportSourceDOM, idOf=source.idOf;
  const mounted=source.mounted, surface=source.surface;
  const tidy=s=>(s||"").replace(/\s+/g," ").trim();
  const headingSelector="h1,h2,h3,h4,h5,h6,[role=heading],[data-heading-level]";
  const headingChrome=".sr-only,pre,code,button,nav,form,table,figure,figcaption,summary,[role=dialog],[role=toolbar],[role=menu],[role=tablist],[role=button],[role=tooltip],[data-conversation-role]";
  // HTML heading tags also style statistic cards. A standalone measurement is
  // not a chapter; numbering followed by meaningful prose remains eligible.
  const statistic=/^[+\-−~≈<>≤≥]?\s*[$€£¥]?\s*\d+(?:[.,，\s]\d+)*(?:\s*(?:%|‰|[KMGTPE]?i?B|bytes?|[kMGT]?Hz|ms|[μµu]?s|min|h|[kcmµμ]?m(?:[²³]|\/s)?|[kmgµμ]+|[kM]?W|[kM]?J|°[CF]?|个|次|条|轮|项|秒|分钟|小时|天|万|亿|千|百))?$/iu;
  const chapterText=text=>!!text&&!statistic.test(text);
  function headingLevel(el){
    if(/^H[1-6]$/.test(el.tagName))return Number(el.tagName[1]);
    const level=el.getAttribute("data-heading-level")??(el.getAttribute("role")==="heading"?(el.getAttribute("aria-level")??"2"):null);
    return /^[1-6]$/.test(level||"")?Number(level):0;
  }
  // Explicit heading semantics are structural evidence; ordinary bold text and
  // screen-reader conversation-role labels are not answer chapters.
  const titles=el=>[...surface(el).querySelectorAll(headingSelector)]
    .filter(n=>headingLevel(n)&&!n.closest(headingChrome)&&source.visible(n)&&
      !n.querySelector(headingSelector)&&chapterText(tidy(n.textContent))&&n.getClientRects().length);
  const fileName=el=>tidy(el.getAttribute("data-file-name")||el.getAttribute("download")||el.getAttribute("alt")||el.textContent);
  function fileNodes(el){
    const result=new Set();
    for(const n of el.querySelectorAll("a[download],a[href*='/files/'],a[href^='sandbox:'],[data-file-name],img[alt]")){
      const owner=n.closest("a[download],a[href*='/files/'],a[href^='sandbox:'],[data-file-name]")||n;
      if(fileName(owner)&&source.visible(owner)&&owner.getClientRects().length)result.add(owner);
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
    return mounted().map(el=>({id:idOf(el),role:source.roleOf(el),body:textMap(surface(el)).text,
      headings:titles(el).map(h=>({text:tidy(h.textContent),level:headingLevel(h)})),
      files:files(fileNodes(el).map(n=>({name:fileName(n),id:fileID(n),type:n.tagName==="IMG"?"image":"file"})))}));
  }
  function headings(body){
    const result=[];let fence=null;
    const lines=body.split("\n");
    for(let i=0;i<lines.length;i++){const line=lines[i];
      const f=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if(f){if(!fence)fence=f[1];else if(f[1][0]===fence[0]&&f[1].length>=fence.length&&!f[2].trim())fence=null;continue;}
      const h=!fence&&/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
      const setext=!fence&&!h&&line.trim()&&/^ {0,3}(=+|-+)\s*$/.exec(lines[i+1]||"");
      if(h||setext){const value=h?h[2].replace(/[ \t]+#+[ \t]*$/,""):line;
        const text=tidy(value.replace(/\[([^\]]+)\]\([^)]*\)/g,"$1")
          .replace(/(`+)(.+?)\1|(\*{1,3})(\S(?:.*?\S)?)\3|(?<![\p{L}\p{N}_])(_{1,3})(\S(?:.*?\S)?)\5(?![\p{L}\p{N}_])/gu,
            (_all,_ticks,code,_stars,emphasis,_underscores,word)=>code??emphasis??word));
        if(chapterText(text))result.push({level:h?h[1].length:setext[1][0]==="="?1:2,text});
        if(setext)i++;
      }
    }return result;
  }
  function fromBranch(data){
    return data.messages.map(m=>{
      const body=ReaderVisible(m,FastTextExporter).body||"";
      // An explicit source read can corroborate a changed remount. Only exact
      // visible text clears uncertainty; Markdown/render differences wait.
      const el=live.get(m.id);
      if(el?.isConnected&&uncertain.has(el)&&!source.pending(el)&&source.roleOf(el)===m.role){
        const text=tidy(textMap(surface(el)).text);
        if(text&&text===tidy(body)){contents.set(m.id,fingerprint(text));uncertain.delete(el);}
      }
      return {id:m.id,role:m.role,body,headings:headings(body),files:files([
        ...(m.images||[]).map(a=>({...a,type:"image"})),...(m.attachments||[]).map(a=>({...a,type:"file"})),
        ...(m.tables||[]).map(a=>({...a,type:"table"}))
      ].map(a=>({name:a.name||a.alt||a.title||a.fileId,id:a.fileId||"",type:a.type})).filter(a=>a.name))};
    });
  }
  // Small slices must own their bytes: a sliced preview can otherwise keep a
  // multi-megabyte V8 backing string alive after its message has been released.
  const copy=s=>Array.from(s||"").join("");
  function sections(row){
    const stack=[],seen=new Map();
    return (row.headings||[]).map((h,index)=>{
      while(stack.length&&stack.at(-1).level>=h.level)stack.pop();
      const key=JSON.stringify([h.level,h.text]),occurrence=seen.get(key)||0;seen.set(key,occurrence+1);
      const section={index,level:h.level,text:h.text,parent:stack.at(-1)?.index??null,occurrence,target:{id:row.id,heading:index}};
      stack.push(section);return section;
    });
  }
  function metadata(row){
    const entry={id:copy(row.id),role:row.role,title:copy((row.title??tidy(row.body)).slice(0,220)),
      headings:(row.headings||[]).map(h=>({level:h.level,text:copy(h.text)})),
      files:(row.files||[]).map(f=>typeof f==="string"?copy(f):{name:copy(f.name),id:copy(f.id),type:f.type,occurrence:f.occurrence})};
    entry.sections=sections(entry);return entry;
  }
  // Anchor DOM-only chapters against shared titles in document order. Ambiguous duplicate
  // counts or contradictory ordering must not renumber two indistinguishable chapters.
  function mergeHeadings(api,dom){
    const byText=list=>{const map=new Map();list.forEach((h,i)=>{let a=map.get(h.text);if(!a)map.set(h.text,a=[]);a.push(i);});return map;};
    const a=byText(api),b=byText(dom),occ=new Map(),result=[];let next=0,pending=[];
    for(const h of dom){
      const indices=a.get(h.text);
      if(!indices){pending.push(h);continue;}
      const at=occ.get(h.text)||0;occ.set(h.text,at+1);
      if(indices.length!==b.get(h.text).length)continue;
      const i=indices[at];if(i<next||indices.length>1&&api[i].level!==h.level)return api;
      while(next<i)result.push(api[next++]);
      for(const extra of pending)result.push(extra);pending=[];
      result.push(h);next=i+1;
    }
    while(next<api.length)result.push(api[next++]);
    for(const extra of pending)result.push(extra);
    return result.length===api.length&&result.every((h,i)=>h.level===api[i].level&&h.text===api[i].text)?api:result;
  }
  function mergeMounted(rows){
    const live=new Map();for(const el of mounted()){const id=idOf(el);live.set(id,live.has(id)?null:el);}
    let changed=false;const merged=rows.map(row=>{
      const el=live.get(row.id);if(!el||source.roleOf(el)!==row.role||source.pending(el)||uncertain.has(el))return row;
      const headings=mergeHeadings(row.headings,titles(el).map(n=>({level:headingLevel(n),text:tidy(n.textContent)})));
      if(headings===row.headings)return row;changed=true;return metadata({...row,headings});
    });return changed?merged:rows;
  }
  function tree(rows){
    const turns=[];
    for(const row of rows){
      const entry=metadata(row);
      if(row.role==="user"||!turns.length)turns.push({q:row.role==="user"?entry:null,answers:[]});
      if(row.role!=="user")turns.at(-1).answers.push(entry);
    }
    return turns;
  }
  function domBody(id){
    const matches=mounted().filter(n=>idOf(n)===id);
    if(matches.length!==1||source.pending(matches[0])||uncertain.has(matches[0]))throw Error("The message is not uniquely mounted and ready.");
    return textMap(surface(matches[0])).text;
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
  const leaf=source.branchHint;
  const contents=new Map(),uncertain=new WeakSet();
  let revision=0,route="",live=new Map(),marker,unmatched="";
  const generating=source.generating;
  let wasGenerating=false;
  function fingerprint(text){
    let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
    return `${text.length}:${hash}`;
  }
  function sample(messages=mounted()){
    if(location.pathname!==route){contents.clear();live.clear();marker=undefined;unmatched="";revision++;route=location.pathname;}
    const current=source.explicitLeaf();if(current&&marker&&current!==marker)revision++;if(current)marker=current;
    const active=generating();if(active&&!wasGenerating)revision++;wasGenerating=active;
    const unknown=source.outsideBranch();if(unknown&&unknown!==unmatched)revision++;unmatched=unknown;
    const next=new Map(),duplicates=new Set();
    for(const el of messages){const id=idOf(el);if(next.has(id))duplicates.add(id);next.set(id,el);}
    for(const [id,el] of next){
      // Explicit render-in-progress is not evidence of a source edit. Retain
      // the last settled signature and compare again when hydration finishes.
      if(duplicates.has(id)||source.pending(el)){
        if(contents.has(id)&&live.get(id)!==el)uncertain.add(el);
        continue;
      }
      const text=tidy(textMap(surface(el)).text),prior=contents.get(id);
      if(!text){if(prior)uncertain.add(el);continue;}
      const signature=fingerprint(text);
      if(prior&&prior!==signature){
        // React can replace a settled message with a partly hydrated copy.
        // The identity alone cannot prove either a branch edit or a landing.
        if(live.get(id)!==el||uncertain.has(el)){uncertain.add(el);continue;}
        revision++;
      }
      contents.set(id,signature);uncertain.delete(el);
    }
    live=next;
    while(contents.size>6000)contents.delete(contents.keys().next().value);
    return revision;
  }
  function scroller(el){
    for(let n=el?.parentElement;n;n=n.parentElement)
      if(n.scrollHeight>n.clientHeight+2&&/auto|scroll/.test(getComputedStyle(n).overflowY))return n;
    return document.scrollingElement;
  }
  function range(root){
    const viewport=globalThis.visualViewport,top=viewport?.offsetTop||0,left=viewport?.offsetLeft||0;
    const view={top,bottom:top+(viewport?.height||innerHeight),left,right:left+(viewport?.width||innerWidth)};
    for(let n=root;n&&n!==document.scrollingElement;n=n.parentElement){
      const style=getComputedStyle(n),r=n.getBoundingClientRect();
      if(n===root||/auto|scroll|hidden|clip/.test(style.overflowY)){view.top=Math.max(view.top,r.top);view.bottom=Math.min(view.bottom,r.bottom);}
      if(n===root||/auto|scroll|hidden|clip/.test(style.overflowX)){view.left=Math.max(view.left,r.left);view.right=Math.min(view.right,r.right);}
    }
    const composer=source.composer();
    const bottom=[composer,composer?.closest("form")].filter(Boolean).map(n=>n.getBoundingClientRect().top).filter(y=>y>view.top+80);
    return {...view,top:view.top+12,bottom:Math.min(view.bottom,...bottom)-12};
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
        !source.visible(el)||!el.getClientRects().length)continue;
      const next=el.closest("p,li,pre,td,th,h1,h2,h3,h4,h5,h6,blockquote,div")||root;
      if(block&&block!==next){parts.push("\n");at++;}block=next;
      segments.push({node:n,start:at,end:at+n.data.length});parts.push(n.data);at+=n.data.length;
    }
    return {text:parts.join(""),segments};
  }
  const context=s=>tidy(s.replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/[*_`#]/g,"")).toLowerCase();
  function textTarget(msg,row,target){
    if(typeof row.body!=="string")return null;
    const model=textMap(surface(msg)),hits=[...matches(model.text,target.query)],source=[...matches(row.body,target.query)];
    const expected=source[target.occurrence];if(!expected)return null;
    const compatible=(h,origin)=>{
      const before=context(row.body.slice(Math.max(0,origin.start-48),origin.start)).slice(-24);
      const after=context(row.body.slice(origin.end,origin.end+48)).slice(0,24);
      const left=context(model.text.slice(Math.max(0,h.start-64),h.start)),right=context(model.text.slice(h.end,h.end+64));
      return (!before||left.endsWith(before))&&(!after||right.startsWith(after));
    };
    let hit=hits.length===source.length&&compatible(hits[target.occurrence],expected)?hits[target.occurrence]:null;
    if(!hit){
      const candidates=hits.filter(h=>compatible(h,expected));
      if(candidates.length===1&&!source.some(origin=>origin!==expected&&compatible(candidates[0],origin)))hit=candidates[0];
    }
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
      const candidates=titles(msg).filter(el=>tidy(el.textContent)===h.text&&headingLevel(el)===h.level);
      // If only one of two equal headings is currently mounted, its ordinal
      // is unknown. Wait for proof rather than choosing an unrelated heading.
      if(candidates.length!==row.headings.filter(a=>a.text===h.text&&a.level===h.level).length){
        // Hydrated widgets can render a semantic API heading as an ordinary standalone
        // block. Require a unique source heading AND text occurrence, context on both
        // sides in this same message, and a whole visible block (not a mention).
        if(candidates.length||typeof row.body!=="string"||row.headings.filter(a=>a.text===h.text).length!==1||
          !headings(row.body).some(a=>a.level===h.level&&a.text===h.text))return null;
        const count=matches(row.body,h.text);if(count.next().done||!count.next().done)return null;
        const match=textTarget(msg,row,{query:h.text,occurrence:0});if(!match)return null;
        const block=match.node.closest("p,li,div,dt,figcaption");
        if(!block||!msg.contains(block)||tidy(block.textContent)!==h.text||
          !chapterText(h.text)||block.closest(`${headingSelector},${headingChrome}`)||block.querySelector(`${headingSelector},${headingChrome},[hidden],[aria-hidden=true]`)||
          !block.contains(match.range.endContainer))return null;
        const rendered=matches(textMap(surface(msg)).text,h.text);rendered.next();if(!rendered.next().done)return null;
        return {...match,kind:"heading-text",rect:()=>[...match.range.getClientRects()].find(r=>r.width&&r.height)||match.range.getBoundingClientRect()};
      }
      node=candidates[same];
      kind="heading";if(!node)return null;
    }
    if(target.file!==undefined){
      const file=row.files[target.file];if(!file)return null;
      const known=typeof file==="string"?{name:file}:file,candidates=fileNodes(msg);
      const exact=known.id?candidates.filter(n=>fileID(n)===known.id):[];
      const named=candidates.filter(n=>fileName(n)===known.name);
      // A duplicate name is not proof of which file this is. Never pick the
      // first one by accident; a safe message-level fallback is labelled by UI.
      const uniqueName=named.length===1&&(!known.id||!fileID(named[0]))&&row.files.filter(f=>(f.name||f)===known.name).length===1;
      node=exact.length===1?exact[0]:uniqueName?named[0]:msg;
      kind=node===msg?"message-fallback":"file";
    }
    return {node,kind,rect:()=>node.getBoundingClientRect()};
  }
  function inside(r,view){
    return r?.width>0&&r.height>0&&view.bottom>view.top&&view.right>view.left&&
      r.bottom>view.top&&r.top<view.bottom&&r.right>view.left&&r.left<view.right;
  }
  // Geometric top-to-bottom positions are monotone in both CSS layouts.
  // Only the browser's origin changes: a reverse flex scrollport is 0 at
  // its bottom, with negative scrollTop toward earlier content.
  function axis(root){
    const extent=Math.max(0,root.scrollHeight-root.clientHeight),s=getComputedStyle(root);
    const reversed=root!==document.scrollingElement&&["flex","inline-flex"].includes(s.display)&&s.flexDirection==="column-reverse";
    return {start:reversed?-extent:0,extent};
  }
  function aligned(root,top,view,{start,extent}=axis(root)){
    return Math.max(start,Math.min(start+extent,root.scrollTop+top-view.top));
  }
  function readingLine(view,r){
    const room=Math.max(0,view.bottom-view.top);
    // Leave a visible beginning plus context above the composer. Tall answers
    // expose their opening rather than aligning their offscreen bottom.
    const reserve=Math.min(room,Math.max(room*.25,Math.min(r.height,96)+16));
    return view.bottom-reserve;
  }
  let releaseFocus;
  function clearFocus(){releaseFocus?.();}
  function focusLanding(msg,r,view,signal){
    clearFocus();
    const top=Math.max(r.top,view.top),left=Math.max(r.left,view.left),bottom=Math.min(r.bottom,view.bottom,top+120),right=Math.min(r.right,view.right);
    if(bottom<=top||right<=left)return;
    const host=document.createElement("div");host.dataset.readerNavigationFocus="";
    host.setAttribute("aria-hidden","true");
    const shadow=host.attachShadow({mode:"closed"}),style=document.createElement("style"),mark=document.createElement("div");
    // Isolated decoration, not a wrapper/style/class on ChatGPT's transcript.
    style.textContent=`:host{all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:10009!important}
      div{position:absolute;box-sizing:border-box;border:2px solid #087a68;border-radius:5px;background:#087a6814;pointer-events:none}
      @media(prefers-color-scheme:dark){div{border-color:#94d9c4;background:#94d9c414}}`;
    Object.assign(mark.style,{top:top+"px",left:left+"px",width:(right-left)+"px",height:(bottom-top)+"px"});
    shadow.append(style,mark);
    let timer;const observer=new MutationObserver(()=>clear());
    const clear=()=>{
      clearTimeout(timer);observer.disconnect();host.remove();
      for(const name of ["scroll","resize","popstate","pagehide"])removeEventListener(name,clear,true);
      globalThis.visualViewport?.removeEventListener?.("resize",clear);
      globalThis.visualViewport?.removeEventListener?.("scroll",clear);
      signal?.removeEventListener("abort",clear);
      if(releaseFocus===clear)releaseFocus=null;
    };
    releaseFocus=clear;document.documentElement.append(host);observer.observe(msg,{subtree:true,childList:true,characterData:true,attributes:true});
    for(const name of ["scroll","resize","popstate","pagehide"])addEventListener(name,clear,{capture:true,passive:true});
    globalThis.visualViewport?.addEventListener?.("resize",clear);globalThis.visualViewport?.addEventListener?.("scroll",clear);
    signal?.addEventListener("abort",clear,{once:true});
    timer=setTimeout(clear,1800);
  }
  function outerAdjustment(root){
    const chain=[root];
    for(let n=root;n&&n!==document.scrollingElement;){
      n=scroller(n);if(n)chain.push(n);
    }
    // Expose the outermost clipped scrollport first. All coordinates and the
    // entire root chain are observed anew after each individual write.
    for(let i=chain.length-1;i>0;i--){
      const parent=chain[i],child=chain[i-1],view=range(parent),rect=child.getBoundingClientRect();
      if(rect.height>0&&!inside(rect,view)){
        const top=aligned(parent,rect.top,view);
        if(Math.abs(top-parent.scrollTop)>1)return {root:parent,top};
      }
    }
  }
  const sameRect=(a,b)=>["top","bottom","left","right"].every(k=>Math.abs(a[k]-b[k])<=1);
  function sameLanding(a,b){
    if(!a||a.msg!==b.msg||a.root!==b.root||a.dest.node!==b.dest.node||a.dest.kind!==b.dest.kind||
        !sameRect(a.r,b.r)||!sameRect(a.view,b.view)||Math.abs(a.offset-b.offset)>1)return false;
    const x=a.dest.range,y=b.dest.range;
    return !x&&!y||!!x&&!!y&&["startContainer","endContainer","startOffset","endOffset"].every(k=>x[k]===y[k]);
  }
  async function jump(rows,target,signal,report=()=>{},targetBody){
    clearFocus();
    signal?.throwIfAborted();
    const path=location.pathname,version=sample(),order=new Map(rows.map((r,i)=>[r.id,i])),index=order.get(target.id);
    const fail=reason=>({ok:false,reason});
    if(index===undefined)return fail("missing");
    if(order.size!==rows.length)return fail("target");
    const row=targetBody===undefined?rows[index]:{...rows[index],body:targetBody},now=performance.now(),hardEnd=now+45000;
    let until=now+12000,best=Infinity,advances=0,lastProbe;
    let root,shape="",probes=0,low=0,high=Infinity,stable=0,previous,lastReason="unmounted",interrupted=false;
    let wake,expired=false;
    const notify=()=>wake?.();
    const input=e=>{
      // Native scroll events also result from our own writes; only trusted
      // user intent cancels. The initiating button event has already run.
      if(e.isTrusted&&(!e.key||["PageUp","PageDown","Home","End","ArrowUp","ArrowDown"," "].includes(e.key))){
        interrupted=true;notify();
      }
    };
    const events=["wheel","touchstart","pointerdown","keydown"];
    const check=()=>{signal?.throwIfAborted();if(interrupted)throw new DOMException("Navigation cancelled","AbortError");};
    const changed=els=>path!==location.pathname||sample(els)!==version||!!unmatched||wasGenerating;
    const pause=()=>new Promise(resolve=>{
      let frame;
      const done=()=>{if(wake!==done)return;wake=undefined;cancelAnimationFrame(frame);resolve();};
      wake=done;frame=requestAnimationFrame(()=>{if(wake===done)frame=requestAnimationFrame(done);});
    });
    for(const event of events)document.addEventListener(event,input,{capture:true,passive:true});
    signal?.addEventListener("abort",notify,{once:true});
    const expire=()=>{expired=true;notify();};
    let deadline=setTimeout(expire,12000);
    try{
      while(!expired&&performance.now()<until){
        check();const els=mounted();if(changed(els))return fail("changed");
        const found=els.filter(el=>idOf(el)===target.id),msg=found.length===1?found[0]:null;
        const known=els.filter(el=>rows[order.get(idOf(el))]?.role===source.roleOf(el));
        const anchor=msg||known.find(el=>inside(el.getBoundingClientRect(),range(scroller(el))))||known[0];
        const nextRoot=anchor&&scroller(anchor);
        if(!nextRoot?.isConnected){lastReason="unmounted";previous=null;stable=0;await pause();continue;}
        const view=range(nextRoot),bounds=axis(nextRoot),nextShape=JSON.stringify([bounds.start,nextRoot.scrollHeight,nextRoot.clientHeight,view]);
        if(nextRoot!==root||nextShape!==shape){root=nextRoot;shape=nextShape;low=0;high=Infinity;previous=null;stable=0;lastProbe=null;}
        const reveal=outerAdjustment(root);
        if(reveal){check();reveal.root.scrollTo({top:reveal.top,behavior:"instant"});previous=null;stable=0;await pause();continue;}
        if(found.length){
          const ready=msg&&source.roleOf(msg)===row.role&&!source.pending(msg)&&!uncertain.has(msg);
          const dest=ready&&destination(msg,row,target);
          lastReason=dest?"hidden":"target";
          if(!dest||!msg.contains(dest.node)||!source.visible(dest.node)){previous=null;stable=0;await pause();continue;}
          const r=dest.rect();
          if(!(r?.width>0&&r.height>0)){previous=null;stable=0;await pause();continue;}
          const next=aligned(root,r.top,{...view,top:readingLine(view,r)},bounds);
          if(Math.abs(next-root.scrollTop)>1){
            check();root.scrollTo({top:next,behavior:"instant"});stable=0;previous=null;
          }else{
            // Every observation follows a fresh adapter lookup, including
            // after the final awaited frames. Never certify a retained node.
            const current={msg,root,dest,r,view,offset:root.scrollTop};
            stable=inside(r,view)&&sameLanding(previous,current)?stable+1:0;
            previous=current;
            if(stable>=4){
              check();
              try{focusLanding(msg,r,view,signal);}catch{clearFocus();} // Decoration cannot certify or invalidate a location.
              return {ok:true,kind:dest.kind,probes};
            }
          }
        }else{
          previous=null;stable=0;lastReason="unmounted";
          const top=root===document.scrollingElement?0:root.getBoundingClientRect().top;
          const unique=new Set(),duplicate=new Set();for(const el of known){const id=idOf(el);if(unique.has(id))duplicate.add(id);unique.add(id);}
          const anchors=known.filter(el=>!duplicate.has(idOf(el))&&!source.pending(el)&&!uncertain.has(el)&&scroller(el)===root).map(el=>({index:order.get(idOf(el)),r:el.getBoundingClientRect()}))
            .filter(a=>a.r.width>0&&a.r.height>0).sort((a,b)=>a.index-b.index);
          // A delayed virtual window may still be entirely offscreen. Wait
          // within the same deadline; never infer bounds from stale DOM.
          let distance=Infinity;for(const a of anchors)if(inside(a.r,view))distance=Math.min(distance,Math.abs(a.index-index));
          if(!Number.isFinite(distance)){await pause();continue;}
          if(distance<best){
            if(Number.isFinite(best)){advances++;until=Math.min(hardEnd,performance.now()+12000);
              clearTimeout(deadline);deadline=setTimeout(expire,Math.max(0,until-performance.now()));}
            best=distance;
          }
          const max=bounds.extent,position=root.scrollTop-bounds.start,first=anchors[0],last=anchors.at(-1);
          for(const a of anchors){
            const y=position+a.r.top-top;
            if(a.index<index)low=Math.max(low,Math.min(max,y+a.r.height));
            if(a.index>index)high=Math.min(high,Math.max(0,y));
          }
          const average=last.index>first.index?Math.abs(last.r.top-first.r.top)/(last.index-first.index):Math.max(80,first.r.height);
          let y=position+first.r.top-top+(index-first.index)*average;
          if(Number.isFinite(high)&&low<high)y=Math.max(low,Math.min(high,y));
          y=Math.max(0,Math.min(max,y));
          const waitingEdge=index<first.index&&position<=1&&y<=1||index>last.index&&position>=max-1&&y>=max-1;
          if(!waitingEdge&&Math.abs(y-position)<2&&low<Math.min(high,max))y=(low+Math.min(high,max))/2;
          const key=[first.index,last.index,Math.round(position),Math.round(y)].join(":");
          if(key!==lastProbe){lastProbe=key;check();report({probes:++probes,advances});check();root.scrollTo({top:bounds.start+y,behavior:"instant"});}
        }
        await pause();
      }
      check();if(changed(mounted()))return fail("changed");return fail(lastReason);
    }finally{
      clearTimeout(deadline);signal?.removeEventListener("abort",notify);
      for(const event of events)document.removeEventListener(event,input,true);
    }
  }
  function visible(){
    for(const el of mounted()){
      const r=el.getBoundingClientRect(),root=scroller(el);if(!root)continue;
      const view=range(root);
      if(inside(r,view))return idOf(el);
    }
    return null;
  }
  function currentSection(row){
    if(!row||visible()!==row.id)return null;
    const matches=mounted().filter(el=>idOf(el)===row.id);
    if(matches.length!==1||source.roleOf(matches[0])!==row.role)return null;
    const msg=matches[0],target={id:row.id};
    if(source.pending(msg)||uncertain.has(msg))return target;
    const view=range(scroller(msg)),heading=titles(msg).filter(el=>{
      const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<=view.top+1;
    }).at(-1);
    if(!heading)return target;
    const text=tidy(heading.textContent),level=headingLevel(heading);
    for(let index=0;index<(row.headings||[]).length;index++){
      const h=row.headings[index];
      if(h.text===text&&h.level===level&&destination(msg,row,{heading:index})?.node===heading)return {...target,heading:index};
    }
    return target;
  }
  function layout(){
    const viewport=globalThis.visualViewport,top=viewport?.offsetTop||0,height=viewport?.height||innerHeight,width=viewport?.width||innerWidth;
    const input=source.composer();
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
  return {mounted,idOf,domRows,domBody,fromBranch,metadata,mergeMounted,sections,tree,search,leaf,sample,revision:()=>revision,visible,currentSection,jump,clearFocus,matches,textTarget,destination,layout,observeLayout,generating};
})();
