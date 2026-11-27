globalThis.ReaderOverlay = ({read,busy}) => {
  const L=(zh,en)=>navigator.language.startsWith("zh")?zh:en;
  const host=document.createElement("div"),shadow=host.attachShadow({mode:"closed"});
  const make=(tag,cls="",text="")=>{const el=document.createElement(tag);el.className=cls;el.textContent=text;return el;};
  const button=(label,fn,cls="")=>{const el=make("button",cls,label);el.type="button";el.onclick=e=>{if(e.isTrusted)fn();};return el;};
  const icon=(name,label,fn)=>{const el=button("",fn,"icon");el.title=label;el.setAttribute("aria-label",label);el.append(ReaderGlyph(name));return el;};
  const style=make("style");style.textContent=`
    :host{all:initial;position:fixed;top:var(--reader-top,24vh);right:0;z-index:10010;font:14px/1.45 system-ui,"Microsoft YaHei",sans-serif;color:#25312b;
      --p:#faf9f6;--fg:#25312b;--sub:#566259;--line:#dcded7;--sel:#e7f1eb;--accent:#086b5b;color-scheme:light dark}
    @media(prefers-color-scheme:dark){:host{--p:#282b27;--fg:#f1f2e9;--sub:#bdc6bd;--line:#454b43;--sel:#34463e;--accent:#9ce1c8}}
    *,*::before{box-sizing:border-box}[hidden]{display:none!important}button,input{font:inherit;color:var(--fg)}
    button{border:0;background:transparent;cursor:pointer;min-height:44px;border-radius:5px}button:hover,button[aria-pressed=true],
    .active{background:var(--sel);color:var(--accent)}:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
    .handle{width:24px;height:54px;position:absolute;right:0;top:0;background:transparent;display:grid;place-items:center;touch-action:none;user-select:none;cursor:grab}
    .handle:active{cursor:grabbing}.handle[data-launcher-position]{position:fixed;inset:var(--launcher-y) auto auto var(--launcher-x)}
    .handle:before{content:"";width:7px;height:36px;border-radius:6px 0 0 6px;background:var(--accent);justify-self:end}
    .handle:hover:before,.handle:focus-visible:before{width:12px}.handle:after{content:"";position:absolute;inset:0 -1px 0 -20px}
    .frame{position:absolute;right:8px;top:0;width:min(360px,calc(100vw - 16px));height:min(680px,var(--reader-room,80dvh));
      display:flex;flex-direction:column;border:1px solid var(--line);border-radius:10px;background:var(--p);color:var(--fg);
      box-shadow:0 3px 16px #1328191c;overflow:hidden}
    header,.modes,nav,.find{display:flex;align-items:center;gap:3px;padding:3px 8px}header{border-bottom:1px solid var(--line)}
    header strong{display:flex;align-items:center;gap:8px;flex:1;font-size:16px}.modes{min-width:0;padding:0 8px;border-bottom:1px solid var(--line);flex-shrink:0}.modes button{font-weight:600;white-space:normal;line-height:1.25;padding:4px 10px}.icon{display:grid;place-items:center;min-width:44px}
    .frame[data-wide=true]{width:min(820px,calc(100vw - 16px))}.save-slot{width:100%;min-width:0}
    svg{width:17px;height:17px;fill:none}.work{min-height:0;flex:1;display:flex;flex-direction:column}
    nav{border-bottom:1px solid var(--line)}nav .icon{margin-inline-start:auto}.find input{min-width:0;flex:1;padding:7px 9px;background:var(--p);border:1px solid var(--line);border-radius:6px}
    .list{overflow:auto;overscroll-behavior:contain;min-height:0;flex:1;padding:3px 7px;scrollbar-width:thin}
    .list button{text-align:start;padding:5px 7px;overflow-wrap:anywhere}.row{display:flex;flex-wrap:wrap;align-items:start;border-bottom:1px solid var(--line)}
    .row>.entry{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .row .fold{color:var(--sub);min-width:44px}.child{display:block;width:100%;color:var(--sub);font-size:13px}
    .question-preview{flex:0 0 100%;max-width:100%;margin:2px 0 6px;padding:8px;background:var(--sel);border-radius:5px}
    .question-preview p{font-size:12px;color:var(--sub);margin:0 0 4px}
    .question-preview .body{max-height:min(160px,25dvh);overflow:auto;overscroll-behavior:contain;white-space:pre-wrap;overflow-wrap:anywhere}
    .result{display:grid;width:100%;border-bottom:1px solid var(--line);gap:2px}.result small,.status{color:var(--sub)}
    mark{background:var(--sel);color:var(--accent)}.status{font-size:12px;margin:4px 11px;overflow-wrap:anywhere}.status:empty{display:none}
    .feedback{display:flex;align-items:center;flex-shrink:0}.feedback .status{flex:1}.feedback button{font-size:12px;color:var(--accent);padding:4px 8px}
    [aria-busy=true]{color:var(--accent)}.frame header,.frame nav,.frame .find,.tools{flex-shrink:0}
    .tree-tools{display:flex;justify-content:flex-end;gap:4px;padding:0 8px;flex-shrink:0}
    .tree-tools button{font-size:12px;color:var(--sub);padding:4px 8px}
    iframe{width:100%;flex:1;min-height:0;border:0;background:var(--p)}.tools{display:flex;justify-content:flex-end;border-top:1px solid var(--line)}
    @media(pointer:coarse){button,.icon{min-height:44px;min-width:44px}.handle{min-width:44px}}
  `;
  let path="",view="",tab="outline",find=false,rows=[],limit=64,start=0,turns=[],partial=true,routeEpoch=0,readCtl,jumpCtl,frame,updateTimer,loadedVersion=0;
  const surface=globalThis.ReaderSurfaceState,privateFrames=new Map();let wide=false;
  let notice="",readStep=null,compact=false,composing=false,stale=false,changedTimer,revealCurrent=false;
  let loadBody=async id=>ReaderPageIndex.domBody(id),searchCtl,searchTimer,searchResult,searchHits=[],searchStats,searchQuery="",searchStopped=false;
  let chapters,landed=null,landedSection,loadFiles,fileCtl,fileRows=new Map(),fileCursor=0,fileError=false;
  let diagnosticModel,nativeVerified=false,nativeRetry=0;
  let previewCtl,previewTimer,previewBox,previewOwner,restoringPreview=false;
  const positions=new Map();
  const frameBox=make("section","frame"),work=make("div","work"),nav=make("nav"),query=make("input"),finder=make("div","find");
  const list=make("div","list"),status=make("p","status");status.setAttribute("role","status");
  const treeTools=make("div","tree-tools");
  treeTools.append(button(L("展开全部","Expand all"),()=>render.outline?.setAll(true)),
    button(L("折叠全部","Collapse all"),()=>render.outline?.setAll(false)));
  const feedback=make("div","feedback"),cancel=button(L("停止","Stop"),()=>cancelWork()),reload=button(L("重新读取","Reload"),()=>{
    if(find&&searchStopped&&!stale)void runSearch();else if(tab==="files"&&fileError&&!stale)void runFiles();else void loadRows();
  });
  feedback.append(status,cancel,reload);cancel.hidden=reload.hidden=true;
  const heading=make("header"),modes=make("div","modes"),footer=make("div","tools"),saveSlot=make("div","save-slot");
  const handle=button("",()=>toggle(),"handle");handle.title=L("打开 Chat Reader","Open Chat Reader");handle.setAttribute("aria-label",handle.title);
  const placeLauncher=globalThis.ReaderLauncher?.(handle,handle);
  const close=icon("close",L("收起","Collapse"),()=>hide(true));
  const expand=button("↗",()=>{wide=!wide;frameBox.dataset.wide=String(wide);expand.setAttribute("aria-pressed",String(wide));
    expand.setAttribute("aria-label",wide?L("恢复紧凑宽度","Use compact width"):L("扩大工作区","Expand workspace"));surface?.update({wide});},"icon");
  expand.setAttribute("aria-label",L("扩大工作区","Expand workspace"));expand.setAttribute("aria-pressed","false");
  const brand=make("strong","", "Chat Reader");brand.prepend(ReaderGlyph("book"));
  const outlineButton=button(L("导航","Navigation"),()=>open("outline")),libraryButton=button(L("资料库","Library"),()=>open("library")),importButton=button(L("导入","Import"),()=>open("import"));
  modes.append(outlineButton,libraryButton,importButton);heading.append(brand,expand,close);
  const tabs=[
    button(L("目录","Outline"),()=>switchList("outline",false)),
    button(L("附件","Files"),()=>switchList("files",false)),
    icon("search",L("查找当前对话","Find in current chat"),()=>{switchList(tab,!find);if(find)query.focus();})
  ];nav.append(...tabs);query.type="search";query.placeholder=L("查找当前对话正文…","Find in this conversation…");
  query.setAttribute("aria-label",query.placeholder);query.oninput=()=>{if(!composing)queueSearch();};
  query.oncompositionstart=()=>{composing=true;stopSearch();};query.oncompositionend=()=>{composing=false;queueSearch();};finder.append(query);
  footer.append(saveSlot);
  work.append(nav,finder,treeTools,list,feedback);frameBox.append(heading,modes,work,footer);frameBox.hidden=true;
  frameBox.setAttribute("aria-label",L("Chat Reader 导航","Chat Reader navigation"));frameBox.setAttribute("role","region");
  shadow.append(style,handle,frameBox);
  function send(kind,extra={}){return chrome.runtime.sendMessage({kind,path:location.pathname,...extra});}
  function hide(focus=false){routeEpoch++;readCtl?.abort();readCtl=null;chapters?.pause();stopFiles();stopPreview();stopSearch();stopJump();frameBox.hidden=true;
    surface?.update({open:false,slot:saveSlot});handle.hidden=!!surface?.get().hasControl;
    handle.setAttribute("aria-expanded","false");placeLauncher?.();if(focus&&!globalThis.ReaderFocusWorkspace?.())handle.focus({preventScroll:true});}
  surface?.subscribe(s=>{handle.hidden=s.open||s.hasControl;footer.hidden=!s.hasControl;placeLauncher?.();});
  function geometry(state=ReaderPageIndex.layout()){
    const {height,edge,top:offset}=state;compact=state.compact;
    const top=Math.max(offset+8,Math.min(offset+height*.08,edge-440));
    host.style.setProperty("--reader-top",top+"px");host.style.setProperty("--reader-room",Math.max(44,edge-top)+"px");
    placeLauncher?.();
  }
  function listKey(){return find?"find":tab;}
  function switchList(next,search){
    positions.set(listKey(),{top:list.scrollTop,limit,start});tab=next;find=search;
    if(!find)stopSearch();
    if(find||next!=="files")stopFiles();
    if(!find&&next==="files")void runFiles();
    const previous=positions.get(listKey());limit=64;start=previous?.start||0;render();list.scrollTop=previous?.top||0;
    if(find&&query.value.trim()!==searchQuery)void runSearch();
  }
  function paintStatus(){
    let copy=readCtl?ReaderProgress.describe(readStep,navigator.language.startsWith("zh"))||L("正在读取对话…","Reading conversation…"):notice;
    if(!readCtl&&!jumpCtl&&!stale&&find&&query.value.trim()===searchQuery&&(!notice||searchCtl||searchStopped)){
      if(searchCtl)copy=L(`正在查找 · ${searchStats?.scanned||0}/${rows.length} 条消息 · 至少 ${searchStats?.matches||searchHits.length} 处`,
        `Searching · ${searchStats?.scanned||0}/${rows.length} messages · at least ${searchStats?.matches||searchHits.length} matches`);
      else if(searchStopped)copy=L(`查找已停止 · 至少 ${searchStats?.matches||searchHits.length} 处匹配`,`Search stopped · at least ${searchStats?.matches||searchHits.length} matches`);
      else if(searchResult)copy=L(`${searchResult.total} 处匹配`,`${searchResult.total} matches`);
    }
    if(partial&&!readCtl)copy+=(copy?" · ":"")+L("部分目录","Partial outline");
    if(fileCtl&&!notice&&!readCtl)copy=L("正在读取附件…","Reading files…");
    status.textContent=copy;cancel.hidden=!readCtl&&!jumpCtl&&!searchCtl&&!fileCtl;reload.hidden=!!readCtl||!!searchCtl||!partial&&!stale&&!searchStopped&&!fileError;
  }
  function cancelWork(){
    const returnFocus=shadow.activeElement===cancel;
    readCtl?.abort();readCtl=null;chapters?.pause();stopFiles();stopSearch();stopJump();
    notice=L("已停止；保留已读取的目录。","Stopped; the available outline is retained.");paintStatus();
    if(returnFocus)(reload.hidden?close:reload).focus({preventScroll:true});
  }
  function pauseForCapture(){
    readCtl?.abort();readCtl=null;chapters?.pause();stopFiles();stopPreview();stopSearch();stopJump();
    notice=L("正在保存；目录保留，完成后可重新读取。","Saving; the outline is retained. Reload it after the save.");
    paintStatus();
  }
  function stopSearch(){clearTimeout(searchTimer);if(searchCtl)searchStopped=true;searchCtl?.abort();searchCtl=null;}
  function queueSearch(){
    stopSearch();searchResult=null;searchHits=[];searchQuery=query.value.trim();searchStats=null;searchStopped=false;render();
    searchTimer=setTimeout(()=>{void runSearch();},150);
  }
  async function runSearch(page=0){
    stopSearch();const q=query.value.trim(),index=q===searchQuery?searchResult:null,ctl=new AbortController(),n=routeEpoch;
    searchCtl=ctl;searchStopped=false;searchStats=null;searchQuery=q;searchHits=[];notice="";
    if(!page)searchResult=null;
    if(!q){searchCtl=null;render();return;}
    render();list.scrollTop=0;
    const current=()=>!ctl.signal.aborted&&n===routeEpoch&&q===query.value.trim();
    try{
      const result=await ReaderPageIndex.search(rows,loadBody,q,{signal:ctl.signal,index,page,
        onProgress:s=>{if(current()){searchStats=s;paintStatus();}},
        onPage:h=>{if(current()){searchHits=h;render();}}});
      if(!current())return;searchResult=result;searchHits=result.hits;searchStopped=false;
    }catch{if(current()){searchStopped=true;notice=L("查找中断，请重试。","Search interrupted. Retry.");}}
    finally{if(searchCtl===ctl){searchCtl=null;render();}}
  }
  function stopFiles(){fileCtl?.abort();fileCtl=null;}
  async function runFiles(){
    if(!loadFiles||fileCtl||fileCursor>=rows.length||stale)return;
    const ctl=new AbortController(),epoch=routeEpoch,model=chapters;
    const current=()=>!ctl.signal.aborted&&epoch===routeEpoch&&model===chapters&&loadedVersion===ReaderPageIndex.sample();
    fileCtl=ctl;fileError=false;notice="";let budget=performance.now()+8;
    try{
      while(fileCursor<rows.length&&current()){
        const row=rows[fileCursor];
        if(row.hasFiles!==false){
          const files=await loadFiles(row.id,ctl.signal);if(!current())return;
          if(files.length)fileRows.set(row.id,files);
        }
        fileCursor++;
        if(performance.now()>=budget){render();await new Promise(resolve=>setTimeout(resolve,0));budget=performance.now()+8;}
      }
    }catch{if(current()){fileError=true;notice=L("附件未读取完，可重试。","File list interrupted. Retry.");}}
    finally{if(fileCtl===ctl){fileCtl=null;if(!find&&tab==="files")render();}}
  }
  function install(data){
    chapters?.pause();stopFiles();fileRows=new Map();fileError=false;landed=null;
    const supplied=new Map(data.rows.map(row=>[row.id,row]));
    rows=data.rows.map(row=>({id:row.id,role:row.role,title:row.title??ReaderPageIndex.metadata(row).title,hasFiles:row.hasFiles,alias:row.alias}));
    loadBody=data.loadBody;loadFiles=data.loadFiles;
    fileCursor=loadFiles?0:rows.length;
    if(!loadFiles)for(const row of supplied.values())if(row.files?.length)fileRows.set(row.id,row.files);
    loadedVersion=ReaderPageIndex.sample();partial=!data.complete;
    diagnosticModel={rows,branch:data.branch,complete:!!data.complete};nativeVerified=false;nativeRetry=0;
    const route=location.pathname;
    const model=ReaderChapterWindow({rows,load:data.loadChapters||((id)=>supplied.get(id).headings||[]),
      valid:()=>chapters===model&&route===location.pathname&&!frameBox.hidden&&view==="outline"&&!stale&&loadedVersion===ReaderPageIndex.sample(),
      patch:(updates,window)=>{
        if(landed?.heading!==undefined&&updates.has(landed.id)){
          const changed=updates.get(landed.id),at=changed&&ReaderPageIndex.chapterIndex(changed.headings,landedSection?.target.chapter);
          if(at==null||at<0)landed={id:landed.id};else{landed=changed.sections[at].target;landedSection=changed.sections[at];}
        }
        if(render.treeRows===rows)render.outline.patchChapters(updates,window);
        if(!jumpCtl&&!frameBox.hidden&&view==="outline"&&!find&&tab==="outline")activeRow();
      },error:()=>{notice=L("本轮章节未读取完，可重新展开重试。","Chapters unavailable. Reopen this turn to retry.");paintStatus();}});
    chapters=model;turns=model.turns;revealCurrent=!positions.has("outline");
    render();if(!find&&tab==="files")void runFiles();
  }
  function stopJump(){jumpCtl?.abort();jumpCtl=null;list.querySelectorAll("[aria-busy]").forEach(n=>n.removeAttribute("aria-busy"));}
  function stopPreview(restoreFocus=false){
    const owner=previewOwner,box=previewBox,focused=box?.contains(shadow.activeElement);
    // Chromium dispatches focusout synchronously while a focused subtree is
    // removed. Drop ownership first so that callback cannot remove it twice.
    previewOwner=null;previewBox=null;
    clearTimeout(previewTimer);previewTimer=null;previewCtl?.abort();previewCtl=null;
    owner?.removeAttribute("aria-describedby");box?.remove();
    if(restoreFocus&&focused&&owner?.isConnected){restoringPreview=true;owner.focus({preventScroll:true});restoringPreview=false;}
  }
  async function questionPreview(row,owner,container){
    if(previewOwner===owner||!owner.isConnected||stale)return;
    stopPreview();const ctl=new AbortController(),n=routeEpoch;
    previewCtl=ctl;previewOwner=owner;previewBox=make("div","question-preview");
    const label=make("p","",L("正在读取完整提问…","Reading full question…")),body=make("div","body");
    label.setAttribute("role","status");body.id="reader-full-question";body.tabIndex=0;body.setAttribute("aria-label",L("完整提问","Full question"));
    previewBox.append(label,body);container.append(previewBox);
    try{
      const text=await loadBody(row.id,ctl.signal);
      if(ctl.signal.aborted||n!==routeEpoch||!owner.isConnected)return;
      if(typeof text!=="string"||loadedVersion!==ReaderPageIndex.sample())throw Error("preview-changed");
      label.textContent=L("完整提问","Full question");body.textContent=text;owner.setAttribute("aria-describedby",body.id);
    }catch{if(!ctl.signal.aborted&&n===routeEpoch)label.textContent=L("完整提问未能读取，可重新聚焦重试。","Full question unavailable. Focus again to retry.");}
  }
  function previewQuestion(row,owner,container){
    // Read one body from the existing provider only on demand. Release both its
    // text node and pending callback on blur, route changes or page replacement.
    owner.removeAttribute("title");
    container.addEventListener("mouseenter",()=>{clearTimeout(previewTimer);previewTimer=setTimeout(()=>questionPreview(row,owner,container),200);});
    owner.addEventListener("focus",()=>{if(!restoringPreview)void questionPreview(row,owner,container);});
    const leave=e=>{if(!container.contains(e.relatedTarget)&&!container.contains(shadow.activeElement))stopPreview();};
    container.addEventListener("mouseleave",leave);
    container.addEventListener("focusout",e=>{if(!container.contains(e.relatedTarget))stopPreview();});
  }
  async function locate(target,owner,{trial=false}={}){
    ReaderPageIndex.clearFocus();
    stopPreview();stopJump();chapters?.pause();stopFiles();if(busy()){notice=L("请等待当前保存完成后定位。","Finish the current save before jumping.");paintStatus();return;}
    if(stale||loadedVersion!==ReaderPageIndex.sample()){
      stale=partial=true;notice=L("对话已变化，请重新读取目录后定位。","The conversation changed. Reload the outline before jumping.");paintStatus();return;}
    readCtl?.abort();readCtl=null;stopSearch();const ctl=new AbortController();jumpCtl=ctl;owner?.setAttribute("aria-busy","true");
    notice=target.heading===undefined?L("正在定位…","Locating…"):L("正在定位章节…","Locating chapter…");paintStatus();
    const model=chapters,epoch=routeEpoch,version=loadedVersion;
    const current=()=>!ctl.signal.aborted&&jumpCtl===ctl&&epoch===routeEpoch&&model===chapters&&version===ReaderPageIndex.sample();
    try{let body;
      const detail={...model.detail(target.id),files:fileRows.get(target.id)};
      if(target.query)body=await loadBody(target.id,ctl.signal);
      else if(target.heading!==undefined){try{body=await loadBody(target.id,ctl.signal);}catch{/* A semantic DOM title can still be proved without text fallback. */}}
      ctl.signal.throwIfAborted();if(loadedVersion!==ReaderPageIndex.sample())throw Error("Source changed");
      const result=await ReaderPageIndex.jump(rows,target,ctl.signal,undefined,body,{detail,order:model.order,version,loadBody,nativeTrial:trial,qualifyNative:!nativeVerified,
        nativePrepare:!partial&&(trial||performance.now()>=nativeRetry)?globalThis.ReaderNativeScroll?.prepare:null});if(!current())return;
      if(["unsupported","uncancellable","unverified"].includes(result.metrics?.nativeStatus)){nativeVerified=false;nativeRetry=performance.now()+30000;}
      notice=result.ok?(result.kind==="answer-fallback"?L("已定位所属回答，章节尚未能确认。","At the owning answer. The chapter could not be verified."):
        result.kind==="message-fallback"?L("已定位所属消息；无法确认具体附件。","At the owning message; the exact file could not be verified."):""):
        L("未能确认原文位置。可重试或重新读取目录。","Location unconfirmed. Retry or reload the outline.");
      if(result.ok){
        // Only the verified outcome may select a chapter. An attachment's
        // explicit message-level fallback never implies chapter precision.
        landed=["heading","heading-text","text","file"].includes(result.kind)?target:{id:target.id};
        landedSection=detail.sections?.[landed.heading];
        void model.move(target.id);activeRow(landed);
        if(result.metrics?.strategy==="native"&&!result.kind.endsWith("-fallback"))nativeVerified=true;
        if(!trial&&compact&&!["answer-fallback","message-fallback"].includes(result.kind)){jumpCtl=null;hide(true);}
      }
      return result;
    }catch{if(!ctl.signal.aborted)notice=L("定位中断，可重试。","Location interrupted. Retry.");}
    finally{if(jumpCtl===ctl){owner?.removeAttribute("aria-busy");jumpCtl=null;}paintStatus();}
  }
  function activeRow(confirmed){
    if(frameBox.hidden||view!=="outline"||jumpCtl&&!confirmed)return;
    confirmed??=landed;const id=confirmed?.id||ReaderPageIndex.visible();
    if(!find&&tab==="outline"&&render.outline){
      if(id&&chapters?.center()===-1)void chapters.move(id);
      const row=rows[chapters?.order.get(id)],detail=chapters?.detail(id);
      const target=confirmed||(row?(detail&&ReaderPageIndex.currentSection({...row,...detail},id))||{id}:null);
      render.outline.setActive(target,{reveal:!!target&&revealCurrent,follow:!!confirmed});if(target)revealCurrent=false;return;
    }
    list.querySelectorAll("[data-mid]").forEach(n=>{const active=n.dataset.mid===id&&!!confirmed&&
      (find?n.dataset.occurrence===String(confirmed.occurrence)&&confirmed.query===searchQuery:n.dataset.file===String(confirmed.file));n.classList.toggle("active",active);
      if(active)n.setAttribute("aria-current","location");else n.removeAttribute("aria-current");});
  }
  function item(copy,target,cls){
    const b=button(copy,()=>locate(target,b),cls);b.dataset.mid=target.id;b.title=copy;return b;
  }
  function render(){
    stopPreview();
    treeTools.hidden=find||tab!=="outline"||!rows.length;
    finder.hidden=!find;tabs[0].setAttribute("aria-pressed",String(!find&&tab==="outline"));tabs[1].setAttribute("aria-pressed",String(!find&&tab==="files"));
    tabs[2].setAttribute("aria-pressed",String(find));const entries=[];
    if(find){
      for(const hit of searchHits){
        const b=item("",{id:hit.id,query:searchQuery,occurrence:hit.occurrence},"result"),snippet=make("span");
        b.dataset.occurrence=String(hit.occurrence);
        snippet.append(hit.before,make("mark","",hit.match+(hit.truncated?"…":"")),hit.after);
        const seq=chapters.owner.get(hit.id)+1,role=hit.role==="user"?L("提问","Question"):L("回答","Answer");
        b.append(make("small","",L(`第 ${seq} 轮 · ${role} · 第 ${hit.occurrence+1} 处`,`Turn ${seq} · ${role} · match ${hit.occurrence+1}`)),snippet);entries.push(b);
      }
      if(searchResult&&!searchCtl&&!searchStopped){
        const {page,total}=searchResult,pages=Math.ceil(total/64);
        if(page)entries.push(button(L("上一页","Previous matches"),()=>runSearch(page-1)));
        if(page+1<pages)entries.push(button(L("显示更多","Show more"),()=>runSearch(page+1)));
      }
      const top=list.scrollTop;list.replaceChildren(...entries);list.scrollTop=top;activeRow();paintStatus();return;
    }
    if(tab==="outline"){
      render.outline ||= ReaderOutlineTree({container:list,zh:navigator.language.startsWith("zh"),
        onLocate:locate,onPreview:previewQuestion,onBeforeRender:stopPreview,
        onChange:({target,expanded})=>{if(expanded){for(const id of target?[target.id]:chapters.expanded())void chapters.request(id);}}});
      if(render.treeRows!==rows){
        render.treeRows=rows;render.outline.setRows(rows,turns,{windowed:true});
        if(chapters?.center()>=0)render.outline.patchChapters(chapters.snapshot(),{open:chapters.centerId(),allowed:chapters.expanded()});
      }else render.outline.render();
      activeRow();paintStatus();return;
    }
    let count=0;const add=el=>{count++;if(count>start&&count<=start+limit)entries.push(el());};
    for(const [id,files] of fileRows){
        const row=rows[chapters.order.get(id)],i=chapters.owner.get(id),seq=L(`第 ${i+1} 轮`,`Turn ${i+1}`);
        const role=seq+" · "+(row.role==="user"?L("提问","Question"):L("回答","Answer"));
        files.forEach((file,k)=>add(()=>{const b=item(file.name||file,{id:row.id,file:k},"result");
          b.dataset.file=String(k);
          const type={image:L("图片","Image"),file:L("文件","File"),table:L("表格","Table")}[file.type];
          b.append(make("small","",role+(type?" · "+type:"")));return b;}));
    }
    if(start>=count&&start){start=Math.max(0,Math.floor((count-1)/64)*64);render();return;}
    if(start)entries.unshift(button(L("上一页附件","Previous files"),()=>{start=Math.max(0,start-64);render();list.scrollTop=0;}));
    if(count>start+limit)entries.push(button(L("下一页附件","Next files"),()=>{
      start+=limit;render();list.scrollTop=0;
    }));
    list.replaceChildren(...entries);activeRow();
    if(!jumpCtl&&!notice&&!count&&!fileCtl&&fileCursor>=rows.length)notice=L("没有匹配项目。","No matching items.");
    paintStatus();
  }
  async function loadRows(){
    if(frameBox.hidden||view!=="outline")return;
    if(busy()){pauseForCapture();return;}
    readCtl?.abort();stopPreview();stopSearch();stopJump();const ctl=new AbortController();readCtl=ctl;readStep=null;stale=false;notice="";
    searchResult=null;searchHits=[];searchQuery="";searchStopped=false;
    const n=routeEpoch;
    const progress=ReaderProgress.throttle(step=>{if(readCtl===ctl&&!ctl.signal.aborted&&n===routeEpoch){readStep=step;paintStatus();}},120);
    try{
      install({rows:ReaderPageIndex.domRows({light:true}),complete:false,loadBody:async id=>ReaderPageIndex.domBody(id),
        loadFiles:async id=>ReaderPageIndex.mountedFiles(id)});
      const data=await read(ctl,step=>{if(!ctl.signal.aborted)progress.update(step);});
      if(ctl.signal.aborted||n!==routeEpoch)return;
      if(typeof data.loadBody!=="function")throw Error("Navigation body provider unavailable.");
      install(data);
    }catch(e){if(!ctl.signal.aborted&&n===routeEpoch){partial=true;const reason=ReaderProgress.sourceReason(e?.code,navigator.language.startsWith("zh"));
      notice=[reason,L("完整目录未读取，可重试。","The full outline could not be read. Retry.")].filter(Boolean).join(" · ");}}
    finally{try{progress.flush();}finally{progress.close();if(readCtl===ctl){readCtl=null;if(find&&query.value.trim())void runSearch();else paintStatus();}}}
  }
  async function open(want,remember=true){
    if(!ReaderRoutes.eligible(location.pathname))return;
    if(want==="outline"&&view==="outline"&&!frameBox.hidden&&readCtl)return;
    const n=++routeEpoch;readCtl?.abort();readCtl=null;chapters?.pause();stopFiles();stopPreview();stopSearch();stopJump();frame=null;
    for(const f of privateFrames.values())f.hidden=true;
    view=want==="import"?"import":ReaderRoutes.chat(location.pathname)?want:"library";outlineButton.hidden=!ReaderRoutes.chat(location.pathname);
    if(remember)void send("surface-tab",{view});
    frameBox.hidden=false;handle.hidden=true;handle.setAttribute("aria-expanded","true");geometry();close.focus({preventScroll:true});
    outlineButton.setAttribute("aria-pressed",String(view==="outline"));libraryButton.setAttribute("aria-pressed",String(view==="library"));importButton.setAttribute("aria-pressed",String(view==="import"));
    work.hidden=view!=="outline";surface?.update({open:true,view,wide,slot:saveSlot});
    globalThis.ReaderCloseSaveMenu?.();
    if(view!=="outline"){
      if(privateFrames.has(view)){frame=privateFrames.get(view);frame.hidden=false;return;}
      const chosenView=view,result=await send("frame-ticket",{view:chosenView});if(n!==routeEpoch)return;
      if(!result?.ticket){work.hidden=false;status.textContent=L("工作区未打开，请收起后重试。","Workspace unavailable. Reopen to retry.");return;}
      frame=make("iframe");frame.title=chosenView==="import"?L("Reader 导入","Reader import"):L("Reader 资料库","Reader library");
      frame.referrerPolicy="no-referrer";frame.src=chrome.runtime.getURL("frame.html")+"#"+result.ticket;frame.dataset.view=chosenView;
      privateFrames.set(chosenView,frame);frameBox.insertBefore(frame,footer);return;
    }
    if(rows.length&&!stale&&loadedVersion===ReaderPageIndex.sample()){render();if(!partial){
      if(tab==="files"&&!find)void runFiles();else if(!find&&chapters.centerId())void chapters.request(chapters.centerId());return;}}
    await loadRows();
  }
  async function toggle(){if(!frameBox.hidden){hide(true);return;}const r=await send("surface-tab");await open(["library","import"].includes(r?.view)?r.view:"outline",false);}
  function mount(){
    if(path!==location.pathname)ReaderPageIndex.clearFocus();
    const p=location.pathname;if(p!==path){path=p;hide();for(const f of privateFrames.values())f.remove();privateFrames.clear();frame=null;rows=[];turns=[];loadBody=async id=>ReaderPageIndex.domBody(id);searchResult=null;searchHits=[];searchQuery="";
      chapters=null;fileRows.clear();loadFiles=null;landed=null;render.outline?.destroy();render.outline=null;render.treeRows=null;
      positions.clear();query.value="";find=false;tab="outline";start=0;limit=64;stale=false;
      if(!ReaderRoutes.eligible(p)){host.remove();return;}}
    if(ReaderRoutes.eligible(p)&&!host.isConnected){document.body?.append(host);geometry();}
  }
  globalThis.ReaderOpenLibrary=()=>open("library");globalThis.ReaderCloseOverlay=()=>hide();
  globalThis.ReaderPauseNavigationForCapture=pauseForCapture;
  globalThis.ReaderNavigationDiagnostics={
    model:()=>chapters&&!partial&&!stale&&!busy()&&!ReaderPageIndex.generating()&&path===location.pathname&&loadedVersion===ReaderPageIndex.sample()?diagnosticModel:null,
    trial:async id=>{
      if(!chapters||frameBox.hidden||view!=="outline"||partial||!globalThis.ReaderNativeScroll)return {status:"unavailable"};
      const result=await locate({id},null,{trial:true});
      return {status:result?.kind||result?.reason||"cancelled",native:result?.metrics?.nativeStatus,enabled:nativeVerified};
    }
  };
  globalThis.ReaderOpenWorkspace=want=>open(["outline","library","import"].includes(want)?want:"outline");
  shadow.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();
      if(jumpCtl||readCtl||searchCtl)cancelWork();else if(previewBox)stopPreview(true);else if(find){switchList(tab,false);tabs[2].focus({preventScroll:true});}else hide(true);}});
  const userMove=e=>{if(e.isTrusted&&!e.composedPath().includes(host)&&(!e.key||["PageUp","PageDown","Home","End","ArrowUp","ArrowDown"," "].includes(e.key))){
      landed=null;if(jumpCtl){stopJump();notice=L("已停止定位，保留当前位置。","Jump stopped. Your reading position is retained.");paintStatus();}}};
  for(const event of ["wheel","touchstart","pointerdown","keydown"])document.addEventListener(event,userMove,{capture:true,passive:true});
  // Background tabs cannot truthfully confirm a visible destination. Do not
  // resume an abandoned jump or a read when this document is shown again.
  document.addEventListener("visibilitychange",()=>{if(document.hidden){chapters?.pause();stopPreview();if(jumpCtl||readCtl||searchCtl||fileCtl)cancelWork();}});
  addEventListener("pagehide",()=>{ReaderPageIndex.clearFocus();chapters?.pause();stopFiles();readCtl?.abort();readCtl=null;stopPreview();stopSearch();stopJump();});
  ReaderPageIndex.observeLayout(geometry);
  addEventListener("scroll",()=>{if(frameBox.hidden||view!=="outline"||updateTimer)return;
    updateTimer=setTimeout(()=>{updateTimer=null;activeRow();},90);},{capture:true,passive:true});
  new MutationObserver(changes=>{
    if(path!==location.pathname||!host.isConnected&&ReaderRoutes.eligible(path))mount();
    if(frameBox.hidden||view!=="outline"||!changes.some(c=>c.target.closest?.("[data-message-id],[data-chatgpt-search-message-ids],[data-current-node-id]")||
      [...c.addedNodes,...c.removedNodes].some(n=>n.matches?.("[data-message-id],[data-chatgpt-search-message-ids],[data-current-node-id]")||n.querySelector?.("[data-message-id],[data-chatgpt-search-message-ids]"))))return;
    clearTimeout(changedTimer);changedTimer=setTimeout(()=>{
      if(frameBox.hidden||view!=="outline")return;
      if(loadedVersion===ReaderPageIndex.sample()){
        if(!jumpCtl&&!stale&&chapters){chapters.refresh();activeRow();}return;
      }
      ReaderPageIndex.clearFocus();readCtl?.abort();readCtl=null;chapters?.pause();stopFiles();stopPreview();stopSearch();stopJump();stale=partial=true;
      notice=L("对话已变化，请重新读取目录。","The conversation changed. Reload the outline.");paintStatus();
    },160);
  }).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["data-current-node-id","data-talvt-turn-state","data-chatgpt-search-message-ids"]});
  addEventListener("popstate",mount);addEventListener("pageshow",mount);
  chrome.runtime.onMessage.addListener((m,s,reply)=>{if(s.id!==chrome.runtime.id||s.tab)return;
    if(m?.kind==="reader-toggle"){mount();void toggle();reply({ok:true});}
    if(m?.kind==="reader-open-import"){mount();void open("import");reply({ok:true});}
    if(m?.kind==="reader-open-library"){mount();void open("library");reply({ok:true});}
    if(m?.kind==="reader-collapse"){hide(true);reply({ok:true});}
    if(m?.kind==="reader-surface-path")reply({current:ReaderRoutes.eligible(location.pathname)&&location.pathname===m.path});
  });mount();
};
