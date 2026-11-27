/* Native Reader client: catalog metadata only; the Reader webpage owns the document and its files. */
const $=id=>document.getElementById(id), zh=navigator.language.startsWith("zh"), L=(cn,en)=>zh?cn:en,loc=L;
const storage=chrome.storage.local, glyph=ReaderGlyph, uuid=s=>typeof s==="string"&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(s);
const node=(tag,cls,txt)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(txt!=null)x.textContent=txt;return x;};
const label=(el,copy)=>{el.title=copy;el.setAttribute("aria-label",copy);};
const icon=(el,name,copy)=>{el.replaceChildren(glyph(name));label(el,copy);};
const opt=(value,title)=>new Option(title,value);
let device,projects=[],caps={},epoch=0,next=0,timer,composing=false,menuOwner,settingsOwner,historyOwner,catalogController;
const pendingRows=new Set();
const setText=(id,cn,en)=>$(id).textContent=L(cn,en);
document.documentElement.lang=zh?"zh-CN":"en";
document.querySelectorAll("[data-glyph]").forEach(x=>x.append(glyph(x.dataset.glyph)));
icon($("settings-label"),"settings",L("设置","Settings"));icon($("find"),"search",L("搜索","Search"));
document.querySelectorAll(".dismiss").forEach(b=>{icon(b,"close",L("关闭","Close"));b.onclick=()=>b.closest("dialog").close();});
setText("connect","连接 Reader","Connect to Reader");setText("settings-heading","设置","Settings");
setText("auth-heading","连接与授权","Connection and access");setText("import-heading","导入到 Reader","Save to Reader");
setText("ai-heading","交给 AI","For AI");setText("ai-files-copy","包含可导出的附件原文件","Include available original files");
setText("ai-handoff-copy","包含已保存的 Current 和 Index","Include available Current and Index");setText("ai-save","保存账号预设","Save account preset");
setText("text-only-copy","仅保存正文（不下载附件）","Save text only (do not download files)");
setText("manage-devices","管理已授权设备","Manage authorized devices");setText("pair-reader","在 Reader 核对并授权","Review in Reader");
$("manage-devices").href=$("pair-reader").href=READER_ORIGIN+"/extension/devices";
setText("pair-help","在 Reader 的账号安全 → 浏览器插件中输入短码。10 分钟有效。","Enter the code in Reader → Account security → Browser extensions. Valid for 10 minutes.");
setText("pair-cancel","取消配对","Cancel pairing");setText("import-center","导入","Import");
$("import-center").onclick=()=>chrome.runtime.sendMessage({kind:"open-center"});
setText("history-heading","最近任务","Recent tasks");setText("history-link","最近任务","Recent tasks");
setText("disconnect","断开此设备","Disconnect this device");setText("target-label","新对话保存到","Save new conversations to");
setText("share-label-copy","在 ChatGPT 页内显示此项目名称","Show this project name on the ChatGPT page");
setText("source-lookup-copy","也自动查找其他对话的已存版本（向 Reader 发送对话标识）","Also check other chats for saved versions (send their IDs to Reader)");
setText("choose","确认","Confirm");setText("destination-needed","选择新对话的保存位置","Choose where new conversations are saved");
setText("boot-retry","重新读取资料","Retry loading library");
setText("more","加载更多","Load more");$("instance").textContent=READER_ORIGIN;
$("q").placeholder=L("搜索对话标题或项目名…","Search titles or projects…");$("q").setAttribute("aria-label",$("q").placeholder);
$("view").setAttribute("aria-label",L("对话视图","Conversation view"));$("filter").setAttribute("aria-label",L("项目筛选","Project filter"));
$("jobs").setAttribute("aria-label",L("任务状态","Task status"));$("row-menu").setAttribute("aria-label",L("对话操作","Conversation actions"));
const announce=message=>{$("announcer").textContent=message;};
function problem(e){
  if(e.status===401)return L("Reader 授权已失效。请在设置中断开并重新连接。","Reader authorization expired. Disconnect in Settings and reconnect.");
  if(e.status===403)return L("Reader 未允许此操作。请核对账号和实例策略。","Reader did not allow this action. Check the account and instance policy.");
  if(e.status===404)return L("Reader 未提供此功能，或资料已不可用。请在 Reader 中核对。","This feature or item is unavailable. Check it in Reader.");
  if(e.status===409)return L("状态或预设已改变。请在 Reader 中核对后重试。","The state or preset changed. Review it in Reader before retrying.");
  if(e.status>=500)return L("Reader 暂时不可用，请稍后重试。","Reader is temporarily unavailable. Try again in a moment.");
  if(e instanceof TypeError)return L("连接不到 Reader。请核对网络和实例地址后重试。","Cannot reach Reader. Check your network and instance address.");
  return e.message||L("操作未完成，请重试。","Action not completed. Try again.");
}
function showError(e){
  const d=document.querySelector("dialog[open]");let out=$("error");
  if(d){out=d.querySelector(".dialog-error");if(!out){out=node("p","dialog-error");out.setAttribute("role","alert");d.append(out);}}
  out.textContent=problem(e);
}
async function run(b,fn){
  if(b.dataset.pending||b.disabled)return;b.dataset.pending="1";b.setAttribute("aria-busy","true");
  $("error").textContent="";document.querySelectorAll(".dialog-error").forEach(x=>x.textContent="");
  try{await fn();}catch(e){showError(e);}finally{delete b.dataset.pending;b.removeAttribute("aria-busy");}
}
function btn(copy,fn,cls=""){const b=node("button",cls,copy);b.type="button";b.onclick=()=>run(b,fn);return b;}
function link(title,cid,aid=null,files=false){
  if(!uuid(cid)||aid&&!uuid(aid))throw Error("Invalid Reader target");
  const a=node("a","",title);a.href=READER_ORIGIN+"/conversations/"+cid+(files?"?files=open"+(aid?"&attachmentId="+aid:""):"");
  a.target="_blank";a.rel="noopener noreferrer";return a;
}
async function session(){const {device:d}=await storage.get("device");if(!device||d?.id!==device.id||d.origin!==READER_ORIGIN)throw Error(L("账号已改变，请重开侧栏。","Account changed. Reopen the side panel."));}
async function req(path,opts){await session();return ReaderClient.request(device.id,path,opts);}
const json=async(path,opts)=>(await req(path,opts)).json();
const cmd=async fields=>{await session();const w=await chrome.runtime.sendMessage({kind:"wake"});if(!w?.ok)throw Error("Reader transfer unavailable");
  const r=await chrome.runtime.sendMessage({kind:"panel-host",device:device.id,...fields});if(!r?.ok)throw Error(r?.error||"Reader task unavailable");};
function dateLabel(value){
  if(!value)return null;
  const d=new Date(/T/.test(value)&&!/(Z|[+-]\d\d:\d\d)$/i.test(value)?value+"Z":value);if(isNaN(+d))return null;
  const now=new Date(),prev=new Date(now);prev.setDate(prev.getDate()-1);
  const text=d.toDateString()===now.toDateString()?L("今天","Today"):d.toDateString()===prev.toDateString()?L("昨天","Yesterday"):
    new Intl.DateTimeFormat(zh?"zh-CN":"en",{...(now.getFullYear()!==d.getFullYear()?{year:"numeric"}:{}),month:"short",day:"numeric"}).format(d);
  const t=node("time","",text);t.dateTime=d.toISOString();t.title=d.toLocaleString();return t;
}
const projectName=s=>s?.state==="unclassified"?L("未分类","Unclassified"):s?.state==="project"?
  ReaderRoutes.projectName(s.name,s.id)||L("项目名称未知","Project name unavailable"):L("项目不可用","Project unavailable");
const pOptions=(f,all)=>{f.replaceChildren(...(all?[opt("",L("所有项目","All projects")),opt("unclassified",L("未分类","Unclassified"))]:[opt("",L("未分类","Unclassified"))]),
  ...projects.filter(p=>!p.default).map((p,i)=>opt(p.id,ReaderRoutes.projectName(p.name,p.id)||L(`名称未知的项目 ${i+1}`,`Unnamed project ${i+1}`))));};
function focus(el){if(el?.isConnected&&!el.hidden)el.focus({preventScroll:true});}
function closeMenu(restore=false){const m=$("row-menu");if(m.matches(":popover-open"))m.hidePopover();menuOwner?.setAttribute("aria-expanded","false");if(restore)focus(menuOwner);}
function positionMenu(){
  const m=$("row-menu");if(!m.matches(":popover-open")||!menuOwner?.isConnected)return;
  const r=menuOwner.getBoundingClientRect(),box=m.getBoundingClientRect();
  m.style.left=Math.max(8,Math.min(innerWidth-box.width-8,r.right-box.width))+"px";
  m.style.top=Math.max(8,Math.min(innerHeight-box.height-8,r.bottom+box.height+8<=innerHeight?r.bottom:r.top-box.height))+"px";
}
async function refreshRow(cid,notice){
  const ownsFocus=notice.contains(document.activeElement);
  await load(true);
  if(ownsFocus&&document.activeElement===document.body)
    focus(document.querySelector(`[data-cid="${cid}"] .row-more`)||$("q"));
}
function menuRow(text,ico,fn){const b=btn(text,fn);b.prepend(glyph(ico));return b;}
function rowPending(b){
  b.disabled=true;b.setAttribute("aria-busy","true");
  const n=node("p","row-notice",L("正在更新…","Updating…"));n.tabIndex=-1;n.setAttribute("role","status");
  b.closest("li").append(n);return n;
}
async function mutateRow(item,trigger,fn){
  const cid=item.id;if(pendingRows.has(cid))return;
  pendingRows.add(cid);closeMenu();focus(rowPending(trigger));
  let failure;try{await fn();}catch(e){failure=e;}finally{pendingRows.delete(cid);}
  const notice=document.querySelector(`[data-cid="${cid}"] .row-notice`);
  if(!failure){if(notice)await refreshRow(cid,notice);return;}
  const text=failure.status>=500||failure instanceof TypeError?
    L("操作结果尚未确认。请重新读取列表核对。","The result is unconfirmed. Reload the list to check."):problem(failure);
  if(!notice){$("error").textContent=text;return;}
  notice.closest("li").querySelector(".row-more").removeAttribute("aria-busy");
  notice.classList.add("failed");notice.setAttribute("role","alert");notice.textContent=text;
  // An HTTP or network failure is not proof of a failed write. The only retry
  // offered here reads the authoritative catalog; it never repeats the mutation.
  notice.append(btn(L("重新读取列表","Reload list"),()=>refreshRow(cid,notice),"text-action"));
}
function openMenu(item,b){
  if(b.disabled||pendingRows.has(item.id))return;
  const m=$("row-menu");if(m.matches(":popover-open")&&menuOwner===b){closeMenu(true);return;}
  closeMenu();menuOwner=b;m.replaceChildren();b.setAttribute("aria-expanded","true");
  const cid=item.id,pid=uuid($("filter").value)?$("filter").value:null;
  const exp=menuRow(L("交给 AI · .context.zip","For AI · .context.zip"),"download",()=>{closeMenu(true);return startExport(cid);});
  m.append(exp);const note=node("small","menu-note");m.append(note);
  if(caps.save_receipts)json("context/options").then(s=>{if(note.isConnected){note.textContent=policyText(s);positionMenu();}}).catch(()=>{});
  if(typeof item.pinned==="boolean"){
    const text=pid?(item.pinned?L("取消项目置顶","Unpin in project"):L("项目置顶","Pin in project")):(item.pinned?L("取消全局置顶","Unpin globally"):L("全局置顶","Pin globally"));
    m.append(menuRow(text,"pin",()=>mutateRow(item,b,()=>req(`conversations/${cid}/pin`+(pid?"?project_id="+pid:""),ReaderClient.json("PATCH",{is_pinned:!item.pinned})))));
  }
  m.append(menuRow(L("移到项目…","Move to project…"),"folder",()=>{
    const sel=node("select");label(sel,L("移到项目","Move to project"));pOptions(sel,false);if(item.project_id)sel.value=item.project_id;
    m.replaceChildren(menuRow(L("返回","Back"),"back",()=>{closeMenu();openMenu(item,b);}),sel,
      menuRow(L("移动","Move"),"folder",()=>mutateRow(item,b,()=>req(`conversations/${cid}/project`,ReaderClient.json("PUT",{project_id:sel.value||null})))));
    positionMenu();focus(sel);
  }));
  if(item.attachment_count>0||item.match_kind==="attachment"){
    const a=link(L("在 Reader 查看附件","View files in Reader"),cid,item.match_attachment_id,true);a.prepend(glyph("file"));a.onclick=()=>closeMenu(true);m.append(a);
  }
  m.showPopover();positionMenu();focus(exp);
}
$("row-menu").addEventListener("toggle",()=>{if(menuOwner&&!$("row-menu").matches(":popover-open"))menuOwner.setAttribute("aria-expanded","false");});
$("row-menu").onkeydown=e=>{if(e.key==="Escape"){e.preventDefault();closeMenu(true);} };
addEventListener("resize",positionMenu);addEventListener("scroll",positionMenu,{capture:true,passive:true});
function row(item){
  const li=node("li");li.dataset.cid=item.id;const a=link(null,item.id),copy=node("span","copy"),meta=node("span","meta");
  a.className="row-title";const lead=glyph(item.pinned?"pin":"chat");lead.classList.add("lead");if(item.pinned)lead.classList.add("pinned");
  const title=item.title||L("无标题对话","Untitled conversation"),name=node("span","name");
  name.append(lead,title);if(item.pinned)name.append(node("span","sr",L("（已置顶）"," (pinned)")));copy.append(name,meta);
  const pname=item.project_unavailable?L("项目不可用","Project unavailable"):ReaderRoutes.projectName(item.project_name,item.project_id)||
    (item.project_id?projectName({state:"project",id:item.project_id,name:projects.find(p=>p.id===item.project_id)?.name}):L("未分类","Unclassified"));
  const filter=$("filter").value;
  if(item.project_unavailable||!filter||filter!==(item.project_id||"unclassified")){
    const p=node("span","project",pname);p.title=pname;meta.append(p);
  }
  const t=dateLabel(item.date);if(t){
    if(meta.childElementCount){const dot=node("span","sep","·");dot.setAttribute("aria-hidden","true");meta.append(dot);}
    meta.append(t);t.title=(item.date_kind==="opened"?L("最近打开：","Last opened: "):item.date_kind==="imported"?L("导入：","Imported: "):L("更新：","Updated: "))+t.title;
  }
  if(item.attachment_count>0){const clip=node("span","clip");clip.append(glyph("file"),String(item.attachment_count));label(clip,L(`${item.attachment_count} 个附件`,`${item.attachment_count} attachments`));meta.append(clip);}
  if(item.attachment_match||item.match_kind==="attachment")meta.append(node("span","hit",L("附件匹配","File match")));
  a.append(copy);const b=node("button","icon row-more");icon(b,"more",L("更多：","More: ")+title);b.setAttribute("aria-expanded","false");b.setAttribute("aria-controls","row-menu");b.onclick=()=>openMenu(item,b);li.append(a,b);if(pendingRows.has(item.id))rowPending(b);return li;
}
function emptyActions(q,filter,view){
  const actions=$("recover"),pinned=view==="pinned";
  const change=(copy,el,value)=>actions.append(btn(copy,()=>{
    el.value=value;focus(q?$("q"):el);return load(true);
  },"text-action"));
  if(pinned)change(L("包含未置顶对话","Include unpinned conversations"),$("view"),"recent");
  if(filter)change(pinned?L("查看全局置顶","View globally pinned"):q?L("搜索所有项目","Search all projects"):L("查看所有项目","View all projects"),$("filter"),"");
  if(q&&!filter&&!pinned)change(L("清空搜索","Clear search"),$("q"),"");
}
async function load(reset){
  if($("library").hidden)return;
  clearTimeout(timer);const n=++epoch,q=$("q").value.trim(),filter=$("filter").value,view=$("view").value||"library",params=new URLSearchParams({offset:String(reset?0:next)});
  catalogController?.abort();catalogController=new AbortController();
  if(q&&!caps.catalog_names){
    $("rows").replaceChildren();$("recover").replaceChildren();$("more").hidden=true;$("rows").removeAttribute("aria-busy");
    $("status").textContent=L("请升级 Reader 以搜索对话标题和项目名。","Update Reader to search titles and project names.");return;
  }
  if(caps.catalog_names)params.set("match","names");
  if(caps.catalog_details)params.set("view",view);if(q)params.set("q",q);if(uuid(filter))params.set("project_id",filter);else if(filter==="unclassified")params.set("scope",filter);
  if(reset){closeMenu();$("rows").replaceChildren();next=0;}$("more").hidden=true;$("recover").replaceChildren();$("rows").setAttribute("aria-busy","true");$("status").textContent=L("正在读取…","Loading…");
  try{const s=await json("conversations?"+params,{signal:catalogController.signal});if(n!==epoch)return;await session();if(n!==epoch)return;
    const first=$("view").options[0];first.textContent=q?L("搜索结果","Search results"):!caps.catalog_details?L("对话","Conversations"):s.listing==="updated"?L("最近更新","Recently updated"):L("最近的对话","Recent conversations");
    $("rows").append(...s.items.map(row));next+=s.items.length;$("more").hidden=!s.has_more;
    $("status").textContent=next?"":q?L("没有匹配的对话。","No matching conversations."):view==="pinned"?L("此范围内没有置顶对话。","No pinned conversations in this scope."):L("此处还没有对话。","No conversations here yet.");
    if(!next)emptyActions(q,filter,view);
  }catch(e){if(n!==epoch)return;$("status").textContent=problem(e);$("recover").append(btn(L("重试","Retry"),()=>load(reset),"text-action"));}
  finally{if(n===epoch)$("rows").removeAttribute("aria-busy");}
}
let options;
async function readOptions(){if(!device||!caps.context_settings)return;
  const v=await json("context/options");await session();options=v;$("ai-options").hidden=false;
  $("ai-files").checked=v.attachments==="include";$("ai-handoff").checked=v.continuation==="auto";}
$("ai-save").onclick=()=>run($("ai-save"),async()=>{if(!options)return;
  const body={preset_id:options.preset_id,revision:options.revision,include_attachments:$("ai-files").checked,include_continuation:$("ai-handoff").checked};
  try{options=await json("context/options",ReaderClient.json("PUT",body));$("ai-status").textContent=L("已保存","Saved");}
  catch(e){await readOptions();throw e;}
});
function settings(b){settingsOwner=b;if(!$("settings").open)$("settings").showModal();focus(!$("dest").hidden&&!$("target").disabled?$("target"):$("history-link"));readOptions().catch(showError);}
$("settings-label").onclick=()=>settings($("settings-label"));$("destination-needed").onclick=()=>settings($("destination-needed"));
function restoreDialogOwner(dialog,opener){
  // Native close may already have restored the opener. A queued `close` must
  // not move focus back from the user's next control, including another dialog.
  if(!dialog.open&&(document.activeElement===document.body||dialog.contains(document.activeElement)))focus(opener);
}
$("settings").onclose=()=>restoreDialogOwner($("settings"),settingsOwner?.hidden?$("settings-label"):settingsOwner);
$("history-link").onclick=async()=>{historyOwner=$("history-link");await renderJobs(true);$("history").showModal();};
$("history").onclose=()=>restoreDialogOwner($("history"),historyOwner?.isConnected?historyOwner:$("settings-label"));
async function init(retry=false){
  // A registered device can still be disconnected while its catalog is
  // unavailable. Never offer an empty project picker as a writable destination.
  const retryButton=$("boot-retry");
  try{
  await ReaderClient.trust;({device}=await storage.get("device"));$("pair").hidden=!!device;$("settings-label").hidden=!device;
  $("boot").hidden=!device;$("library").hidden=$("dest").hidden=$("choose").disabled=true;if(!device){await showPair("status");return;}
  $("identity").textContent=device.name+" · "+READER_ORIGIN;
  $("boot-status").textContent=L("正在读取资料…","Loading library…");
  const available=await json("capabilities"),scopes=await json("projects");await session();
  caps=available;projects=scopes;pOptions($("filter"),true);pOptions($("target"),false);
  $("view").replaceChildren(opt(caps.catalog_details?"recent":"library",caps.catalog_details?L("最近的对话","Recent conversations"):L("对话","Conversations")));
  if(caps.catalog_details)$("view").append(opt("pinned",L("已置顶","Pinned")));
  const {destination:d,sourceLookupDevice}=await storage.get(["destination","sourceLookupDevice"]);const valid=d?.device===device.id&&[...$("target").options].some(o=>o.value===(d.project||""));
  $("source-lookup-setting").hidden=caps.source_lookup!==true;$("source-lookup").checked=sourceLookupDevice===device.id;
  if(valid){$("target").value=d.project||"";$("share-label").checked=!!d.showName;$("text-only").checked=!!d.textOnly;}else if(d)await storage.remove("destination");
  $("destination-needed").hidden=valid||!caps.capture;
  if(!caps.capture)$("target-label").textContent=L("此实例未启用网页保存。资料浏览和导出仍可用。","Web capture is unavailable. Browsing and export are still available.");
  $("choose").disabled=$("target").disabled=!caps.capture;
  const returnToSearch=retry&&(document.activeElement===retryButton||document.activeElement===document.body);
  $("dest").hidden=$("library").hidden=false;$("boot").hidden=retryButton.hidden=true;
  if(!valid&&caps.capture)settings($("settings-label"));else if(returnToSearch)focus($("q"));
  await renderJobs();await load(true);
  }catch(e){
    $("library").hidden=$("dest").hidden=$("choose").disabled=true;
    $("boot").hidden=retryButton.hidden=false;$("boot-status").textContent=e.status===404?
      L("此 Reader 未提供插件资料接口。请核对服务器版本和实例策略。","The extension catalog is unavailable on this Reader. Check the server version and its policy."):problem(e);
    $("pair").hidden=true;if(!device)$("settings-label").hidden=true;
  }
}
$("boot-retry").onclick=()=>run($("boot-retry"),()=>init(true));
$("source-lookup").onchange=async e=>{
  const box=e.currentTarget,enabled=box.checked,id=device?.id;box.disabled=true;
  try{
    await navigator.locks.request("reader-device",async()=>{
      await session();if(device.id!==id||caps.source_lookup!==true)throw Error(L("请重开侧栏。","Reopen the side panel."));
      if(enabled)await storage.set({sourceLookupDevice:id});else await storage.remove("sourceLookupDevice");
    });
  }catch(e){box.checked=!enabled;showError(e);}finally{box.disabled=false;}
};
$("dest").onsubmit=e=>{e.preventDefault();run($("choose"),async()=>{await session();const project=$("target").value||null;
  await storage.set({destination:{device:device.id,project,textOnly:$("text-only").checked,showName:$("share-label").checked,name:$("target").selectedOptions[0].text}});
  $("destination-needed").hidden=true;$("settings").close();announce(L("保存位置已更新。","Save destination updated."));});};
let pairClock;
async function showPair(action){
  clearTimeout(pairClock);let p;
  try{p=await ReaderClient.pair(action);}catch(e){if(action==="poll")pairClock=setTimeout(()=>showPair("poll").catch(showError),6000);throw e;}
  if(p?.connected){await init();return;}
  $("pair-info").hidden=!p;$("connect").hidden=!!p;$("short-code").textContent=p?.code||"";
  if(p)pairClock=setTimeout(()=>showPair("poll").catch(showError),5300);
  else if(action==="poll")$("error").textContent=L("短码已失效。请重新连接。","The code expired. Connect again.");
}
$("connect").onclick=()=>run($("connect"),()=>showPair("start"));$("pair-cancel").onclick=()=>run($("pair-cancel"),()=>showPair("cancel"));
$("disconnect").onclick=()=>run($("disconnect"),async()=>{await ReaderClient.disconnect();location.reload();});
$("q").oncompositionstart=()=>{composing=true;clearTimeout(timer);epoch++;catalogController?.abort();};$("q").oncompositionend=()=>{composing=false;schedule();};
function schedule(){if(composing)return;clearTimeout(timer);epoch++;catalogController?.abort();timer=setTimeout(()=>load(true),180);}
$("q").oninput=schedule;$("search").onsubmit=e=>{e.preventDefault();if(!composing)load(true);};
$("filter").onchange=$("view").onchange=()=>load(true);$("more").onclick=()=>run($("more"),()=>load(false));
chrome.storage.onChanged.addListener((c,area)=>{if(area!=="local")return;if(c.device&&device&&c.device.newValue?.id!==device.id){location.reload();return;}
  if(c.jobs||c.exportJob||c.seenWarnings)renderJobs().catch(showError);});
init().catch(showError);setInterval(pollExport,1600);
