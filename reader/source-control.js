/* Isolated presentation only. No Reader fetch, storage, page bridge or background capture. */
globalThis.ReaderSourceControl=({pathId,capture,cancel})=>{
  const L=(cn,en)=>navigator.language.startsWith("zh")?cn:en, g=ReaderGlyph;
  const host=document.createElement("div"),shadow=host.attachShadow({mode:"closed"}),style=document.createElement("style");
  style.textContent=`:host{all:initial;position:fixed;inset:auto max(12px,env(safe-area-inset-right)) max(var(--reader-bottom,76px),env(safe-area-inset-bottom)) auto;z-index:9999;
    --paper:#faf9f6;--ink:#27332e;--soft:#52635b;--rule:#d6dad3;--accent:#096c59;--wash:#e9f2ed;--warn:#805018;--focus:#087a68;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
    @media(prefers-color-scheme:dark){:host{--paper:#2a2d28;--ink:#ecede7;--soft:#b4c0b5;--rule:#4d534b;--accent:#9edfc6;--wash:#34443a;--warn:#edc78c;--focus:#a1ddc8}}
    *,*::before,*::after{box-sizing:border-box}.bar{display:flex;align-items:stretch;background:var(--paper);color:var(--ink);border:1px solid var(--rule);border-radius:10px;max-width:calc(100vw - 26px)}
    button{border:0;min-height:44px;background:transparent;color:inherit;font:inherit;cursor:pointer}button:focus-visible{outline:2px solid var(--focus);outline-offset:-3px}button:hover:not(:disabled){background:var(--wash)}
    .main{min-width:0;flex:1;display:flex;align-items:center;gap:7px;padding:6px 10px;font-weight:600;border-radius:9px 0 0 9px;text-align:start}.main span,.main small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .read-progress{padding:8px 12px 6px;background:var(--paper);border:1px solid var(--rule);border-bottom:0;border-radius:10px 10px 0 0;color:var(--soft);max-width:calc(100vw - 26px)}
    .read-progress p{margin:0;max-width:32ch;font-size:12px;line-height:1.5;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .read-progress progress{display:block;width:100%;height:3px;margin:6px 0 2px;accent-color:var(--accent)}
    .read-progress{width:min(352px,calc(100vw - 26px));max-height:min(55dvh,480px);overflow:auto;overscroll-behavior:contain}
    .read-progress details>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:var(--accent);font-size:12px}
    .reader-progress-view .progress-headline{color:var(--accent);font-weight:600;margin:4px 0 8px}
    .progress-rows{margin:0;font-size:12px;font-variant-numeric:tabular-nums}.progress-rows>div{display:flex;gap:10px;justify-content:space-between;padding:6px 0;border-top:1px solid var(--rule)}
    .progress-rows dt{flex-shrink:0}.progress-rows dd{margin:0;text-align:end;overflow-wrap:anywhere}.progress-rows [data-active=true]{color:var(--accent)}
    .read-progress .progress-elapsed{margin-top:8px}.read-progress .diagnostic{min-height:44px;padding:4px 0;color:var(--accent);font-size:12px}
    :host:has(.read-progress:not([hidden])) .bar{border-radius:0 0 10px 10px}
    :host([data-workspace]:not([data-docked])) .read-progress{display:none}:host([data-workspace]:not([data-docked])) .bar{border-radius:10px}
    :host([data-docked]){position:relative;inset:auto;display:block;width:100%;z-index:auto}
    :host([data-docked]) .bar{border:0;border-radius:0;max-width:100%;background:transparent}
    :host([data-docked]) .read-progress{width:100%;max-width:100%;max-height:min(46dvh,370px);border:0;border-radius:0;border-bottom:1px solid var(--rule)}
    :host([data-docked]) .main{border-radius:6px}.open-workspace{width:44px;display:grid;place-items:center;border-right:1px solid var(--rule)}
    .main small{font-weight:400;font-size:12px;max-width:12ch;color:var(--soft)}.bar[data-project=true] .main{border-radius:9px}svg{width:16px;height:16px;flex:none}.main svg{color:var(--accent)}.bar[data-tone=warning] .main svg{color:var(--warn)}
    .toggle{width:44px;flex:none;border-radius:0 9px 9px 0;display:grid;place-items:center;color:var(--soft)}.toggle svg{width:12px}
    .menu{display:grid;position:absolute;right:0;bottom:calc(100% + 4px);padding:4px;background:var(--paper);border:1px solid var(--rule);color:var(--ink);border-radius:8px;min-width:min(200px,90vw);max-width:calc(100vw - 26px);max-height:var(--reader-menu-room,65dvh);overflow:auto;overscroll-behavior:contain}
    .menu button{padding:6px 10px;text-align:left;border-radius:4px}.spin{animation:turn 1.1s linear infinite}@keyframes turn{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spin{animation:none}}[hidden]{display:none!important}`;
  const make=(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n;},bar=make("div","bar"),main=make("button","main"),toggle=make("button","toggle"),menu=make("div","menu"),openWorkspace=make("button","open-workspace");
  openWorkspace.type="button";openWorkspace.textContent="☰";openWorkspace.setAttribute("aria-label",L("打开 Chat Reader 工作区","Open Chat Reader workspace"));
  openWorkspace.onclick=e=>{if(e.isTrusted)globalThis.ReaderOpenWorkspace?.("outline");};
  globalThis.ReaderFocusWorkspace=()=>{if(!host.isConnected||openWorkspace.hidden)return false;openWorkspace.focus({preventScroll:true});return true;};
  main.type=toggle.type="button";menu.hidden=true;toggle.append(g("chevron"));toggle.title=L("其他操作","Other actions");toggle.setAttribute("aria-label",toggle.title);toggle.setAttribute("aria-expanded","false");
  const progressBox=make("div","read-progress"),progressText=make("p",""),meter=make("progress",""),phaseLive=make("span","");
  progressBox.hidden=true;meter.hidden=true;progressText.id="reader-transfer-description";meter.setAttribute("aria-hidden","true");
  phaseLive.setAttribute("role","status");phaseLive.style.cssText="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)";
  const details=make("details",""),summary=make("summary",""),history=ReaderProgressView({zh:navigator.language.startsWith("zh")});
  summary.textContent=L("读取与处理详情","Reading and processing details");details.append(summary,history.root);
  details.ontoggle=()=>{summary.textContent=details.open?L("收起进度详情","Collapse progress details"):L("读取与处理详情","Reading and processing details");};
  const diagnosticCopy=make("button","diagnostic");diagnosticCopy.type="button";diagnosticCopy.textContent=L("复制诊断信息","Copy diagnostics");
  progressBox.append(progressText,meter,details,diagnosticCopy,phaseLive);bar.append(openWorkspace,main,toggle);shadow.append(style,progressBox,bar,menu);
  let step=null,announced="",stats={},startedAt=null,finishedAt=null,diagnostic=null,taskPhase=null,progressKey=null;
  function resetProgress(){stats={};startedAt=finishedAt=diagnostic=taskPhase=null;step=null;announced="";details.open=false;showProgress(null);}
  const updateHistory=()=>history.update({step,stats,startedAt,finishedAt,state,diagnostic,taskPhase});
  function showProgress(value){
    const previous=step?.stage;step=ReaderProgress.snapshot(value);stats=ReaderProgress.accumulate(stats,step);
    progressBox.hidden=!step&&!diagnostic&&!Object.keys(stats).length;
    progressText.textContent=["saved","copy","partial","append-ready","append-complete","append-partial","append-review","append-processed","system-hold","cancelled"].includes(state)?names[state][0]:
      state==="failed"?L("保存尚未完成 · 记录已保留","Save incomplete · measurements retained"):
      state==="review"?L("可用内容已接收 · 等待核对","Available content received · review needed"):
      state==="recovering"?L("等待自动核对收据","Receipt check scheduled"):
      state==="paused"?L("上传已暂停 · 可继续原任务","Upload paused · original task can resume"):
      state==="uncertain"?L("保存结果待核对","Save result unconfirmed"):
      state==="saving"&&["received","processing","queued","resource-wait"].includes(taskPhase)?
        taskPhase==="resource-wait"?L("已接收 · 等待可用资源","Received · waiting for available resources"):L("Reader 正在处理","Reader is processing"):
      ReaderProgress.describe(step,navigator.language.startsWith("zh"));
    meter.hidden=!step?.total||!["saving","checking"].includes(state)||["received","processing","queued","resource-wait"].includes(taskPhase);
    if(step?.total){meter.max=step.total;meter.value=step.done||0;}
    if(step?.stage!==announced){announced=step?.stage||"";phaseLive.textContent=progressText.textContent;}
    if(!progressBox.hidden)main.setAttribute("aria-describedby",progressText.id);else main.removeAttribute("aria-describedby");
    updateHistory();
    if(previous!==step?.stage&&!menu.hidden)fillMenu();
  }
  diagnosticCopy.onclick=async e=>{
    if(!e.isTrusted)return;
    const report={version:1,extension:chrome.runtime.getManifest?.().version||"unknown",
      stage:step?.stage||null,stats:ReaderProgress.accumulate(null,stats),diagnostic:ReaderProgress.diagnostic(diagnostic),
      elapsedMs:startedAt?Math.max(0,(finishedAt||Date.now())-startedAt):null};
    try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));diagnosticCopy.textContent=L("已复制脱敏诊断","Sanitized diagnostics copied");}
    catch{diagnosticCopy.textContent=L("复制未完成，请重试","Copy unavailable · retry");}
  };
  const names={project:[L("导入到 Reader","Import to Reader"),"upload"],checking:[L("正在核对…","Checking…"),"spin"],save:[L("保存到 Reader","Save to Reader"),"upload"],saving:[L("正在保存…","Saving…"),"spin"],
    saved:[L("已存入 Reader","Saved to Reader"),"ok"],copy:[L("已另存副本","Copy saved"),"ok"],
    "append-ready":[L("在 Reader 继续追加","Continue append in Reader"),"external"],
    "append-complete":[L("追加已完成","Append completed"),"ok"],
    "append-partial":[L("可用内容已追加","Available content appended"),"warning"],
    "append-review":[L("重新核对追加","Review append again"),"warning"],
    "append-processed":[L("查看追加结果","View append result"),"book"],
    "system-hold":[L("查看处理诊断","View processing diagnostics"),"book"],recovering:[L("等待自动核对","Receipt check scheduled"),"clock"],
    cancelled:[L("读取已取消","Capture cancelled"),"upload"],
    previous:[L("打开已存版本","Open saved version"),"book"],partial:[L("部分已保存","Partially saved"),"warning"],
    review:[L("需要确认","Review save"),"warning"],uncertain:[L("核对保存结果","Check save result"),"warning"],
    unavailable:[L("此实例未启用保存","Capture unavailable"),"warning"],paused:[L("继续上传","Resume upload"),"upload"],
    "upgrade-required":[L("请先更新 Reader","Update Reader first"),"warning"],
    failed:[L("查看保存问题","Review save issue"),"warning"],connect:[L("连接 Reader","Connect Reader"),"book"],
    destination:[L("选择保存位置","Choose destination"),"folder"],reconnect:[L("重新连接 Reader","Reconnect Reader"),"warning"]};
  const messages={offline:L("连接不到 Reader，可重试。","Cannot reach Reader. Try again."),changed:L("来源或账号已切换。","Source or account changed."),
    unavailable:L("此 Reader 未提供该功能。","This Reader does not offer this feature."),denied:L("Reader 未允许此操作。","Reader did not allow this action."),
    reconnect:L("请重新连接 Reader。","Reconnect to Reader."),panel:L("请从工具栏打开 Chat Reader。","Open Chat Reader from the toolbar."),
    "not-found":L("没有可打开的已存版本。","No accessible saved version.")};
  let route="",hidden="",attempt="",attemptSample=null,state="checking",name="",busy=false,revision=0,readSequence=0,watch=null,hint="",redraw="";
  const projectHome=()=>!!globalThis.ReaderRoutes?.projectHome(location.pathname);
  const send=(kind,extra={})=>chrome.runtime.sendMessage({kind,path:location.pathname,...extra});
  const surface=globalThis.ReaderSurfaceState;
  host.toggleAttribute("data-workspace",!!surface);
  function place(){
    const dock=surface?.get(),target=dock?.open&&dock.slot?.isConnected?dock.slot:document.body;
    if(!target||!route||hidden===route)return;
    const isDocked=target!==document.body;
    host.toggleAttribute("data-docked",isDocked);openWorkspace.hidden=isDocked;
    if(host.parentNode!==target)target.append(host);
  }
  surface?.subscribe(()=>{place();});
  function paint(){
    const key=JSON.stringify([state,name,busy,hint]);if(key===redraw)return;redraw=key;
    const [word,ico]=names[state]||names.save,a=g(ico);
    if(ico==="spin")a.classList.add("spin");const t=make("span","");t.textContent=word;main.replaceChildren(a,t);
    if(state==="save"&&name){const sm=make("small","");sm.textContent="· "+name;main.append(sm);}
    if(["saved","copy","partial","previous"].includes(state)){const ext=g("external");ext.style.width="12px";main.append(ext);}
    const aria=[word,state==="save"&&name,hint].filter(Boolean).join(" · ");main.title=aria;main.setAttribute("aria-label",aria);
    main.disabled=busy||state==="saving"||state==="checking"||state==="recovering";bar.dataset.tone=["partial","append-partial","review","uncertain","failed","reconnect"].includes(state)?"warning":"normal";
    toggle.hidden=state==="project";bar.dataset.project=String(state==="project");
    if(!menu.hidden)fillMenu();
  }
  function closeMenu(focus=false){menu.hidden=true;toggle.setAttribute("aria-expanded","false");if(focus)toggle.focus();}
  globalThis.ReaderCloseSaveMenu=()=>{note.hidden=true;closeMenu();};
  function menuAction(cn,en,action){const b=make("button","");b.textContent=L(cn,en);b.onclick=e=>{if(!e.isTrusted)return;closeMenu(true);action();};menu.append(b);}
  async function panel(){if(globalThis.ReaderOpenLibrary){globalThis.ReaderOpenLibrary();return;}
    const r=await send("open-panel").catch(()=>null);if(!r?.ok){hint=messages.panel;paint();}}
  async function refresh(){
    if(!route||!host.isConnected)return;const path=route,n=++readSequence;
    if(projectHome()){state="project";hint=name="";resetProgress();paint();return;}
    const r=await send("source-state",{attempt}).catch(()=>null);if(path!==route||n!==readSequence||busy)return;
    if(!r){state="uncertain";hint=messages.offline;paint();return;}
    if(r.error==="changed")return;
    name=r.name||"";state=r.state||(r.error==="reconnect"?"reconnect":r.error==="unavailable"?"unavailable":"failed");
    if(Object.hasOwn(r,"progressKey")){
      if(r.progressKey!==progressKey)resetProgress();
      progressKey=r.progressKey;
    }
    if((["connect","reconnect","unavailable"].includes(state)||r.error==="denied")&&!r.stats){resetProgress();progressKey=null;attempt="";attemptSample=null;}
    if(r.stats)stats=ReaderProgress.accumulate(stats,r.stats);
    if(Number.isSafeInteger(r.startedAt)&&r.startedAt>0)startedAt=r.startedAt;
    if(Object.hasOwn(r,"finishedAt")){
      if(r.finishedAt===null)finishedAt=null;
      else if(Number.isSafeInteger(r.finishedAt)&&r.finishedAt>=startedAt)finishedAt=r.finishedAt;
    }
    if(Object.hasOwn(r,"diagnostic"))diagnostic=ReaderProgress.diagnostic(r.diagnostic);
    if(Object.hasOwn(r,"taskPhase"))taskPhase=r.taskPhase;
    showProgress(r.step||step);paint();
  }
  function connectWatch(){
    if(watch||!route||projectHome())return;
    try{const p=chrome.runtime.connect({name:"reader-display"});watch=p;p.onMessage.addListener(()=>refresh());
      p.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(watch===p)watch=null;});}catch{/* extension reloaded */}
  }
  async function doSave(){
    if(busy||!route)return;const rev=revision,path=route;busy=true;state="saving";hint="";
    globalThis.ReaderPauseNavigationForCapture?.();
    resetProgress();progressKey=null;attempt="";attemptSample=null;details.open=true;startedAt=Date.now();showProgress({stage:"source",done:0,sourceBytes:0,sourcePages:0});paint();
    try{
      await capture(id=>{if(path===route&&rev===revision){attempt=id;attemptSample=ReaderPageIndex.sample();}},false,null,p=>{if(path===route&&rev===revision)showProgress(p);});
      if(path===route&&rev===revision){busy=false;await refresh();}
    }catch(e){
      if(path!==route)return;busy=false;
      if(e.displayState){state=e.displayState;resetProgress();paint();if(["destination","connect"].includes(state))await panel();}
      else{await refresh();if(!["review","uncertain","saving","recovering","saved","copy","partial","reconnect","paused","cancelled","system-hold"].includes(state)){
        finishedAt=Date.now();hint=L("保存尚未完成，读取记录已保留。请在资料库查看处理状态。","Save is not complete. Reading measurements are retained. Check the library for recovery.");
        state="failed";paint();updateHistory();note.textContent=hint;note.hidden=false;}}
    }finally{if(path===route){busy=false;paint();}}
  }
  async function saved(kind){
    const current=route;const r=await send(kind).catch(()=>null);if(current!==route)return;
    if(r?.state==="previous"){
      // Opening an acknowledged result is not a new save; do not erase a partial/copy warning.
      if(kind!=="open-saved"||!["saved","copy","partial"].includes(state))state="previous";
      hint="";
    }else{attempt="";state=r?.error==="reconnect"?"reconnect":"save";hint=messages[r?.error||r?.state]||messages.offline;}
    paint();if(hint){note.textContent=hint;note.hidden=false;}
  }
  async function append(){
    if(busy||!route)return;const current=route,rev=revision;busy=true;state="saving";hint="";note.hidden=true;paint();
    globalThis.ReaderPauseNavigationForCapture?.();
    resetProgress();progressKey=null;attempt="";attemptSample=null;details.open=true;startedAt=Date.now();showProgress({stage:"source",done:0,sourceBytes:0,sourcePages:0});
    try{await capture(id=>{if(current===route&&rev===revision){attempt=id;attemptSample=ReaderPageIndex.sample();}},
      true,null,p=>{if(current===route&&rev===revision)showProgress(p);});}
    catch(e){if(current===route&&e.name!=="AbortError"){note.textContent=e.displayState==="connect"?messages.reconnect:e.message;note.hidden=false;}}
    finally{if(current===route){busy=false;await refresh();paint();}}
  }
  async function openAppend(){
    const current=route,r=await send("open-append",{attempt}).catch(()=>null);
    if(current===route&&!r?.ok){note.textContent=messages[r?.error]||messages.offline;note.hidden=false;}
  }
  const note=make("div","menu");note.setAttribute("role","status");note.style.padding="10px";note.hidden=true;shadow.append(note);
  main.onclick=e=>{if(!e.isTrusted||busy)return;note.hidden=true;
    if(state==="project")void send("open-center").then(r=>{if(!r?.ok)throw Error();}).catch(()=>{note.textContent=messages.panel;note.hidden=false;});
    else if(["append-ready","append-complete","append-partial","append-review","append-processed"].includes(state))void openAppend();
    else if(["previous","saved","copy","partial"].includes(state))void saved("open-saved");
    else if(["save","cancelled"].includes(state))void doSave();else void panel();};
  function fillMenu(){
    const focused=menu.contains(shadow.activeElement)?shadow.activeElement.textContent:null;menu.replaceChildren();
    if(!busy&&!["connect","reconnect","checking","unavailable"].includes(state))menuAction("选择内容并追加到…","Select content and append to…",append);
    if(!busy&&["previous","saved","copy","partial","failed","append-ready","append-complete","append-partial","append-review","append-processed","cancelled"].includes(state))
      menuAction("检查并保存当前版本","Check and save this version",doSave);
    if(!busy&&["save","destination"].includes(state))menuAction("查找已存版本","Find saved version",()=>saved("find-saved"));
    // The host owns delivery after the archive is sealed. Closing this source page
    // must not pretend to cancel a request already acknowledged by Reader.
    if(busy&&step?.stage!=="upload")menuAction("取消未发送的读取","Cancel capture before delivery",cancel);
    if(!busy)menuAction("批量导入…","Batch import…",()=>send("open-center").catch(()=>{hint=messages.panel;paint();}));
    menuAction("在资料库查看","Open Reader library",panel);menuAction("在此对话隐藏按钮","Hide for this conversation",()=>{hidden=route;mount();});
    if(focused)([...menu.children].find(b=>b.textContent===focused)||menu.firstElementChild)?.focus({preventScroll:true});
  }
  toggle.onclick=e=>{if(!e.isTrusted)return;note.hidden=true;if(!menu.hidden){closeMenu(true);return;}fillMenu();
    menu.hidden=false;toggle.setAttribute("aria-expanded","true");menu.querySelector("button")?.focus();};
  shadow.addEventListener("keydown",e=>{if(e.key==="Escape"&&(!menu.hidden||!note.hidden)){e.preventDefault();e.stopPropagation();note.hidden=true;closeMenu(true);}});
  shadow.addEventListener("pointerdown",e=>e.stopPropagation());
  document.addEventListener("pointerdown",e=>{if(e.target!==host){note.hidden=true;closeMenu();}},{passive:true});
  function mount(){
    const path=pathId()||projectHome()?location.pathname:"",changed=path!==route;
    if(changed){cancel();revision++;route=path;attempt="";attemptSample=null;busy=false;hint=name="";state="checking";hidden="";closeMenu();note.hidden=true;
      if(watch){watch.disconnect();watch=null;}resetProgress();progressKey=null;redraw="";}
    if(!route||hidden===route){if(host.isConnected)host.remove();surface?.update({hasControl:false});return;}
    if(changed||!host.isConnected){place();paint();connectWatch();void refresh();}
    surface?.update({hasControl:true});
  }
  function stale(){
    // Mounting earlier turns is not a new branch. Use the same content/branch
    // evidence as capture; otherwise ordinary virtual scrolling discards both
    // the receipt identity and every subsequent progress callback.
    if(!attempt||ReaderPageIndex.sample()===attemptSample)return;
    attempt="";attemptSample=null;revision++;readSequence++;resetProgress();
    if(["saved","copy"].includes(state))state="previous";paint();
  }
  const messageArea="[data-message-id],[data-chatgpt-search-message-ids],[data-message-author-role],[data-talvt-turn-state],[data-current-node-id],[data-testid='stop-button']";
  new MutationObserver(changes=>{mount();if(!attempt)return;
    if(changes.some(m=>["data-current-node-id","data-talvt-turn-state","data-testid"].includes(m.attributeName)||
      m.target.parentElement?.closest(messageArea)||m.target.closest?.(messageArea)||
      [...m.addedNodes,...m.removedNodes].some(n=>n.matches?.(messageArea)||n.querySelector?.(messageArea))))stale();
  }).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,
    attributeFilter:["data-message-id","data-chatgpt-search-message-ids","data-message-author-role","data-talvt-turn-state","data-current-node-id","data-testid"]});
  addEventListener("popstate",mount);addEventListener("pageshow",()=>{mount();connectWatch();void refresh();});
  const revisit=()=>{if(document.visibilityState==="visible"){mount();connectWatch();void refresh();}};
  addEventListener("focus",revisit);
  document.addEventListener("visibilitychange",revisit);
  chrome.runtime.onMessage.addListener((m,s,reply)=>{if(s.id===chrome.runtime.id&&!s.tab&&m?.kind==="reader-confirm-path"){
    reply({current:!!pathId()&&location.pathname===m.path&&document.visibilityState==="visible"});}});
  ReaderPageIndex.observeLayout(({bottom,edge,top})=>{
    host.style.setProperty("--reader-bottom",bottom+"px");
    host.style.setProperty("--reader-menu-room",Math.max(44,edge-top-host.getBoundingClientRect().height-12)+"px");
  });
  const elapsedClock=setInterval(()=>{if(host.isConnected&&!progressBox.hidden&&(busy||state==="saving"))updateHistory();},1000);
  addEventListener("pagehide",()=>clearInterval(elapsedClock),{once:true});
  mount();
};
