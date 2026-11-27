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
  const ignoredBody='script,style,button,textarea,nav,form,.sr-only,.katex-mathml,[hidden],[inert],[aria-hidden=true],[data-conversation-role],[role=status],[role=progressbar],[role=toolbar]';
  const hasBox=node=>node&&[...node.getClientRects()].some(r=>r.width>0&&r.height>0);
  const painted=node=>source.visible(node)&&(!node.checkVisibility||node.checkVisibility({contentVisibilityAuto:true,visibilityProperty:true,opacityProperty:true}))&&hasBox(node);
  // Only a laid-out piece of answer content can certify readiness. The shell
  // remains usable as a scroll anchor even when its subtree hasn't been painted.
  function firstContent(el){
    if(source.pending(el))return null;
    const body=surface(el),walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT,{
      acceptNode(n){
        if(n.nodeType===1&&n.matches(ignoredBody))return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for(let n=walker.nextNode();n;n=walker.nextNode()){
      const text=n.nodeType===3,owner=text?n.parentElement:n;
      // An unlabelled spinner SVG/canvas is not evidence of an answer.
      // Text inside real diagrams and explicit file/image nodes still qualify.
      if(text?!/\S/.test(n.data):!n.matches("img[src],video[src],a[download],[data-file-name]"))continue;
      if(!owner.closest(ignoredBody)&&painted(owner))return {node:owner,text:text?n.data:"",textNode:text?n:null};
    }
    return null;
  }
  function domFiles(el){return files(fileNodes(el).map(n=>({name:fileName(n),id:fileID(n),type:n.tagName==="IMG"?"image":"file"})));}
  function domRows({light=false}={}){
    if(light){
      sample();const rows=[];
      for(const [id,el] of live){
        if(!el)continue;
        const role=source.roleOf(el),text=role==="user"?firstContent(el)?.text:"";
        rows.push({id,role,title:tidy(text?.slice(0,1024)).slice(0,220)});
      }
      return rows;
    }
    return mounted().map(el=>({id:idOf(el),role:source.roleOf(el),body:textMap(surface(el)).text,
      headings:titles(el).map(h=>({text:tidy(h.textContent),level:headingLevel(h)})),
      files:domFiles(el)}));
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
        if(chapterText(text))result.push({level:h?h[1].length:setext[1][0]==="="?1:2,text:copy(text)});
        if(setext)i++;
      }
    }return result;
  }
  function corroborate(m,body){
      // An explicit source read can corroborate a changed remount. Only exact
      // visible text clears uncertainty; Markdown/render differences wait.
      const el=live.get(m.id);
      if(el?.isConnected&&uncertain.has(el)&&firstContent(el)&&source.roleOf(el)===m.role){
        const text=tidy(textMap(surface(el)).text);
        let matches=text&&text===tidy(body);
        if(!matches&&text&&body.includes("#")){
          const sourceTitles=headings(body),nodes=titles(el);
          if(sourceTitles.length&&sourceTitles.length===nodes.length&&sourceTitles.every((h,i)=>h.text===tidy(nodes[i].textContent)&&h.level===headingLevel(nodes[i]))){
            // Strip only corroborated ATX markers, never arbitrary punctuation
            // from code or prose. The entire projected body must still agree.
            let i=0;
            const rendered=body.replace(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/gm,(line,marks,label)=>{
              const h=sourceTitles[i],title=tidy(label.replace(/[ \t]+#+[ \t]*$/,""));
              if(h?.text!==title||h.level!==marks.length)return line;
              i++;return title;
            });
            matches=i===sourceTitles.length&&tidy(rendered)===text;
          }
        }
        if(matches){contents.set(m.id,fingerprint(text));uncertain.delete(el);}
      }
  }
  function assetFiles(m){return files([
        ...(m.images||[]).map(a=>({...a,type:"image"})),...(m.attachments||[]).map(a=>({...a,type:"file"})),
        ...(m.tables||[]).map(a=>({...a,type:"table"}))
      ].map(a=>({name:a.name||a.alt||a.title||a.fileId,id:a.fileId||"",type:a.type})).filter(a=>a.name));}
  function fromBranch(data){
    return data.messages.map(m=>{
      const body=ReaderVisible(m,FastTextExporter).body||"";corroborate(m,body);
      return {id:m.id,role:m.role,body,headings:headings(body),files:assetFiles(m)};
    });
  }
  // Small slices must own their bytes: a sliced preview can otherwise keep a
  // multi-megabyte V8 backing string alive after its message has been released.
  const copy=s=>Array.from(s||"").join("");
  function sections(row){
    const stack=[],seen=new Map();
    const list=row.headings||[],conversation=/\/c\/([\w-]+)\/?$/.exec(location.pathname)?.[1];
    return list.map((h,index)=>{
      while(stack.length&&stack.at(-1).level>=h.level)stack.pop();
      const key=JSON.stringify([h.level,h.text]),occurrence=seen.get(key)||0;seen.set(key,occurrence+1);
      const chapter={text:h.text,level:h.level,occurrence,parents:stack.map(p=>p.text),
        ancestry:stack.map(p=>[p.level,p.text,p.occurrence]),before:list[index-1]?.text??null,after:list[index+1]?.text??null};
      const section={index,level:h.level,text:h.text,parent:stack.at(-1)?.index??null,occurrence,target:{id:row.id,heading:index,conversation,chapter}};
      stack.push(section);return section;
    });
  }
  function chapterIndex(list,chapter){
    if(!chapter)return -1;
    const path=JSON.stringify(chapter.ancestry);
    const matches=sections({headings:list}).filter(s=>s.text===chapter.text&&s.level===chapter.level&&JSON.stringify(s.target.chapter.ancestry)===path);
    if(matches.length===1&&matches[0].occurrence===chapter.occurrence)return matches[0].index;
    const candidate=matches.find(s=>s.occurrence===chapter.occurrence&&s.target.chapter.before===chapter.before&&s.target.chapter.after===chapter.after);
    return candidate?.index??-1;
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
  function localHeadings(row,api){
    sample();const el=live.get(row.id);
    if(!el||source.roleOf(el)!==row.role||uncertain.has(el)||!firstContent(el))return api;
    return mergeHeadings(api,titles(el).map(n=>({level:headingLevel(n),text:tidy(n.textContent)})));
  }
  function mountedFiles(id){
    sample();const el=live.get(id);
    return el&&!uncertain.has(el)&&!source.pending(el)?domFiles(el):[];
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
    sample();const el=live.get(id);
    if(!el||!firstContent(el)||uncertain.has(el))throw Error("The message is not uniquely mounted and ready.");
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
  const leaf=source.branchHint;
  const contents=new Map(),uncertain=new WeakSet();
  let revision=0,route="",live=new Map(),marker,unmatched="";
  const generating=source.generating;
  let wasGenerating=false;
  function fingerprint(text){
    let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
    return `${text.length}:${hash}`;
  }
  let observer,inventoryDirty=true,identityVersion=-1,inventory=[],scans=0,bodyChecks=0;
  let sourceCost,lastJump,jumpNumber=0,outcomes={},measurement;
  let hydrating=new WeakSet(),overflow=false;
  const dirty=new Set(),renderStamp=new WeakMap();
  const evidenceSelector=[source.identitySelector,source.roleSelector,source.timelineSelector,source.conversationSelector,source.unitSelector,
    "[data-turn-key],[data-current-node-id],[data-testid=stop-button],[data-talvt-turn-state],button[aria-label]"].join(",");
  function mutations(records){
    for(const r of records){
      const node=r.target.nodeType===1?r.target:r.target.parentElement,owner=node?.closest(source.identitySelector);
      const elements=[...r.addedNodes,...r.removedNodes].filter(n=>n.nodeType===1);
      if(elements.some(n=>n.matches(evidenceSelector)||n.querySelector(evidenceSelector)))inventoryDirty=true;
      if(r.type==="attributes"){
        if(!owner&&node?.querySelector(evidenceSelector)||node===owner||node.matches(source.roleSelector)||node.matches(evidenceSelector)||
            /^data-(message|conversation|chatgpt|current-node|talvt)|^aria-label$/.test(r.attributeName))inventoryDirty=true;
        if(owner)hydrating.add(owner);
      }
      for(let el=owner;el;el=el.parentElement?.closest(source.identitySelector)){
        dirty.add(el);renderStamp.set(el,(renderStamp.get(el)||0)+1);
        if(elements.length)hydrating.add(el);
      }
      if(dirty.size>256){dirty.clear();overflow=true;}
    }
  }
  function sample(force=false,targetId){
    if(!observer&&typeof MutationObserver==="function"){
      observer=new MutationObserver(mutations);
      observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,
        attributeFilter:["class","style","hidden","inert","open","aria-hidden","aria-busy","aria-label","data-message-id",
          "data-message-author-role","data-response-body","data-heading-level","aria-level","role","data-conversation-role",
          "data-chatgpt-search-message-ids","data-current-node-id","data-testid","data-talvt-turn-state","data-app-action-timeline-scroll",
          "data-thread-find-target","data-chatgpt-conversation-selection-target","data-turn-key","data-chatgpt-search-unit-key","data-content-search-unit-key"]});
    }
    if(observer)mutations(observer.takeRecords());
    if(location.pathname!==route){contents.clear();live.clear();dirty.clear();hydrating=new WeakSet();inventoryDirty=true;
      sourceCost=lastJump=null;outcomes={};
      marker=undefined;unmatched="";revision++;route=location.pathname;}
    if(overflow){force=true;overflow=false;}
    const refresh=force||inventoryDirty||!observer||source.identityVersion()!==identityVersion;
    if(!refresh&&!dirty.size)return revision;
    let next=live;
    if(refresh){
      inventory=mounted();scans++;next=new Map();
      for(const el of inventory){const id=idOf(el);next.set(id,next.has(id)?null:el);}
      const current=source.explicitLeaf();if(current&&marker&&current!==marker)revision++;if(current)marker=current;
      const active=generating();if(active&&!wasGenerating)revision++;wasGenerating=active;
      const unknown=source.outsideBranch();if(unknown&&unknown!==unmatched)revision++;unmatched=unknown;
      identityVersion=source.identityVersion();inventoryDirty=false;
    }
    const examine=(id,el)=>{
      if(!el)return;
      const owner=el.closest(source.identitySelector);
      if(live.get(id)===el&&!dirty.has(owner)&&(!force||targetId&&targetId!==id))return;
      const prior=contents.get(id);
      if(source.pending(el)){if(prior)uncertain.add(el);return;}
      const text=tidy(textMap(surface(el)).text);bodyChecks++;
      if(!text){if(prior)uncertain.add(el);return;}
      const signature=fingerprint(text);
      if(prior&&prior!==signature){
        if(live.get(id)!==el||uncertain.has(el)||hydrating.has(owner)){uncertain.add(el);return;}
        revision++;
      }
      contents.set(id,signature);uncertain.delete(el);
    };
    if(refresh){for(const [id,el] of next)examine(id,el);}
    else for(const owner of dirty){for(const id of source.candidates(owner)){
      const key=next.has(id)?id:idOf(owner);if(key)examine(key,next.get(key));
    }}
    live=next;dirty.clear();hydrating=new WeakSet();
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
      if(!el||el.closest(ignoredBody)||
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
  const chapterLayouts=new WeakMap();
  function chapterLayout(msg,expected,fresh){
    const stamp=renderStamp.get(msg.closest(source.identitySelector)),old=chapterLayouts.get(expected);
    if(!fresh&&old?.msg===msg&&old.stamp===stamp)return old;
    const key=h=>JSON.stringify([h.level,h.text]),groups=list=>{
      const map=new Map();list.forEach((h,i)=>{const k=key(h);if(!map.has(k))map.set(k,[]);map.get(k).push(i);});return map;};
    const nodes=titles(msg),actual=nodes.map(n=>({text:tidy(n.textContent),level:headingLevel(n)}));
    const a=groups(expected),b=groups(actual),ancestry=list=>sections({headings:list}).map(s=>JSON.stringify(s.target.chapter.ancestry));
    let expectedParents,actualParents;
    function match(i){
      const k=key(expected[i]),origins=a.get(k),rendered=b.get(k);
      if(!rendered||rendered.length!==origins.length)return null;
      const at=rendered[origins.indexOf(i)];
      if(origins.length>1){
        expectedParents??=ancestry(expected);actualParents??=ancestry(actual);
        if(expectedParents[i]!==actualParents[at])return null;
        // Shared, unique landmarks must stay on the same side of this
        // occurrence. Equal counts alone do not disambiguate reordered groups.
        for(const [label,list] of a){const other=b.get(label);
          if(list.length===1&&other?.length===1&&((list[0]<i)!==(other[0]<at)))return null;}
      }
      return nodes[at];
    }
    const layout={msg,stamp,nodes,expected:a,actual:b,key,match};chapterLayouts.set(expected,layout);return layout;
  }
  function destination(msg,row,target,{fuse=false}={}){
    if(target.query){
      const match=textTarget(msg,row,target);
      return match?{...match,kind:"text",rect:()=>[...match.range.getClientRects()].find(r=>r.width&&r.height)||match.range.getBoundingClientRect()}:null;
    }
    let node=msg,kind="message";
    if(target.heading!==undefined){
      if(target.chapter){
        if(target.conversation&&target.conversation!==/\/c\/([\w-]+)\/?$/.exec(location.pathname)?.[1])return null;
        const at=chapterIndex(row.headings,target.chapter);if(at<0)return null;
        target={...target,heading:at};
      }
      if(fuse){
        const requested=row.headings[target.heading];
        if(!requested)return null;
        // Hydration can add DOM-only chapters or refine a unique source title's
        // semantic level. Remap by identity, not the old numeric position.
        const merged=mergeHeadings(row.headings,titles(msg).map(n=>({text:tidy(n.textContent),level:headingLevel(n)})));
        if(merged!==row.headings){
          const before=row.headings.filter(h=>h.text===requested.text),after=merged.filter(h=>h.text===requested.text);
          if(before.length!==after.length)return null;
          const occurrence=row.headings.slice(0,target.heading).filter(h=>h.text===requested.text).length;
          const match=after[occurrence];
          if(!match||before.length>1&&match.level!==requested.level)return null;
          target={...target,heading:merged.indexOf(match)};row={...row,headings:merged};
        }
      }
      const h=row.headings[target.heading];if(!h)return null;
      const layout=chapterLayout(msg,row.headings,true),candidates=layout.actual.get(layout.key(h))||[];
      // If only one of two equal headings is currently mounted, its ordinal
      // is unknown. Wait for proof rather than choosing an unrelated heading.
      if(candidates.length!==layout.expected.get(layout.key(h)).length){
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
      node=layout.match(target.heading);
      kind="heading";if(!node)return null;
      if(target.chapter?.parents.length){
        const actual=sections({headings:layout.nodes.map(n=>({text:tidy(n.textContent),level:headingLevel(n)}))});
        if(JSON.stringify(actual[layout.nodes.indexOf(node)]?.target.chapter.ancestry)!==JSON.stringify(target.chapter.ancestry))return null;
      }
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
  function readingLine(view){
    const room=Math.max(0,view.bottom-view.top);
    // Leave a visible beginning plus context above the composer. Tall answers
    // expose their opening rather than aligning their offscreen bottom.
    const reserve=Math.min(room,Math.max(room*.25,Math.min(room*.4,96)));
    return view.bottom-reserve;
  }
  function startVisible(r,view){
    return inside(r,view)&&r.top>=view.top-13&&r.top<=view.bottom-Math.min(8,r.height);
  }
  function accurate(root,r,view){
    if(!startVisible(r,view))return false;
    // At the first/last scroll boundary only the reachable line is meaningful.
    const next=aligned(root,r.top,{...view,top:readingLine(view)});
    return Math.abs(next-root.scrollTop)<=2;
  }
  function exposed(msg,node,r,view){
    if(typeof document.elementFromPoint!=="function")return true; // Layout fixtures do not provide painting.
    const left=Math.max(view.left,r.left),right=Math.min(view.right,r.right),top=Math.max(view.top,r.top),bottom=Math.min(view.bottom,r.bottom);
    if(right<=left||bottom<=top)return false;
    const y=top+Math.min(8,(bottom-top)/2);
    const start=getComputedStyle(node).direction==="rtl"?right-Math.min(8,(right-left)/2):left+Math.min(8,(right-left)/2);
    return [start,(left+right)/2].some(x=>{
      const hit=document.elementFromPoint(x,y);
      return hit&&msg.contains(hit)&&(hit.contains(node)||node.contains(hit));
    });
  }
  function opening(content){
    const node=content.node,n=content.textNode,at=n?.data.search(/\S/);
    if(at>=0){
      const range=document.createRange();range.setStart(n,at);range.setEnd(n,at+1);
      if(range.getClientRects){
        return {node,range,rect:()=>[...range.getClientRects()].find(r=>r.width>0&&r.height>0)||range.getBoundingClientRect()};
      }
    }
    return {node,rect:()=>node.getBoundingClientRect()};
  }
  function inspectLanding(row){
    sample();const el=live.get(row.id);
    if(!el||uncertain.has(el)||source.roleOf(el)!==row.role)return null;
    const first=firstContent(el);if(!first)return null;
    const dest=opening(first),root=scroller(dest.node);if(!root)return null;
    const view=range(root),r=dest.rect();
    return {node:dest.node,top:r.top,visibleStart:startVisible(r,view)&&exposed(el,dest.node,r,view),error:r.top-readingLine(view)};
  }
  function inspectTarget(row){
    sample();const scope=source.scopeInfo(),msg=live.get(row.id);
    if(!scope)return {state:"no-active-timeline"};
    const other=source.preparationShells(row.id,row.role,row.alias).filter(n=>!msg||!msg.contains(n)&&!n.contains(msg));
    if(live.has(row.id)&&!msg||other.length>(msg?0:1))return {state:"ambiguous"};
    if(!msg&&!other.length)return {state:"no-identified-mount"};
    const node=msg||other[0],root=scroller(node),box=node.getBoundingClientRect(),body=msg&&surface(msg);
    const skipped=getComputedStyle(node).contentVisibility==="hidden"||body?.checkVisibility&&
      !body.checkVisibility({contentVisibilityAuto:true,visibilityProperty:true,opacityProperty:true});
    const ready=msg&&!uncertain.has(msg)&&firstContent(msg);
    return {state:skipped?"css-skipped":!msg?"shell-only":uncertain.has(msg)?"awaiting-corroboration":ready?"body-ready":
      node.matches('[aria-busy=true]')||node.querySelector('[aria-busy=true]')?"loading":"body-or-layout-pending",
      scrollport:root===scope.root?"timeline":root===document.scrollingElement?"document":"nested",
      shellHeight:Math.round(box.height),bodyHeight:body?Math.round(body.getBoundingClientRect().height):null};
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
  async function jump(rows,target,signal,report=()=>{},targetBody,options={}){
    clearFocus();
    signal?.throwIfAborted();
    const started=performance.now(),initialScans=scans,initialChecks=bodyChecks;
    const path=location.pathname,version=options.version??sample(),order=options.order||new Map(rows.map((r,i)=>[r.id,i])),index=order.get(target.id);
    const run=++jumpNumber;let firstShell,firstReady,nativeStatus="unused",strategy="dom",lineError,rebound=0;
    function record(outcome){
      const end=performance.now(),metrics={elapsedMs:end-started,historyMs:(firstShell??end)-started,
        bodyWaitMs:firstShell===undefined?0:(firstReady??end)-firstShell,landingMs:firstReady===undefined?0:end-firstReady,
        inventoryScans:scans-initialScans,bodyChecks:bodyChecks-initialChecks,strategy,nativeStatus,lineErrorPx:lineError,corrections:rebound};
      const observation={target:target.query?"search":target.file!==undefined?"file":target.heading!==undefined?"chapter":"message",outcome,...metrics};
      measurement?.(observation);
      if(path===location.pathname){outcomes[outcome]=(outcomes[outcome]||0)+1;if(run===jumpNumber)lastJump=observation;}
      return metrics;
    }
    const fail=reason=>({ok:false,reason,metrics:record(reason)});
    if(index===undefined)return fail("missing");
    if(order.size!==rows.length)return fail("target");
    const row={...rows[index],...options.detail,...(targetBody===undefined?{}:{body:targetBody})},now=performance.now(),hardEnd=now+45000;
    if(target.conversation&&target.conversation!==/\/c\/([\w-]+)\/?$/.exec(path)?.[1])return fail("changed");
    if(target.chapter){const ordinal=chapterIndex(row.headings||[],target.chapter);if(ordinal<0)return fail("target");target={...target,heading:ordinal};}
    if(target.heading!==undefined&&!row.headings?.[target.heading]||target.file!==undefined&&!row.files?.[target.file])return fail("target");
    let until=now+12000,best=Infinity,advances=0,lastProbe;
    let root,shape="",probes=0,low=0,high=Infinity,stable=0,previous,lastReason="unmounted",interrupted=false;
    let wake,expired=false,finished=false;
    const proofCtl=new AbortController();
    const notify=()=>{if(signal?.aborted)proofCtl.abort(signal.reason);wake?.();};
    const input=e=>{
      // Native scroll events also result from our own writes; only trusted
      // user intent cancels. The initiating button event has already run.
      if(e.isTrusted&&(!e.key||["PageUp","PageDown","Home","End","ArrowUp","ArrowDown"," "].includes(e.key))){
        interrupted=true;proofCtl.abort();notify();
      }
    };
    const events=["wheel","touchstart","pointerdown","keydown"];
    const check=()=>{signal?.throwIfAborted();if(interrupted||run!==jumpNumber)throw new DOMException("Navigation cancelled","AbortError");};
    const changed=force=>path!==location.pathname||sample(force,target.id)!==version||!!unmatched||wasGenerating;
    const pause=()=>new Promise(resolve=>{
      let frame;
      const done=()=>{if(wake!==done)return;wake=undefined;cancelAnimationFrame(frame);resolve();};
      wake=done;frame=requestAnimationFrame(()=>{if(wake===done)frame=requestAnimationFrame(done);});
    });
    for(const event of events)document.addEventListener(event,input,{capture:true,passive:true});
    signal?.addEventListener("abort",notify,{once:true});
    const expire=()=>{expired=true;proofCtl.abort();notify();};
    let deadline=setTimeout(expire,12000);
    function advance(){
      until=Math.min(hardEnd,performance.now()+12000);clearTimeout(deadline);
      deadline=setTimeout(expire,Math.max(0,until-performance.now()));
    }
    let cached,stage=0,known=[],knownScan=-1,shells=[],shellScan=-1,checkedShell,proof,readingProof=false;
    let watched,layoutWatch,bodyWatch,nativeTried=false,nativeWait=0,probeAnchor,lastGeometry;
    function watchBody(node){
      if(node===watched)return;
      watched=node;layoutWatch?.disconnect();bodyWatch?.disconnect();
      if(!node)return;
      const refresh=()=>{cached=null;notify();};
      if(typeof ResizeObserver==="function"){layoutWatch=new ResizeObserver(refresh);layoutWatch.observe(node);}
      bodyWatch=new MutationObserver(refresh);bodyWatch.observe(node,{childList:true,subtree:true,characterData:true,attributes:true});
    }
    function shellsFor(msg,fresh=false){
      if(fresh||shellScan!==scans){shells=source.preparationShells(target.id,row.role,row.alias);shellScan=scans;}
      return shells.filter(el=>!msg||el!==msg&&!el.contains(msg)&&!msg.contains(el));
    }
    function resolve(msg,fresh=false){
      const stamp=renderStamp.get(msg.closest(source.identitySelector)),time=performance.now();
      if(uncertain.has(msg)){
        if(typeof row.body==="string"&&(msg!==proof?.msg||stamp!==proof.stamp||fresh)){
          proof={msg,stamp};corroborate(row,row.body);
        }else if(row.body===undefined&&options.loadBody&&!readingProof){
          readingProof=true;
          options.loadBody(row.id,proofCtl.signal).then(body=>{if(!finished&&!proofCtl.signal.aborted){row.body=body;cached=null;notify();}},()=>{});
        }
      }
      // Missing layout can change without a DOM mutation (e.g. skipped CSS
      // content). Probe it periodically and resolve afresh at certification.
      if(!fresh&&cached?.msg===msg&&cached.stamp===stamp&&(time-cached.time<cached.interval||
          cached.dest&&!["answer-fallback","message-fallback"].includes(cached.dest.kind)&&painted(cached.dest.node))&&
          (!cached.dest||msg.contains(cached.dest.node)&&(!cached.dest.range||
            msg.contains(cached.dest.range.startContainer)&&msg.contains(cached.dest.range.endContainer)))&&!uncertain.has(msg))return cached.dest;
      let dest=null;
      const content=!uncertain.has(msg)&&firstContent(msg);
      if(content){
        if(firstReady===undefined){firstReady=time;advance();}
        if(target.heading!==undefined||target.file!==undefined||target.query)dest=destination(msg,row,target,{fuse:true});
        else dest={kind:"message",...opening(content)};
        if(dest&&dest.kind==="message-fallback")dest={kind:dest.kind,...opening(content)};
        if(target.heading!==undefined&&dest&&(!painted(dest.node)||!(dest.rect().height>0)))dest=null;
        if(!dest&&target.heading!==undefined)dest={kind:"answer-fallback",...opening(content)};
        if(dest&&!dest.rect)dest.rect=()=>dest.node.getBoundingClientRect();
      }
      const interval=cached?.msg===msg&&cached.stamp===stamp?Math.min(1600,cached.interval*2):200;
      cached={msg,stamp,time,dest,interval};return dest;
    }
    function certify(current){
      check();if(!exposed(current.msg,current.dest.node,current.r,current.view))return null;
      if(changed(true)||live.get(target.id)!==current.msg||source.roleOf(current.msg)!==row.role||shellsFor(current.msg,true).length)return null;
      const dest=resolve(current.msg,true);
      if(!dest||!painted(dest.node)||!current.msg.contains(dest.node))return null;
      const root=scroller(dest.node),view=range(root),r=dest.rect();
      if(!accurate(root,r,view)||!exposed(current.msg,dest.node,r,view)||!sameLanding(current,{msg:current.msg,root,dest,r,view,offset:root.scrollTop}))return null;
      lineError=Math.round(r.top-readingLine(view));
      check();try{
        let highlight=r;
        if(dest.kind==="message"||dest.kind.endsWith("-fallback")){
          const block=dest.node.getBoundingClientRect();highlight={...r,top:r.top,bottom:Math.max(r.bottom,Math.min(block.bottom,r.top+80)),left:block.left,right:block.right};
        }
        focusLanding(current.msg,highlight,view,signal);
      }catch{clearFocus();}
      return {ok:true,kind:dest.kind,probes,metrics:record(dest.kind)};
    }
    try{
      while(!expired&&performance.now()<until){
        check();if(changed())return fail("changed");
        const found=live.has(target.id),msg=live.get(target.id);
        if(found&&(!msg||source.roleOf(msg)!==row.role)){previous=null;stable=0;lastReason="target";await pause();continue;}
        const other=shellsFor(msg);
        if(other.length>1||msg&&other.length){previous=null;stable=0;lastReason="target";await pause();continue;}
        const shell=other[0];
        watchBody(msg||shell);
        if(shell&&!msg&&source.visible(shell)&&firstContent(shell)&&checkedShell!==shell){
          // CSS may resume painting without an attribute/child-list mutation.
          // Only rebuild the identity inventory on this observed transition.
          checkedShell=shell;if(changed(true))return fail("changed");continue;
        }
        if((msg||shell)&&firstShell===undefined){firstShell=performance.now();advance();}
        if(!found&&!shell&&knownScan!==scans){known=inventory.filter(el=>rows[order.get(idOf(el))]?.role===source.roleOf(el));knownScan=scans;probeAnchor=null;}
        const dest=msg&&resolve(msg);
        if(options.nativeTrial&&!nativeTried&&dest)return fail("already-rendered");
        if(!dest&&!nativeTried&&options.nativePrepare){
          nativeTried=true;
          try{nativeStatus=await options.nativePrepare(target.id,proofCtl.signal,{trial:!!(options.nativeTrial||options.qualifyNative)});}
          catch{nativeStatus=proofCtl.signal.aborted?"cancelled":"unsupported";}
          check();if(changed())return fail("changed");if(expired||performance.now()>=until)break;
          if(nativeStatus==="requested"){strategy="native";nativeWait=performance.now()+650;await pause();continue;}
          if(options.nativeTrial)return fail("native-unavailable");
        }
        // E2 isolates native preparation. No geometric history or shell scroll
        // can contribute to a passing native experiment.
        if((options.nativeTrial||performance.now()<nativeWait)&&!dest){await pause();continue;}
        const views=new Map(),viewOf=root=>{if(!views.has(root))views.set(root,range(root));return views.get(root);};
        const anchor=dest?.node||msg||shell||(probeAnchor?.isConnected?probeAnchor:
          (probeAnchor=known.find(el=>inside(el.getBoundingClientRect(),viewOf(scroller(el))))||known[0]));
        const nextRoot=anchor&&scroller(anchor);
        if(!nextRoot?.isConnected){lastReason="unmounted";previous=null;stable=0;await pause();continue;}
        const view=viewOf(nextRoot),bounds=axis(nextRoot),nextShape=JSON.stringify([bounds.start,nextRoot.scrollHeight,nextRoot.clientHeight,view]);
        if(nextRoot!==root||nextShape!==shape){root=nextRoot;shape=nextShape;low=0;high=Infinity;previous=null;stable=0;lastProbe=null;}
        const reveal=outerAdjustment(root);
        if(reveal){check();reveal.root.scrollTo({top:reveal.top,behavior:"instant"});previous=null;stable=0;await pause();continue;}
        if(found||shell){
          const r=dest&&msg.contains(dest.node)&&painted(dest.node)&&dest.rect();
          if(!(r?.width>0&&r.height>0)){
            lastReason="body";previous=null;stable=0;
            const box=(msg||shell).getBoundingClientRect();
            if(box.width>0&&Number.isFinite(box.top)){
              const top=aligned(root,box.top,{...view,top:readingLine(view,box)},bounds);
              if(Math.abs(top-root.scrollTop)>1){check();strategy="shell";root.scrollTo({top,behavior:"instant"});}
            }
            await pause();continue;
          }
          lastReason="hidden";
          if(dest.kind!=="answer-fallback"&&stage===0){stage=1;advance();}
          const next=aligned(root,r.top,{...view,top:readingLine(view)},bounds);
          if(Math.abs(next-root.scrollTop)>1){
            if(previous)rebound++;
            check();root.scrollTo({top:next,behavior:"instant"});stable=0;previous=null;
          }else{
            // Dirty identity evidence invalidates cached nodes; the success
            // boundary also does a full lookup. Never certify geometry alone.
            const current={msg,root,dest,r,view,offset:root.scrollTop};
            stable=accurate(root,r,view)&&sameLanding(previous,current)?stable+1:0;
            previous=current;
            if(stable>=4&&dest.kind!=="answer-fallback"){
              const result=certify(current);if(result)return result;stable=0;previous=null;cached=null;
            }
          }
        }else{
          previous=null;stable=0;lastReason="unmounted";
          const since=performance.now();
          if(lastGeometry?.root===root&&lastGeometry.shape===shape&&lastGeometry.scan===knownScan&&
            Math.abs(lastGeometry.position-root.scrollTop)<1&&since-lastGeometry.time<280){await pause();continue;}
          lastGeometry={root,shape,scan:knownScan,position:root.scrollTop,time:since};
          const top=root===document.scrollingElement?0:root.getBoundingClientRect().top;
          const unique=new Set(),duplicate=new Set();for(const el of known){const id=idOf(el);if(unique.has(id))duplicate.add(id);unique.add(id);}
          const anchors=known.filter(el=>!duplicate.has(idOf(el))&&!source.pending(el)&&!uncertain.has(el)&&scroller(el)===root).map(el=>({index:order.get(idOf(el)),r:el.getBoundingClientRect()}))
            .filter(a=>a.r.width>0&&a.r.height>0).sort((a,b)=>a.index-b.index);
          // A delayed virtual window may still be entirely offscreen. Wait
          // within the same deadline; never infer bounds from stale DOM.
          let distance=Infinity;for(const a of anchors)if(inside(a.r,view))distance=Math.min(distance,Math.abs(a.index-index));
          if(!Number.isFinite(distance)){await pause();continue;}
          if(distance<best){
            if(Number.isFinite(best)){advances++;advance();}
            best=distance;
          }
          const max=bounds.extent,position=root.scrollTop-bounds.start,first=anchors[0],last=anchors.at(-1);
          for(const a of anchors){
            const y=position+a.r.top-top;
            if(a.index<index)low=Math.max(low,Math.min(max,y+a.r.height));
            if(a.index>index)high=Math.min(high,Math.max(0,y));
          }
          // Bisect bounds learned from identified rows. For the two real ends
          // request the corresponding edge, which can also trigger pagination.
          const ceiling=Math.min(max,high);
          let y=index===0?0:index===rows.length-1?max:(Math.min(low,ceiling)+ceiling)/2;
          const waitingEdge=index<first.index&&position<=1&&y<=1||index>last.index&&position>=max-1&&y>=max-1;
          if(!waitingEdge&&Math.abs(y-position)<2&&low<Math.min(high,max))y=(low+Math.min(high,max))/2;
          const key=[first.index,last.index,Math.round(position),Math.round(y)].join(":");
          if(key!==lastProbe){lastProbe=key;strategy="history";check();report({probes:++probes,advances});check();root.scrollTo({top:bounds.start+y,behavior:"instant"});}
        }
        await pause();
      }
      check();if(changed())return fail("changed");
      if(stable>=4&&previous?.dest.kind==="answer-fallback"){const result=certify(previous);if(result)return result;}
      return fail(lastReason);
    }catch(e){record(e.name==="AbortError"?"cancelled":"interrupted");throw e;}finally{
      finished=true;proofCtl.abort();bodyWatch?.disconnect();layoutWatch?.disconnect();
      clearTimeout(deadline);signal?.removeEventListener("abort",notify);
      for(const event of events)document.removeEventListener(event,input,true);
    }
  }
  function visible(){
    sample();let best=null,distance=Infinity;const views=new Map();
    const native=typeof document.elementFromPoint==="function"&&source.timeline();
    const root=native?.nodeType===1?native:inventory[0]&&scroller(inventory[0]);
    if(native&&root){
      const view=range(root),line=readingLine(view);
      views.set(root,view);
      for(const ratio of [.5,.35,.65]){
        const hit=document.elementFromPoint(view.left+(view.right-view.left)*ratio,line);
        if(!hit)continue;
        const marker=hit.closest(source.roleSelector+","+source.identitySelector),id=marker&&idOf(marker),el=id&&live.get(id);
        if(el&&!uncertain.has(el)&&el.contains(hit)&&surface(el).contains(hit)&&firstContent(el))return id;
      }
    }
    for(const [id,el] of live){
      if(!el||uncertain.has(el))continue;
      const r=el.getBoundingClientRect(),root=scroller(el);if(!root)continue;
      if(!views.has(root))views.set(root,range(root));const view=views.get(root);
      if(!inside(r,view))continue;
      const body=surface(el).getBoundingClientRect(),line=readingLine(view);
      if(!inside(body,view))continue;
      const d=Math.max(body.top-line,line-body.bottom,0);
      if(d<distance&&firstContent(el)){distance=d;best=id;if(d===0)break;}
    }
    return best;
  }
  function currentSection(row,visibleId){
    if(!row)return null;sample();
    const msg=live.get(row.id),target={id:row.id};
    if(!msg||source.roleOf(msg)!==row.role)return null;
    if(uncertain.has(msg))return inside(msg.getBoundingClientRect(),range(scroller(msg)))?target:null;
    if((visibleId??visible())!==row.id)return null;
    if(source.pending(msg))return target;
    if(!row.headings?.length)return target;
    const layout=chapterLayout(msg,row.headings,false),view=range(scroller(msg)),heading=layout.nodes.filter(el=>{
      const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<=readingLine(view)+1;
    }).at(-1);
    if(!heading)return target;
    const text=tidy(heading.textContent),level=headingLevel(heading);
    for(let index=0;index<(row.headings||[]).length;index++){
      const h=row.headings[index];
      if(h.text===text&&h.level===level&&layout.match(index)===heading)return {...target,heading:index};
    }
    return target;
  }
  function layout(){
    const viewport=globalThis.visualViewport,top=viewport?.offsetTop||0,height=viewport?.height||innerHeight,width=viewport?.width||innerWidth;
    const input=source.composer();
    const composer=input?.closest("form")||input,rect=composer?.getBoundingClientRect();
    const edge=rect?.height&&rect.top>top+44?Math.min(rect.top-12,top+height-8):top+height-8;
    // Only the column width is used for panel placement. No identity or body
    // enumeration is needed when the composer or viewport resizes.
    const reading=(inventory.find(n=>n.isConnected)||document.querySelector(source.identitySelector))?.getBoundingClientRect();
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
  function renderState(id){sample();const node=live.get(id);
    return {node,version:node?renderStamp.get(node.closest(source.identitySelector))||0:0};}
  // Available in the extension's isolated DevTools context for manual timing.
  // Counters stay in memory and contain no targets, text, URLs or credentials.
  return {mounted,idOf,domRows,domBody,mountedFiles,fromBranch,corroborate,headings,assetFiles,localHeadings,renderState,metadata,mergeMounted,sections,chapterIndex,tree,search,leaf,sample,revision:()=>revision,visible,currentSection,jump,inspectLanding,inspectTarget,clearFocus,matches,textTarget,destination,layout,observeLayout,generating,
    measure:listener=>{measurement=listener;},recordSource:cost=>{sourceCost=cost;},
    metrics:()=>({source:{...sourceCost},outcomes:{...outcomes},last:lastJump?{...lastJump}:null})};
})();
