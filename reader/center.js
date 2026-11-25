/* global ReaderClient, ReaderLocalArchive, ReaderProgress, ReaderBatch, READER_ORIGIN */
(() => {
  const $=id=>document.getElementById(id),zh=navigator.language.startsWith("zh"),L=(c,e)=>zh?c:e;
  const storage=chrome.storage.local,uuid=v=>typeof v==="string"&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(v);
  const el=(tag,copy,cls)=>{const n=document.createElement(tag);if(copy!=null)n.textContent=copy;if(cls)n.className=cls;return n;};
  const btn=(copy,fn)=>{const b=el("button",copy);b.onclick=()=>work(fn);return b;};
  const text=(id,c,e)=>$(id).textContent=L(c,e);
  const stepNames=[L("选择来源","Choose source"),L("选择对话","Choose conversations"),L("确认 Reader 目标","Reader destination"),L("查看任务","Import tasks")];
  let step=0,source=null,chosen=new Set(),page=0,selectionModel,device=null,projects=[],plan=null,running=false,stop=false,reading=false,readVersion=0,ownerChanged=false;
  let pairTimer,taskTimer,sourceDirName,mappings={},mappingScope="",bindingRun=0,targetRun=0,taskPage=0;
  const root=navigator.storage.getDirectory();
  const tabHint=Number(new URLSearchParams(location.search).get("tab"));
  ChatExportI18n.setLocale("en");document.documentElement.lang=zh?"zh-CN":"en";
  const labels={
    heading:["导入到 Reader","Import to Reader"],"library-link":["Reader 资料库","Reader library"],
    "source-heading":["从哪里导入？","Where are your conversations?"],"web-heading":["ChatGPT 网页","ChatGPT webpage"],
    "web-note":["只读取你选择的标签页中已发现的对话；目录不完整时不提供整个项目选择。","Read only conversations discovered in the tab you choose. Incomplete directories cannot select an entire project."],
    "web-source":["选择 ChatGPT 标签页","Choose ChatGPT tab"],"archive-heading":["官方导出包","Official data export"],
    "archive-note":["在本机读取 ZIP；只有确认后的对话及所选附件会发送到 Reader。","Read ZIP locally. Only confirmed conversations and selected files are sent to Reader."],
    "file-copy":["选择 ZIP 或 conversations.json","Choose ZIP or conversations.json"],
    "selection-heading":["选择要保存的对话","Choose conversations to save"],"group-label":["ChatGPT 来源项目","ChatGPT source project"],
    "query-label":["按来源标题筛选","Filter source titles"],"select-visible":["选择筛选结果","Select filtered results"],"clear-selection":["清空勾选","Clear selection"],
    "source-more":["下一页","Next page"],"back-source":["重新选择来源","Choose another source"],"to-target":["选择 Reader 目标","Choose Reader destination"],
    "target-heading":["确认 Reader 保存位置","Confirm Reader destination"],"mode-label":["项目对应方式","Project mapping"],
    "include-files-label":["正文及可取得的附件原文件","Messages and available original files"],"remember-label":["记住此来源与当前 Reader 账号的项目映射","Remember this mapping for this source and Reader account"],
    "new-project":["在 Reader 管理项目","Manage projects in Reader"],"reload-projects":["刷新项目","Refresh projects"],
    "append-policy":["已有相同内容会跳过。只有验证共同前缀后才在末尾追加；分支变化、缺件、原文修改或实时分享需单独核对，不覆盖原件。","Identical content is skipped. Only a verified common prefix permits append-only updates. Branch changes, missing files, modified originals and live shares need review; originals are not overwritten."],
    "back-selection":["返回勾选","Back to selection"],"tasks-heading":["导入任务","Import tasks"],
    "pause-queue":["暂停后续读取","Pause next conversations"],"continue-queue":["继续队列","Resume queue"],"retry-failed":["仅重试未完成项","Retry incomplete items"],
    "cancel-pending":["取消尚未发送的项","Cancel unsubmitted items"],"new-import":["新的导入","New import"],
    "resume-heading":["有保留的导入计划","Retained import plan"],"resume-plan":["查看并继续","View and resume"],"forget-plan":["结束此计划","End this plan"],
    "resume-note":["已接收的任务仍由 Reader 处理；未发送的选择和目标已保留。","Reader continues accepted tasks. Unsent selections and destinations are retained."],
    "resume-file-copy":["重新选择同一导出包","Choose the same export again"],"pair-start":["连接 Reader","Connect to Reader"],
    "restore-web":["重新核实原 ChatGPT 工作区","Recheck original ChatGPT workspace"],
    "pair-help":["在 Reader → 账号安全 → 浏览器插件中输入短码，核对账号和权限。10 分钟有效。","Enter this code in Reader → Account security → Browser extensions and review the account and permissions. Expires in 10 minutes."],
    "pair-reader":["打开 Reader 授权页","Open Reader authorization"],"pair-cancel":["取消配对","Cancel pairing"]
  };
  for(const [id,[c,e]] of Object.entries(labels))text(id,c,e);
  $("source-prev").textContent=L("上一页","Previous page");
  $("selection-view").setAttribute("aria-label",L("显示范围","Selection view"));
  $("source-rows").setAttribute("aria-label",L("来源对话","Source conversations"));
  $("task-filter").setAttribute("aria-label",L("任务状态","Task state"));
  $("steps").setAttribute("aria-label",L("导入步骤","Import steps"));
  $("source-query").placeholder=L("搜索对话标题…","Search conversation titles…");
  $("pair-reader").href=READER_ORIGIN+"/extension/devices";$("new-project").href=READER_ORIGIN+"/";
  $("library-link").onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL("panel.html")});
  $("target-mode").replaceChildren(new Option(L("全部保存到一个项目","One destination for all"),"one"),new Option(L("按来源项目分别选择","Map source projects separately"),"groups"));
  const errors={
    "archive-format":L("导出包损坏或含不安全的归档条目，未发送。","The archive is damaged or contains unsafe members. Nothing was sent."),
    "source-format":L("不能确认导出包的对话身份或分支。未发送不确定的内容。","Conversation identities or branches could not be verified. Uncertain content was not sent."),
    "conversation-file":L("包中需要有唯一的 conversations.json。","The export must contain exactly one conversations.json."),
    "storage-full":L("浏览器临时空间不足。原文件和已完成的任务不受影响。","Browser temporary storage is full. Your source file and completed tasks are unchanged."),
    "owner-changed":L("Reader 账号已改变，队列已暂停。请核对连接后重新选择。","Reader account changed. The queue is paused; reconnect and review your selection."),
    "source-changed":L("来源账号、工作区或文件已改变。保留原计划，不继续发送。","The source account, workspace or file changed. The original plan is retained; sending is paused."),
    "source-needed":L("重新选择同一来源后才能读取下一条。已被 Reader 接收的任务仍会继续。","Reattach the same source to read the next conversation. Reader continues accepted tasks."),
    "upgrade-required":L("此 Reader 尚不支持分段导入，请先更新 Reader。不会改用旧的不可靠上传方式。","Update Reader to use resumable imports. This client will not fall back to an unreliable upload path."),
    "queue-open":L("另一个导入中心正在处理此队列。","Another import center is processing this queue."),
    "plan-retained":L("请先查看并处理保留的导入计划；不会用新选择覆盖未完成项。","Review the retained import plan first. New selections cannot replace unfinished items."),
    "scope-unverified":L("无法核实网页的账号与工作区。可查看已发现的目录，但不能开始批量读取；请使用官方导出包。","The webpage account and workspace could not be verified. Discovered entries can be viewed but not batch-read. Use an official export.")
    ,"source-busy":L("此来源已有保存任务。请先处理原任务。","This source has an existing save task. Resolve it first.")
    ,"source-unavailable":L("无法读取所选 ChatGPT 页面。请保留已登录的原标签页并重试。","The selected ChatGPT page could not be read. Keep its signed-in tab open and retry.")
  };
  function failure(e){$("error").textContent=errors[e.message]||(
    e.name==="QuotaExceededError"?errors["storage-full"]:e.status===401?L("Reader 授权已失效，请重新连接。","Reader authorization expired. Reconnect."):
      e.status===403?L("没有此操作权限。","This action is not allowed."):e.message||L("操作未完成，可重试。","Not completed. You can retry."));}
  async function work(fn){$("error").textContent="";try{await fn();}catch(e){if(e.name!=="AbortError")failure(e);}}
  const display=ReaderProgress.throttle(p=>$("activity").textContent=ReaderProgress.describe(p,zh));
  function show(n){step=n;for(const [i,id] of ["source-step","selection-step","target-step","tasks-step"].entries())$(id).hidden=i!==n;
    $("steps").replaceChildren(...stepNames.map((name,i)=>{const x=el("span",`${i+1}  ${name}`);if(i===n)x.setAttribute("aria-current","step");return x;}));
    $("activity").textContent="";$("error").textContent="";const h=document.querySelector("section:not([hidden])>h2");h?.setAttribute("tabindex","-1");h?.focus({preventScroll:true});
  }
  function groupName(g){
    if(g==="unknown")return L("归属未知","Membership unknown");if(g==="unclassified")return L("未归类","Unclassified");
    return source?.groups?.[g]||L("来源项目 ","Source project ")+g.replace(/^project:/,"");
  }
  const selectionOptions=()=>({query:$("source-query").value,group:$("source-group").value,page,
    selectedOnly:$("selection-view").value==="selected"});
  function selection(){
    const options=selectionOptions(),v=options.selectedOnly?selectionModel.selected({page}):selectionModel.view(options);
    page=v.page;
    $("source-rows").replaceChildren(...v.rows.map(row=>{
      const li=el("li"),label=el("label"),check=document.createElement("input"),copy=el("span",null,"item-copy");check.type="checkbox";check.checked=chosen.has(row.id);
      check.onchange=()=>{
        const index=v.rows.indexOf(row),focused=document.activeElement===check;
        selectionModel.set(row.id,check.checked);
        if(options.selectedOnly){selection();if(focused){const next=$("source-rows").querySelectorAll("input");
          (next[Math.min(index,next.length-1)]||$("selection-view")).focus({preventScroll:true});}}
        else counts();
      };
      const updated=Number.isFinite(row.update_time)?new Date(row.update_time*1000):row.updatedAt?new Date(row.updatedAt):null;
      const metadata=[groupName(row.group)];
      if(updated&&!isNaN(+updated))metadata.push(updated.toLocaleDateString());
      if(Number.isSafeInteger(row.attachmentCount)&&row.attachmentCount>=0)metadata.push(L(`附件 ${row.attachmentCount}`,`${row.attachmentCount} files`));
      copy.append(el("span",row.title,"title"),el("span",metadata.join(" · "),"meta"));label.append(check,copy);li.append(label);return li;
    }));
    $("source-more").hidden=$("source-prev").hidden=v.pages<2;$("source-more").disabled=!v.hasNext;$("source-prev").disabled=!v.hasPrevious;
    $("source-page-status").textContent=L(`${v.from}–${v.to} / ${v.total} 条`,`${v.from}–${v.to} of ${v.total}`);
    $("select-visible").disabled=$("select-page").disabled=!v.total;
    $("select-page").textContent=L(`选择本页 ${v.rows.length} 条`,`Select page (${v.rows.length})`);
    $("select-visible").textContent=L(`选择${options.selectedOnly?"已选列表":"筛选结果"} ${v.total} 条`,`Select ${options.selectedOnly?"selected list":"filtered results"} (${v.total})`);
    $("select-page").onclick=()=>{selectionModel.apply(selectionModel.snapshot("page",options.selectedOnly?{selectedOnly:true,page}:options));selection();};
    $("select-visible").onclick=()=>{selectionModel.apply(selectionModel.snapshot("filtered",options.selectedOnly?{selectedOnly:true}:options));selection();};
    const proof=selectionModel.project(options.group);
    $("select-project").hidden=!options.group.startsWith("project:")||options.selectedOnly;
    $("select-project").disabled=!proof.allowed;
    $("select-project").textContent=proof.allowed?L(`选择此导出包内整个项目（${proof.count} 条）`,`Select this export's entire project (${proof.count})`):
      L("目录或归属未完整核实，不能选整个项目","Entire project unavailable: directory or membership is incomplete");
    $("select-project").onclick=()=>{selectionModel.apply(selectionModel.snapshot("project",options));selection();};
    $("source-status").textContent=source?.kind==="archive"?L(`导出包中 ${source.rows.length} 条；项目归属以文件中的明确记录为准。`,`${source.rows.length} conversations in export; project membership requires explicit metadata.`):
      L(`已发现 ${source?.rows.length||0} 条 · 部分目录，不代表整个账号或项目`,`${source?.rows.length||0} discovered · partial directory, not an entire account or project`);
    $("group-summary").textContent=L(`当前范围 ${v.total} 条`,`${v.total} in this scope`);counts();
  }
  function counts(){
    const summary=selectionModel.summary();
    $("selected-count").textContent=L(`已勾选 ${chosen.size} 条 · ${summary.selectedGroupCount} 个来源分组`,`${chosen.size} selected · ${summary.selectedGroupCount} source groups`);
    $("to-target").disabled=!chosen.size||source?.kind==="web"&&!source.scope;
    for(const g of summary.groups){const o=[...$("source-group").options].find(o=>o.value===g.id);
      if(o)o.textContent=`${g.name} (${g.selectedCount}/${g.knownCount})`;}
  }
  function catalogue(){
    chosen.clear();page=0;$("source-query").value="";$("selection-view").value="all";
    $("source-group").disabled=$("source-query").disabled=false;
    selectionModel=ReaderCenterSelection.create({source,chosen,groupName});
    const groups=[...new Set(source.rows.map(r=>r.group))];$("source-group").replaceChildren(new Option(L("全部来源项目","All source projects"),""),...groups.map(g=>new Option(groupName(g),g)));
    const validHint=source.kind==="web"&&source.scope&&source.hint&&groups.includes(source.hint);
    if(validHint)$("source-group").value=source.hint;
    show(1);selection();
    if(source.hint&&!validHint)$("source-status").textContent+=" · "+L("项目提示未核实，已显示全部已发现对话","Project hint unverified; showing all discovered conversations");
  }
  async function clearSource(){
    readVersion++;bindingRun++;targetRun++;source=null;mappings={};mappingScope="";
    if($("bindings-status"))$("bindings-status").textContent="";
    if(sourceDirName){const key=sourceDirName;sourceDirName=null;await (await root).removeEntry(key,{recursive:true}).catch(()=>{});}
  }
  async function pick(file,resume=false){
    if(!file||running||reading)return;reading=true;ownerChanged=false;const existing=plan;
    const version=++readVersion,check=()=>{if(version!==readVersion)throw new DOMException("Cancelled","AbortError");};
    $("source-file").disabled=$("resume-file").disabled=true;
    const name="reader-catalogue-"+crypto.randomUUID(),dir=await (await root).getDirectoryHandle(name,{create:true});
    try{
      const parsed=await ReaderLocalArchive.open(file,dir,check,display.update);check();
      if(resume&&(!existing||existing.source.kind!=="archive"||existing.source.scope!==parsed.digest))throw Error("source-changed");
      if(sourceDirName)await (await root).removeEntry(sourceDirName,{recursive:true}).catch(()=>{});
      sourceDirName=name;source={...parsed,kind:"archive",scope:parsed.digest};
      if(resume){$("source-needed").hidden=$("resume-file-label").hidden=true;$("activity").textContent=L("已核实原导出包，可继续。","Original export verified. Ready to resume.");}
      else catalogue();
    }catch(e){await (await root).removeEntry(name,{recursive:true}).catch(()=>{});throw e;}
    finally{reading=false;$("source-file").disabled=$("resume-file").disabled=false;display.flush();}
  }
  $("source-file").onchange=()=>work(()=>pick($("source-file").files[0]));
  $("resume-file").onchange=()=>work(()=>pick($("resume-file").files[0],true));
  $("source-query").oninput=()=>{page=0;selection();};$("source-query").oncompositionstart=()=>{$("source-query").oninput=null;};
  $("source-query").oncompositionend=()=>{$("source-query").oninput=()=>{page=0;selection();};page=0;selection();};
  $("source-group").onchange=()=>{page=0;selection();};$("source-more").onclick=()=>{page++;selection();};$("source-prev").onclick=()=>{page=Math.max(0,page-1);selection();};
  $("selection-view").replaceChildren(new Option(L("全部目录","All discovered"),"all"),new Option(L("查看已选","Review selected"),"selected"));
  $("selection-view").onchange=()=>{page=0;$("source-group").disabled=$("source-query").disabled=$("selection-view").value==="selected";selection();};
  $("clear-selection").onclick=()=>{selectionModel.clear();selection();};$("back-source").onclick=()=>work(async()=>{await clearSource();show(0);await resumeBox();});
  $("back-selection").onclick=()=>{bindingRun++;clearInterval(pairTimer);show(1);selection();};
  async function current(){
    await ReaderClient.trust;const d=(await storage.get("device")).device;
    if(d?.origin!==READER_ORIGIN)return null;return d;
  }
  async function targets(){
    const n=++targetRun;bindingRun++;if($("bindings-status"))$("bindings-status").textContent="";
    device=await current();$("account").textContent=device?String(device.name||L("已连接","Connected"))+" · "+READER_ORIGIN:READER_ORIGIN;
    $("pair-start").hidden=!!device;$("targets").hidden=!device;$("confirm-import").disabled=true;
    if(!device)return;
    const owner=device,sourceScope=source?.scope;
    const caps=await (await ReaderClient.request(owner.id,"capabilities")).json();
    if(caps.protocol!==1||caps.import_profile!=="reader-chat-v1"||!caps.capture||!caps.resumable_capture)throw Error("upgrade-required");
    const loaded=await (await ReaderClient.request(owner.id,"projects")).json();
    const d=await current();if(n!==targetRun)return;
    if(d?.id!==owner.id||d.user!==owner.user||source?.scope!==sourceScope)throw Error("owner-changed");
    projects=loaded;
    const {destination,batchMappings=[]}=await storage.get(["destination","batchMappings"]);
    const saved=batchMappings.find(m=>m.origin===READER_ORIGIN&&m.user===device.user&&m.source===source.scope);
    const ownerScope=JSON.stringify([READER_ORIGIN,owner.id,owner.user,sourceScope]);
    if(mappingScope!==ownerScope){
      const defaultProject=destination?.device===device.id?destination.project||"":"";mappings=saved?.targets?{...saved.targets}:{"*":defaultProject};
      mappingScope=ownerScope;$("target-mode").value="groups";
      $("include-files").checked=destination?.device===device.id?!destination.textOnly:true;$("remember-mapping").checked=false;
    }
    if($("check-bindings")){$("check-bindings").hidden=!caps.source_lookup;$("check-bindings").disabled=false;
      $("check-bindings").textContent=L(`核对已选 ${chosen.size} 条的已有绑定`,`Check saved references for ${chosen.size} selected conversations`);}
    renderTargets();
  }
  function renderTargets(){
    const selected=source.rows.filter(r=>chosen.has(r.id)),groups=$("target-mode").value==="one"?["*"]:[...new Set(selected.map(r=>r.group))];
    $("target-mappings").replaceChildren(...groups.map((g,i)=>{
      const line=el("div",null,"mapping-row"),label=el("label",g==="*"?L("全部已选对话","All selected conversations"):groupName(g)),select=document.createElement("select");
      select.id="mapping-"+i;label.htmlFor=select.id;select.replaceChildren(new Option(L("Reader · 未归类","Reader · Unclassified"),""),
        ...projects.filter(p=>!p.default).map(p=>new Option("Reader · "+p.name,p.id)));
      const value=mappings[g]??mappings["*"]??"";
      if(value&&!projects.some(p=>p.id===value&&!p.default)){const unavailable=new Option(L("项目不可用，请重新选择","Project unavailable — choose again"),"unavailable");unavailable.disabled=true;select.append(unavailable);select.value="unavailable";}
      else select.value=value;
      mappings[g]=select.value;
      select.onchange=()=>{mappings[g]=select.value;confirmCopy();};line.append(label,el("span","→"),select);return line;
    }));
    $("confirm-import").disabled=false;confirmCopy();
  }
  function confirmCopy(){
    $("confirm-import").disabled=!chosen.size||[...$("target-mappings").querySelectorAll("select")].some(s=>s.value==="unavailable");
    const n=chosen.size;$("confirm-summary").textContent=L(`确认后按此目标逐条处理 ${n} 条对话。已保存的对话不会因此被移动。`,`Process ${n} conversations one at a time with these destinations. Existing records will not be moved.`);
    $("confirm-import").textContent=L(`确认导入 ${n} 条对话`,`Import ${n} conversations`);
  }
  $("to-target").onclick=()=>work(async()=>{show(2);await targets();});
  if($("check-bindings"))$("check-bindings").onclick=()=>work(async()=>{
    if($("check-bindings").disabled)return;
    const snapshot=source,owner=await current(),ids=source.rows.filter(r=>chosen.has(r.id)).map(r=>r.id),n=++bindingRun;
    if(!owner||owner.id!==device?.id)throw Error("owner-changed");
    $("check-bindings").disabled=true;let found=0,read=0;
    const valid=async()=>{
      const now=await current();
      if(n!==bindingRun||step!==2||source!==snapshot)throw new DOMException("Cancelled","AbortError");
      if(now?.id!==owner.id||now?.user!==owner.user)throw Error("owner-changed");
    };
    try{
      for(const id of ids){
        await valid();
        const r=await (await ReaderClient.request(owner.id,"sources/status",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({source_id:id})})).json();
        await valid();found+=uuid(r.conversation_id)?1:0;read++;
        $("bindings-status").textContent=L(`已核对 ${read}/${ids.length} 条；${found} 条找到绑定。绑定不代表内容一致。`,
          `Checked ${read}/${ids.length}; ${found} saved references. A reference does not prove identical content.`);
        if(read<ids.length)await new Promise(resolve=>setTimeout(resolve,200));
      }
    }finally{if(n===bindingRun)$("check-bindings").disabled=false;}
  });
  $("target-mode").onchange=renderTargets;$("reload-projects").onclick=()=>work(targets);
  async function pairing(action){
    const p=await ReaderClient.pair(action);$("pair-info").hidden=!p||!!p.connected;
    $("short-code").textContent=p?.code||"";
    if(p?.connected){clearInterval(pairTimer);await targets();}else if(action==="start"){
      clearInterval(pairTimer);pairTimer=setInterval(()=>work(()=>pairing("poll")),5100);
    }else if(!p)clearInterval(pairTimer);
  }
  $("pair-start").onclick=()=>work(()=>pairing("start"));$("pair-cancel").onclick=()=>work(()=>pairing("cancel"));
  async function savePlan(patch){
    await navigator.locks.request("reader-batch-plan",async()=>{
      const snapshot=await storage.get(["device","batchPlan"]);
      if(!ReaderBatch.owned(plan,snapshot.device,READER_ORIGIN)||snapshot.batchPlan?.id!==plan.id)throw Error("owner-changed");
      plan={...snapshot.batchPlan,...patch};await storage.set({batchPlan:plan});
    });
  }
  async function changeItems(change){
    await navigator.locks.request("reader-batch-plan",async()=>{
      const snapshot=await storage.get(["device","batchPlan","jobs"]);
      if(!ReaderBatch.owned(plan,snapshot.device,READER_ORIGIN)||snapshot.batchPlan?.id!==plan.id)throw Error("owner-changed");
      plan={...snapshot.batchPlan,items:change(snapshot.batchPlan.items,snapshot.jobs||[])};
      await storage.set({batchPlan:plan});
    });
  }
  async function claimItem(key){
    return navigator.locks.request("reader-batch-plan",async()=>{
      const snapshot=await storage.get(["device","batchPlan","jobs"]);
      if(!ReaderBatch.owned(plan,snapshot.device,READER_ORIGIN)||snapshot.batchPlan?.id!==plan.id)throw Error("owner-changed");
      plan=snapshot.batchPlan;const item=plan.items.find(i=>i.key===key);
      if(!item||item.cancelled||item.skipped)return null;
      const j=(snapshot.jobs||[]).find(j=>j.key===key);
      if(!j||!j.iid&&!j.packageReady&&!j.active&&!["cancelled","review","result-unavailable"].includes(j.phase))
        await journal(item,{phase:"source-starting",active:false});
      return item;
    });
  }
  async function journal(item,patch){
    await navigator.locks.request("reader-jobs",async()=>{
      const {device:d,jobs=[]}=await storage.get(["device","jobs"]);if(!ReaderBatch.owned(plan,d,READER_ORIGIN))throw Error("owner-changed");
      const j=jobs.find(j=>j.key===item.key);if(j)Object.assign(j,patch);
      else jobs.push({key:item.key,device:plan.device,local:true,batch:plan.id,title:item.title,...patch});
      await storage.set({jobs});
    });
  }
  async function command(key,op="check",extra={}){
    const wake=await chrome.runtime.sendMessage({kind:"wake"});if(!wake?.ok)throw Error(L("后台暂不可用，请重试。","Background unavailable. Retry."));
    const r=await chrome.runtime.sendMessage({kind:"panel-host",device:plan.device,op,key,...extra});
    if(!r?.ok)throw Error(r?.error||L("未确认操作。请检查原收据。","Operation unconfirmed. Check the original receipt."));
  }
  $("confirm-import").onclick=()=>work(async()=>{
    if(running||!chosen.size)return;const d=await current();if(d?.id!==device?.id)throw Error("owner-changed");
    const rows=source.rows.filter(r=>chosen.has(r.id)),fixed={};for(const row of rows)fixed[row.group]=mappings[$("target-mode").value==="one"?"*":row.group]||null;
    const next=ReaderBatch.create({device:d,origin:READER_ORIGIN,source:{kind:source.kind,scope:source.scope,...(source.kind==="web"?{catalog:source.catalog,tab:source.tab}: {})},rows,targets:fixed,attachments:$("include-files").checked});
    await navigator.locks.request("reader-batch-plan",async()=>{
      const {device:now,batchPlan:previous,jobs=[]}=await storage.get(["device","batchPlan","jobs"]);
      if(now?.id!==d.id||now.user!==d.user||now.origin!==READER_ORIGIN)throw Error("owner-changed");
      if(previous&&previous.id!==plan?.id)throw Error("queue-open");
      if(previous?.items.some(i=>!i.cancelled&&!i.skipped&&(!ReaderBatch.success(jobs.find(j=>j.key===i.key&&j.device===previous.device)))))throw Error("plan-retained");
      await storage.set({batchPlan:next});
    });plan=next;
    if($("remember-mapping").checked){const {batchMappings=[]}=await storage.get("batchMappings");
      await storage.set({batchMappings:[...batchMappings.filter(m=>!(m.origin===READER_ORIGIN&&m.user===d.user&&m.source===source.scope)),
        {origin:READER_ORIGIN,user:d.user,source:source.scope,targets:fixed}]});}
    show(3);await renderTasks();await runQueue();
  });
  async function stage(item){
    if(!source||source.scope!==plan.source.scope)throw Error("source-needed");
    if(source.kind==="web"){
      const r=await chrome.runtime.sendMessage({kind:"batch-capture",plan:plan.id,key:item.key});
      if(!r?.ok)throw Error(r?.error||"source-changed");
      const until=Date.now()+35000;
      for(;;){
        const j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===item.key);
        if(j?.active||j?.iid||j?.packageReady)return;
        if(j?.phase!=="source-starting"||Date.now()>until)throw Error("source-unavailable");
        await new Promise(r=>setTimeout(r,300));
      }
    }
    await navigator.locks.request("reader-local-"+item.key,async()=>{
      const d=await current();if(!ReaderBatch.owned(plan,d,READER_ORIGIN))throw Error("owner-changed");
      const receipt=await (await ReaderClient.request(plan.device,"requests/"+item.key)).json();
      if(uuid(receipt.id)){await journal(item,{iid:receipt.id,phase:"received",active:true});return;}
      const dir=await (await root).getDirectoryHandle(item.key,{create:true});let sealed=false;
      const report=ReaderProgress.throttle(p=>{display.update(p);void journal(item,{step:p}).catch(()=>{});},600);
      const check=()=>{if(ownerChanged)throw Error("owner-changed");if(stop)throw new DOMException("Paused","AbortError");};
      try{
        await journal(item,{phase:"reading",active:true,step:{stage:"index",done:0}});
        const built=await source.build(item.id,dir,{attachments:plan.attachments,check,report:report.update});check();
        if(!ReaderBatch.owned(plan,await current(),READER_ORIGIN))throw Error("owner-changed");
        for await(const [name] of dir)if(name!=="import.zip")await dir.removeEntry(name);
        await journal(item,{phase:"upload-paused",active:false,packageReady:true,partial:built.partial,losses:built.losses,
          binding:{size:built.file.size,sha256:built.sha256,project:item.project,excerpt:false},step:null});sealed=true;
      }catch(e){await journal(item,{phase:e.name==="QuotaExceededError"?"storage-full":"capture-interrupted",active:false,step:null}).catch(()=>{});throw e;}
      finally{report.close();if(!sealed)await (await root).removeEntry(item.key,{recursive:true}).catch(()=>{});}
    });
  }
  async function runQueue(retry=false){
    if(running||!plan)return;
    await navigator.locks.request("reader-batch-run",{ifAvailable:true},async lock=>{
      if(!lock)throw Error("queue-open");running=true;stop=false;ownerChanged=false;await savePlan({paused:false});
      let claimed;
      try{
        const wake=await chrome.runtime.sendMessage({kind:"wake"});
        if(!wake?.ok)throw Error(L("后台暂不可用，请重试。","Background unavailable. Retry."));
        const jobs=(await storage.get("jobs")).jobs||[],items=ReaderBatch.candidates(plan,jobs,retry);
        for(const candidate of items){
          if(stop)break;if(!ReaderBatch.owned(plan,await current(),READER_ORIGIN))throw Error("owner-changed");
          const item=await claimItem(candidate.key);if(!item)continue;claimed=item;
          let j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===item.key);
          // A source capture or accepted server job can outlive this view.
          // Let its host reconcile the existing operation, never start a second one.
          while(j?.active&&!stop){
            await renderTasks();await new Promise(r=>setTimeout(r,700));
            if(!ReaderBatch.owned(plan,await current(),READER_ORIGIN))throw Error("owner-changed");
            j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===item.key);
          }
          if(stop)break;
          if(ReaderBatch.success(j)||["review","cancelled","result-unavailable"].includes(j?.phase))continue;
          if(!j?.iid&&!j?.packageReady){
            // Even an interrupted or unknown result must query its original receipt first.
            const receipt=await (await ReaderClient.request(plan.device,"requests/"+item.key)).json();
            if(uuid(receipt.id)){await journal(item,{iid:receipt.id,phase:"received",active:true});}
            else await stage(item);
          }
          if(stop)break;
          j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===item.key);
          if(!j?.active)await command(item.key,retry?"retry":"check");
          for(;;){
            await renderTasks();j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===item.key);
            if(!j?.active)break;
            if(stop)break;await new Promise(r=>setTimeout(r,700));
            if(!ReaderBatch.owned(plan,await current(),READER_ORIGIN))throw Error("owner-changed");
          }
          // Do not pile up more packages behind an unacknowledged transfer.
          if(j?.packageReady||["upload-unknown","check","reconnect"].includes(j?.phase)){stop=true;break;}
        }
      }catch(e){
        const j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===claimed?.key);
        if(j?.phase==="source-starting"&&!j.active&&!j.iid&&!j.packageReady)
          await journal(claimed,{phase:"capture-interrupted",active:false}).catch(()=>{});
        throw e;
      }finally{running=false;await savePlan({paused:true}).catch(()=>{});await renderTasks();}
    });
  }
  function stateCopy(j,item){
    if(item.skipped)return L("本次已跳过，原件未改；待核对资料保留在 Reader","Skipped in this plan; original unchanged. Review remains available in Reader.");
    if(item.cancelled&&!j?.iid)return L("未发送，已取消","Cancelled before submission");
    if(!j)return L("等待读取","Waiting to read");
    if(j.active&&j.step)return ReaderProgress.describe(j.step,zh);
    if(j.phase==="done"){
      if(j.partial||j.result?.completeness!=="complete")return L("部分保存或完整性待核对","Partially saved or completeness unverified");
      return {created:L("已新建","Saved"),unchanged:L("已存在，未更改","Already saved; unchanged"),
        appended:L(`已在末尾追加 ${j.result.added_messages} 条消息`,`${j.result.added_messages} messages appended`),
        separate_copy:L("已另存，原件未改","Saved separately; original unchanged")}[j.result.action]||L("已处理","Processed");
    }
    return {reading:L("正在读取","Reading"),"capture-interrupted":L("读取已暂停，未发送","Reading paused; not sent"),
      "storage-full":errors["storage-full"],review:L("需要核对，尚未保存","Needs review; not saved"),
      "upload-paused":L("上传暂停，原包保留","Upload paused; original package retained"),reconnect:L("需重新授权","Reconnect required"),
      "upload-unknown":L("回执待核对","Receipt unconfirmed"),check:L("状态待核对","Status unconfirmed"),attention:L("Reader 处理失败或需要检查","Reader processing failed or needs attention"),
      "instance-limit":L("Reader 导入配额不足","Reader import allowance exceeded"),"server-storage":L("Reader 空间不足","Reader storage is full"),
      "upload-rejected":L("上传被拒绝，未保存","Upload rejected; not saved"),"resource-wait":L("等待 Reader 可用内存","Waiting for Reader memory"),
      cancelled:L("已取消","Cancelled"),"result-unavailable":L("原记录不可用","Saved record unavailable")}[j.phase]||(j.active?L("Reader 正在处理","Reader is processing"):L("需检查收据","Check receipt"));
  }
  async function renderTasks(){
    if(!plan)return;const {device:d,jobs=[]}=await storage.get(["device","jobs"]);
    if(!ReaderBatch.owned(plan,d,READER_ORIGIN)){stop=true;ownerChanged=true;$("task-rows").replaceChildren();throw Error("owner-changed");}
    const byKey=new Map(jobs.filter(j=>j.device===plan.device).map(j=>[j.key,j]));
    const category=i=>{
      const j=byKey.get(i.key);if(i.skipped||i.cancelled||["cancelled","result-unavailable"].includes(j?.phase))return "done";
      if(j?.review)return "review";
      if(j?.phase==="done")return j.partial||j.result?.completeness!=="complete"?"attention":"done";
      return !j||j.active||j.phase==="source-starting"?"waiting":"attention";
    };
    const complete=plan.items.filter(i=>ReaderBatch.success(byKey.get(i.key))).length,accepted=plan.items.filter(i=>byKey.get(i.key)?.iid).length;
    const skipped=plan.items.filter(i=>i.skipped).length;
    $("task-summary").textContent=L(`已完成 ${complete}/${plan.items.length} · Reader 已接收 ${accepted} 条`,`Completed ${complete}/${plan.items.length} · Reader received ${accepted}`)+
      (skipped?L(` · 跳过 ${skipped} 条`,` · Skipped ${skipped}`):"");
    const filters={all:L("全部","All"),waiting:L("等待／处理中","Waiting / processing"),review:L("待核对","Needs review"),
      attention:L("未完成／部分保存","Incomplete / partial"),done:L("已结束","Finished")};
    for(const [value,name] of Object.entries(filters)){const option=[...$("task-filter").options].find(o=>o.value===value);
      if(option)option.textContent=`${name} (${value==="all"?plan.items.length:plan.items.filter(i=>category(i)===value).length})`;}
    const filter=$("task-filter").value||"all",filtered=plan.items.filter(i=>filter==="all"||category(i)===filter);
    taskPage=Math.min(taskPage,Math.max(0,Math.ceil(filtered.length/50)-1));
    const visible=filtered.slice(taskPage*50,(taskPage+1)*50);
    $("task-prev").disabled=taskPage===0;$("task-next").disabled=(taskPage+1)*50>=filtered.length;
    $("task-prev").hidden=$("task-next").hidden=filtered.length<=50;
    $("task-page-status").textContent=L(`${filtered.length?taskPage*50+1:0}–${taskPage*50+visible.length} / ${filtered.length} 条`,
      `${filtered.length?taskPage*50+1:0}–${taskPage*50+visible.length} of ${filtered.length}`);
    // Preserve focus while polling; rebuild only when the visible state actually changes.
    const signature=JSON.stringify(visible.map(i=>[i,byKey.get(i.key)]));
    if($("task-rows").dataset.signature!==signature){
      const old=document.activeElement,key=old?.closest("li")?.dataset.key,action=old?.dataset.action;
      $("task-rows").replaceChildren(...visible.map(item=>{
        const j=byKey.get(item.key),li=el("li"),copy=el("div"),actions=el("div",null,"result-actions");li.dataset.key=item.key;
        copy.append(el("div",item.title,"title"),el("div",stateCopy(j,item),"meta"));
        const actual=j?.result?.current_project;
        if(actual)copy.append(el("div",L("实际保存位置：","Saved destination: ")+(actual.state==="project"?actual.name:actual.state==="unclassified"?L("未归类","Unclassified"):L("项目不可用","Project unavailable")),"meta"));
        if(j?.phase==="done"&&uuid(j.cid)){const a=el("a",L("打开 Reader","Open Reader"));a.href=READER_ORIGIN+"/conversations/"+j.cid;a.target="_blank";a.rel="noopener noreferrer";a.dataset.action="open";actions.append(a);}
        if(j?.review&&!item.skipped){
          const r=j.review;copy.append(el("p",[r.partial?L("部分附件或交互内容缺失","Some files or interactive content are missing"):"",
            r.live_share?L("新增消息会进入现有实时分享","New messages will be visible in an existing live share"):"",
            r.action==="conflict"?L("分支或原文改变；只能另存，不覆盖","Branch or original changed; save a copy, not overwrite"):""].filter(Boolean).join(" · ")));
          const b=btn(r.action==="conflict"?L("确认另存","Confirm separate copy"):L("核对后保存可用内容","Save reviewed available content"),async()=>{
            await command(item.key,"check",{decision:{receipt:r.receipt,accept_partial:r.partial,accept_share:r.live_share,separate:r.action==="conflict"}});await renderTasks();
          });b.dataset.action="review";actions.append(b);
          if(uuid(r.conversation_id)){const a=el("a",L("查看原件","View original"));a.href=READER_ORIGIN+"/conversations/"+r.conversation_id;a.target="_blank";a.rel="noopener noreferrer";actions.append(a);}
          actions.append(btn(L("跳过本次，保留原件","Skip; keep original"),async()=>{
            const fresh=((await storage.get("jobs")).jobs||[]).find(x=>x.key===item.key&&x.device===plan.device);
            if(!fresh?.review||fresh.active||fresh.review.receipt!==r.receipt)throw Error(L("状态已改变，请重新核对。","State changed. Review again."));
            // This dismisses only this plan item. It cannot cancel a server job or delete its source.
            await changeItems(items=>items.map(i=>i.key===item.key?{...i,skipped:true}:i));await renderTasks();
          }));
        }else if(j&&!j.active&&!ReaderBatch.success(j)&&!item.cancelled&&!item.skipped){const b=btn(L("检查原收据","Check original receipt"),async()=>{await command(item.key);await renderTasks();});b.dataset.action="check";actions.append(b);
          if(j.packageReady)actions.append(btn(L("取消未接收的上传","Cancel unreceived upload"),async()=>{await command(item.key,"discard");await renderTasks();}));}
        li.append(copy,actions);return li;
      }));$("task-rows").dataset.signature=signature;
      if(key&&document.activeElement===document.body){
        const row=[...$("task-rows").children].find(x=>x.dataset.key===key);row?.querySelector(`[data-action="${action==="review"?"review":action==="open"?"open":"check"}"]`)?.focus({preventScroll:true});
      }
    }
    const unsettled=ReaderBatch.candidates(plan,jobs),unsubmitted=unsettled.some(i=>!byKey.get(i.key)?.iid&&!byKey.get(i.key)?.packageReady);
    const failed=unsettled.some(i=>{const j=byKey.get(i.key);return j&&!j.active&&!["source-starting","received"].includes(j.phase);});
    $("pause-queue").hidden=!running;$("pause-queue").disabled=!running;
    $("continue-queue").hidden=running||!unsettled.length;$("continue-queue").disabled=running||reading;
    $("retry-failed").hidden=running||!failed;$("retry-failed").disabled=running||reading;
    $("cancel-pending").hidden=!unsubmitted;$("cancel-pending").disabled=running;$("new-import").disabled=running;
    const need=unsubmitted&&(!source||source.scope!==plan.source.scope);
    $("source-needed").hidden=!need;$("source-needed").textContent=errors["source-needed"];$("resume-file-label").hidden=!need||plan.source.kind!=="archive";
    $("restore-web").hidden=!need||plan.source.kind!=="web";
  }
  async function resumeBox(){
    const d=await current(),p=(await storage.get("batchPlan")).batchPlan;plan=ReaderBatch.owned(p,d,READER_ORIGIN)?p:null;
    $("resume-box").hidden=!plan;
  }
  $("resume-plan").onclick=()=>work(async()=>{show(3);await renderTasks();await chrome.runtime.sendMessage({kind:"wake"});});
  $("forget-plan").onclick=()=>work(async()=>{
    if(running||!plan)return;
    const jobs=(await storage.get("jobs")).jobs||[];
    if(plan.items.some(i=>!i.skipped&&ReaderBatch.pending(jobs.find(j=>j.key===i.key))))throw Error(L("先在任务页处理已接收、待核对或可恢复的上传。","Resolve accepted, review or resumable uploads in the task view first."));
    await storage.remove("batchPlan");plan=null;await resumeBox();
  });
  $("pause-queue").onclick=()=>{stop=true;$("pause-queue").disabled=true;};
  $("task-filter").replaceChildren(...["all","waiting","review","attention","done"].map(v=>new Option(v,v)));
  $("task-filter").onchange=()=>{taskPage=0;work(renderTasks);};
  $("task-prev").textContent=L("上一页","Previous page");$("task-next").textContent=L("下一页","Next page");
  $("task-prev").onclick=()=>{taskPage=Math.max(0,taskPage-1);work(renderTasks);};$("task-next").onclick=()=>{taskPage++;work(renderTasks);};
  $("continue-queue").onclick=()=>work(()=>runQueue());$("retry-failed").onclick=()=>work(()=>runQueue(true));
  $("cancel-pending").onclick=()=>work(async()=>{
    await changeItems((items,jobs)=>items.map(i=>{
      const j=jobs.find(j=>j.key===i.key);return j?.iid||ReaderBatch.pending(j)?i:{...i,cancelled:true};
    }));await renderTasks();
  });
  $("new-import").onclick=()=>work(async()=>{
    const jobs=(await storage.get("jobs")).jobs||[];
    if(plan.items.some(i=>{const j=jobs.find(j=>j.key===i.key);return !i.cancelled&&!i.skipped&&(!j||ReaderBatch.pending(j));}))
      throw Error(L("请先处理或取消未完成项；已接收的任务不能在这里取消。","Resolve or cancel pending items first. Accepted tasks cannot be cancelled here."));
    await storage.remove("batchPlan");plan=null;await clearSource();show(0);await resumeBox();
  });
  async function chooseWeb(container,accept){
    const r=await chrome.runtime.sendMessage({kind:"batch-tabs"});if(r?.error)throw Error(r.error);
    const tabs=[...(r?.tabs||[])].sort((a,b)=>Number(b.id===tabHint)-Number(a.id===tabHint));
    container.hidden=false;container.replaceChildren(...tabs.map(tab=>btn((tab.title||"ChatGPT")+(tab.id===tabHint?L(" · 从此标签页打开"," · Opened from this tab"):""),async()=>{
      const result=await chrome.runtime.sendMessage({kind:"batch-discover",tab:tab.id});if(result?.error)throw Error(result.error);
      if(!result?.rows)throw Error("source-changed");await accept({...result,kind:"web",tab:tab.id});container.hidden=true;
    })));
    if(!container.children.length)container.textContent=L("先打开已登录的 ChatGPT 私人页面，再重试。","Open a signed-in private ChatGPT page, then retry.");
  }
  $("web-source").onclick=()=>work(()=>chooseWeb($("web-tabs"),async result=>{
    await clearSource();source=result;catalogue();if(!source.scope)failure(Error("scope-unverified"));
  }));
  $("restore-web").onclick=()=>work(()=>chooseWeb($("resume-web-tabs"),async result=>{
    if(result.scope!==plan.source.scope)throw Error("source-changed");
    await clearSource();source=result;await savePlan({source:{...plan.source,catalog:result.catalog,tab:result.tab}});await renderTasks();
  }));
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    if(changes.device&&(changes.device.oldValue?.id!==changes.device.newValue?.id||changes.device.oldValue?.user!==changes.device.newValue?.user)){
      stop=true;ownerChanged=true;if(step===3)work(renderTasks);else if(step===2)work(targets);}
    if(changes.jobs&&step===3)work(renderTasks);
  });
  addEventListener("pagehide",()=>{stop=true;readVersion++;clearInterval(pairTimer);clearInterval(taskTimer);
    if(sourceDirName)void root.then(r=>r.removeEntry(sourceDirName,{recursive:true})).catch(()=>{});
  });
  show(0);work(resumeBox);
  taskTimer=setInterval(()=>{if(step===3&&!running)work(renderTasks);},3000);
})();
