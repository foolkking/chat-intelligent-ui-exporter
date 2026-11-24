/* Isolated presentation only. No Reader fetch, storage, page bridge or background capture. */
globalThis.ReaderSourceControl=({pathId,capture,cancel})=>{
  const L=(cn,en)=>navigator.language.startsWith("zh")?cn:en, g=ReaderGlyph;
  const host=document.createElement("div"),shadow=host.attachShadow({mode:"closed"}),style=document.createElement("style");
  style.textContent=`:host{all:initial;position:fixed;inset:auto max(12px,env(safe-area-inset-right)) max(76px,env(safe-area-inset-bottom)) auto;z-index:9999;
    --paper:#faf9f6;--ink:#27332e;--soft:#52635b;--rule:#d6dad3;--accent:#096c59;--wash:#e9f2ed;--warn:#805018;--focus:#087a68;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
    @media(prefers-color-scheme:dark){:host{--paper:#2a2d28;--ink:#ecede7;--soft:#b4c0b5;--rule:#4d534b;--accent:#9edfc6;--wash:#34443a;--warn:#edc78c;--focus:#a1ddc8}}
    *,*::before,*::after{box-sizing:border-box}.bar{display:flex;align-items:stretch;background:var(--paper);color:var(--ink);border:1px solid var(--rule);border-radius:10px;max-width:calc(100vw - 26px)}
    button{border:0;min-height:44px;background:transparent;color:inherit;font:inherit;cursor:pointer}button:focus-visible{outline:2px solid var(--focus);outline-offset:-3px}button:hover:not(:disabled){background:var(--wash)}
    .main{min-width:0;display:flex;align-items:center;gap:7px;padding:6px 10px;font-weight:600;border-radius:9px 0 0 9px;text-align:start}.main span,.main small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .main small{font-weight:400;font-size:12px;max-width:12ch;color:var(--soft)}svg{width:16px;height:16px;flex:none}.main svg{color:var(--accent)}.bar[data-tone=warning] .main svg{color:var(--warn)}
    .toggle{width:44px;flex:none;border-radius:0 9px 9px 0;display:grid;place-items:center;color:var(--soft)}.toggle svg{width:12px}
    .menu{display:grid;position:absolute;right:0;bottom:calc(100% + 4px);padding:4px;background:var(--paper);border:1px solid var(--rule);color:var(--ink);border-radius:8px;min-width:min(200px,90vw);max-width:calc(100vw - 26px)}
    .menu button{padding:6px 10px;text-align:left;border-radius:4px}.spin{animation:turn 1.1s linear infinite}@keyframes turn{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spin{animation:none}}[hidden]{display:none!important}`;
  const make=(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n;},bar=make("div","bar"),main=make("button","main"),toggle=make("button","toggle"),menu=make("div","menu");
  main.type=toggle.type="button";menu.hidden=true;toggle.append(g("chevron"));toggle.title=L("其他操作","Other actions");toggle.setAttribute("aria-label",toggle.title);toggle.setAttribute("aria-expanded","false");
  bar.append(main,toggle);shadow.append(style,bar,menu);
  const names={checking:[L("正在核对…","Checking…"),"spin"],save:[L("保存到 Reader","Save to Reader"),"upload"],saving:[L("正在保存…","Saving…"),"spin"],
    saved:[L("已存入 Reader","Saved to Reader"),"ok"],copy:[L("已另存副本","Copy saved"),"ok"],
    previous:[L("打开已存版本","Open saved version"),"book"],partial:[L("部分已保存","Partially saved"),"warning"],
    review:[L("需要确认","Review save"),"warning"],uncertain:[L("核对保存结果","Check save result"),"warning"],
    unavailable:[L("此实例未启用保存","Capture unavailable"),"warning"],
    failed:[L("查看保存问题","Review save issue"),"warning"],connect:[L("连接 Reader","Connect Reader"),"book"],
    destination:[L("选择保存位置","Choose destination"),"folder"],reconnect:[L("重新连接 Reader","Reconnect Reader"),"warning"]};
  const messages={offline:L("连接不到 Reader，可重试。","Cannot reach Reader. Try again."),changed:L("来源或账号已切换。","Source or account changed."),
    unavailable:L("此 Reader 未提供该功能。","This Reader does not offer this feature."),denied:L("Reader 未允许此操作。","Reader did not allow this action."),
    reconnect:L("请重新连接 Reader。","Reconnect to Reader."),panel:L("请从工具栏打开 Chat Reader。","Open Chat Reader from the toolbar."),
    "not-found":L("没有可打开的已存版本。","No accessible saved version.")};
  let route="",hidden="",attempt="",state="checking",name="",busy=false,revision=0,readSequence=0,watch=null,hint="",redraw="";
  const send=(kind,extra={})=>chrome.runtime.sendMessage({kind,path:location.pathname,...extra});
  function paint(){
    const key=JSON.stringify([state,name,busy,hint]);if(key===redraw)return;redraw=key;
    const [word,ico]=names[state]||names.save,a=g(ico);
    if(ico==="spin")a.classList.add("spin");const t=make("span","");t.textContent=word;main.replaceChildren(a,t);
    if(state==="save"&&name){const sm=make("small","");sm.textContent="· "+name;main.append(sm);}
    if(["saved","copy","partial","previous"].includes(state)){const ext=g("external");ext.style.width="12px";main.append(ext);}
    const aria=[word,state==="save"&&name,hint].filter(Boolean).join(" · ");main.title=aria;main.setAttribute("aria-label",aria);
    main.disabled=busy||state==="saving"||state==="checking";bar.dataset.tone=["partial","review","uncertain","failed","reconnect"].includes(state)?"warning":"normal";
    if(!menu.hidden)fillMenu();
  }
  function closeMenu(focus=false){menu.hidden=true;toggle.setAttribute("aria-expanded","false");if(focus)toggle.focus();}
  function menuAction(cn,en,action){const b=make("button","");b.textContent=L(cn,en);b.onclick=e=>{if(!e.isTrusted)return;closeMenu(true);action();};menu.append(b);}
  async function panel(){const r=await send("open-panel").catch(()=>null);if(!r?.ok){hint=messages.panel;paint();}}
  async function refresh(){
    if(!route||!host.isConnected)return;const path=route,n=++readSequence;
    const r=await send("source-state",{attempt}).catch(()=>null);if(path!==route||n!==readSequence||busy)return;
    if(!r){state="failed";hint=messages.offline;paint();return;}
    if(r.error==="changed")return;
    name=r.name||"";state=r.state||(r.error==="reconnect"?"reconnect":r.error==="unavailable"?"unavailable":"failed");paint();
  }
  function connectWatch(){
    if(watch||!route)return;
    try{const p=chrome.runtime.connect({name:"reader-display"});watch=p;p.onMessage.addListener(()=>refresh());
      p.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(watch===p)watch=null;});}catch{/* extension reloaded */}
  }
  async function doSave(){
    if(busy||!route)return;const rev=revision,path=route;busy=true;state="saving";hint="";paint();
    try{
      await capture(id=>{if(path===route&&rev===revision)attempt=id;});
      if(path===route&&rev===revision){busy=false;await refresh();}
    }catch(e){
      if(path!==route)return;busy=false;
      if(e.displayState){state=e.displayState;paint();if(["destination","connect"].includes(state))await panel();}
      else{await refresh();if(!["review","uncertain","saving","partial","reconnect"].includes(state)){
        hint=e.message;state="failed";paint();note.textContent=hint;note.hidden=false;}}
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
    if(busy||!route)return;const current=route;busy=true;note.hidden=true;paint();
    try{await capture(()=>{},true);}
    catch(e){if(current===route&&e.name!=="AbortError"){note.textContent=e.displayState==="connect"?messages.reconnect:e.message;note.hidden=false;}}
    finally{if(current===route){busy=false;await refresh();paint();}}
  }
  const note=make("div","menu");note.setAttribute("role","status");note.style.padding="10px";note.hidden=true;shadow.append(note);
  main.onclick=e=>{if(!e.isTrusted||busy)return;note.hidden=true;
    if(["previous","saved","copy","partial"].includes(state))void saved("open-saved");
    else if(state==="save")void doSave();else void panel();};
  function fillMenu(){
    const focused=menu.contains(shadow.activeElement)?shadow.activeElement.textContent:null;menu.replaceChildren();
    if(!busy&&!["connect","reconnect","checking","unavailable"].includes(state))menuAction("选择内容并追加到…","Select content and append to…",append);
    if(!busy&&["previous","saved","copy","partial","failed"].includes(state))
      menuAction("检查并保存当前版本","Check and save this version",doSave);
    if(!busy&&["save","destination"].includes(state))menuAction("查找已存版本","Find saved version",()=>saved("find-saved"));
    if(busy)menuAction("取消未发送的读取","Cancel capture before delivery",cancel);
    menuAction("在侧栏查看","Open in side panel",panel);menuAction("在此对话隐藏按钮","Hide for this conversation",()=>{hidden=route;mount();});
    if(focused)([...menu.children].find(b=>b.textContent===focused)||menu.firstElementChild)?.focus({preventScroll:true});
  }
  toggle.onclick=e=>{if(!e.isTrusted)return;note.hidden=true;if(!menu.hidden){closeMenu(true);return;}fillMenu();
    menu.hidden=false;toggle.setAttribute("aria-expanded","true");menu.querySelector("button")?.focus();};
  shadow.addEventListener("keydown",e=>{if(e.key==="Escape"){note.hidden=true;closeMenu(true);}});
  document.addEventListener("pointerdown",e=>{if(e.target!==host){note.hidden=true;closeMenu();}},{passive:true});
  function mount(){
    const path=pathId()?location.pathname:"",changed=path!==route;
    if(changed){cancel();revision++;route=path;attempt="";busy=false;hint=name="";state="checking";hidden="";closeMenu();note.hidden=true;
      if(watch){watch.disconnect();watch=null;}redraw="";}
    if(!route||hidden===route){if(host.isConnected)host.remove();return;}
    if(changed||!host.isConnected){if(!host.isConnected)document.body?.append(host);paint();connectWatch();void refresh();}
  }
  function stale(){if(!attempt)return;attempt="";revision++;if(["saved","copy"].includes(state))state="previous";paint();}
  const messageArea="[data-message-id],[data-message-author-role],[data-talvt-turn-state]";
  new MutationObserver(changes=>{mount();if(!attempt)return;
    if(changes.some(m=>m.target.parentElement?.closest(messageArea)||m.target.closest?.(messageArea)||
      [...m.addedNodes,...m.removedNodes].some(n=>n.matches?.(messageArea)||n.querySelector?.(messageArea))))stale();
  }).observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["data-message-id","data-talvt-turn-state"]});
  addEventListener("popstate",mount);addEventListener("pageshow",()=>{mount();connectWatch();void refresh();});
  const revisit=()=>{if(document.visibilityState==="visible"){mount();connectWatch();void refresh();}};
  addEventListener("focus",revisit);
  document.addEventListener("visibilitychange",revisit);
  chrome.runtime.onMessage.addListener((m,s,reply)=>{if(s.id===chrome.runtime.id&&!s.tab&&m?.kind==="reader-confirm-path"){
    reply({current:!!pathId()&&location.pathname===m.path&&document.visibilityState==="visible"});}});
  mount();
};
