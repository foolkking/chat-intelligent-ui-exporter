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
  let targetsReady=false,webProject=false,mappingRevision=0,submitting=false;
  const projectDrafts=new Map();
  const sourceBindings=new Map(); // live lookup evidence, never an append authorization
  const unnamedGroups=new Map();
  let aliasNames={},aliasEdit=null,nameTimer,nameRequest=0,nextOwnerCheck=0;
  let activeGroup="",projectPage=0,collapsed=false,sourceRun=0,refreshing=false,sourceBlocked=false,selectedOnly=false;
  const projectNodes=new Map(),wide=matchMedia("(min-width:661px)");
  const root=navigator.storage.getDirectory();
  const frame=globalThis.ReaderFrameContext,embedded=frame?.view==="import"&&Number.isSafeInteger(frame.tab)&&frame.tab>=0;
  const tabHint=embedded?frame.tab:Number(new URLSearchParams(location.search).get("tab"));
  if(embedded){
    document.documentElement.dataset.readerFrame="import";
    document.querySelector(".center-head").hidden=true;
  }
  ChatExportI18n.setLocale("en");document.documentElement.lang=zh?"zh-CN":"en";
  const labels={
    heading:["导入到 Reader","Import to Reader"],"library-link":["Reader 资料库","Reader library"],
    "source-heading":["从哪里导入？","Where are your conversations?"],"web-heading":["ChatGPT 网页","ChatGPT webpage"],
    "web-note":["显示所选标签页中已发现的对话。","Shows conversations discovered in the selected tab."],
    "web-source":["选择 ChatGPT 标签页","Choose ChatGPT tab"],"archive-heading":["官方导出包","Official data export"],
    "archive-note":["在本机读取，确认后发送勾选的内容。","Read locally. Confirm which conversations and files to send."],
    "file-copy":["选择 ZIP 或 conversations.json","Choose ZIP or conversations.json"],
    "selection-heading":["选择要保存的对话","Choose conversations to save"],"group-label":["ChatGPT 来源项目","ChatGPT source project"],
    "refresh-source":["刷新来源","Refresh source"],
    "project-query-label":["查找来源项目","Find source project"],"project-prev":["上一页项目","Previous projects"],"project-next":["下一页项目","Next projects"],
    "saved-state-note":["Reader 保存状态未核对","Reader saved state not checked."],
    "source-more":["下一页","Next page"],"back-source":["重新选择来源","Choose another source"],"to-target":["选择 Reader 目标","Choose Reader destination"],
    "target-heading":["确认 Reader 保存位置","Confirm Reader destination"],"mode-label":["项目对应方式","Project mapping"],
    "include-files-label":["正文及可取得的附件原文件","Messages and available original files"],
    "new-project":["在 Reader 管理项目","Manage projects in Reader"],"reload-projects":["刷新项目","Refresh projects"],
    "append-policy":["已有相同内容会跳过。只有验证共同前缀后才在末尾追加；分支变化、缺件、原文修改或实时分享需单独核对，不覆盖原件。","Identical content is skipped. Only a verified common prefix permits append-only updates. Branch changes, missing files, modified originals and live shares need review; originals are not overwritten."],
    "tasks-heading":["导入任务","Import tasks"],
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
  $("source-rows").setAttribute("aria-label",L("来源对话","Source conversations"));
  $("task-filter").setAttribute("aria-label",L("任务状态","Task state"));
  $("steps").setAttribute("aria-label",L("导入步骤","Import steps"));
  $("project-query").placeholder=L("查找来源项目…","Find source project…");
  $("pair-reader").href=READER_ORIGIN+"/extension/devices";$("new-project").href=READER_ORIGIN+"/";
  $("library-link").onclick=()=>embedded?work(async()=>{
    const r=await chrome.runtime.sendMessage({kind:"frame-view",view:"library"});
    if(!r?.ok)throw Error("source-changed");
  }):chrome.tabs.create({url:chrome.runtime.getURL("panel.html")});
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
    ,"review-changed":L("状态已改变，请重新核对。","State changed. Review again.")
    ,"background-unavailable":L("后台暂不可用，请重试。","Background unavailable. Retry.")
    ,"operation-unconfirmed":L("未确认操作，请保留原任务并检查收据。","Operation unconfirmed. Keep the original task and check its receipt.")
    ,"unfinished-imports":L("先在任务页处理已接收、待核对或可恢复的上传。","Resolve accepted, review or resumable uploads in the task view first.")
    ,"pending-items":L("请先处理或取消未完成项；已接收的任务不能在这里取消。","Resolve or cancel pending items first. Accepted tasks cannot be cancelled here.")
  };
  function failure(e){$("error").textContent=(Object.hasOwn(errors,e.message)?errors[e.message]:"")||(
    e.name==="QuotaExceededError"?errors["storage-full"]:e.status===401?L("Reader 授权已失效，请重新连接。","Reader authorization expired. Reconnect."):
      e.status===403?L("没有此操作权限。","This action is not allowed."):
      ReaderProgress.sourceReason(e.code,zh)||L("操作未完成，原选择和任务已保留。","Not completed. Selections and tasks are retained."));}
  async function work(fn){$("error").textContent="";try{await fn();}catch(e){if(e.name!=="AbortError")failure(e);}}
  const display=ReaderProgress.throttle(p=>$("activity").textContent=ReaderProgress.describe(p,zh));
  const canTarget=()=>!!selectionModel&&!refreshing&&!sourceBlocked&&!reading&&chosen.size>0&&!(source?.kind==="web"&&!source.scope);
  function updateSteps(){
    const allowed=[!running&&!submitting,!!selectionModel&&!running&&!submitting,canTarget()&&!running&&!submitting,!!plan];
    for(const b of $("steps").children){
      const i=Number(b.dataset.step);b.disabled=!allowed[i];
      if(i===step)b.setAttribute("aria-current","step");else b.removeAttribute("aria-current");
    }
  }
  for(const [i,name] of stepNames.entries()){
    const b=el("button",`${i+1}  ${name}`);b.type="button";b.dataset.step=String(i);
    b.setAttribute("aria-controls",["source-step","selection-step","target-step","tasks-step"][i]);
    b.onclick=()=>work(()=>goStep(i));$("steps").append(b);
  }
  function show(n){step=n;for(const [i,id] of ["source-step","selection-step","target-step","tasks-step"].entries())$(id).hidden=i!==n;
    nameRequest++;scheduleNames(350);
    $("source-tools").hidden=$("selected-count").hidden=n!==1;
    $("mapping-tools").hidden=n!==2||!device;
    updateSteps();
    $("activity").textContent="";$("error").textContent="";
    $("steps").children[n]?.focus({preventScroll:true});
  }
  async function goStep(n){
    updateSteps();if(n===step||$("steps").children[n]?.disabled)return;
    // Switching a view is never a submit/resume action. Invalidate every
    // in-flight draft callback, but do not cancel or replace a durable plan.
    sourceRun++;readVersion++;bindingRun++;targetRun++;cancelRefresh();
    targetsReady=false;releaseProjectWindows();clearInterval(pairTimer);
    $("pair-info").hidden=true;$("web-tabs").hidden=true;
    show(n);
    if(n===0)await resumeBox();
    else if(n===1)selection();
    else if(n===2)await targets(true);
    else if(n===3)await renderTasks();
  }
  function groupName(g){
    // Presentation only: unknown provenance remains a separate internal group.
    if(g==="unknown")return L("项目待确认","Project unconfirmed");
    if(g==="unclassified")return L("未分类","Unclassified");
    const name=projectLabel(g);
    if(name)return name;
    if(!unnamedGroups.has(g))unnamedGroups.set(g,unnamedGroups.size+1);
    const n=unnamedGroups.get(g);
    return L(`名称未知的项目 ${n}`,`Unnamed project ${n}`);
  }
  function projectLabel(g){
    return ReaderRoutes.projectName(source?.groups?.[g],g.slice(8))||ReaderRoutes.projectName(aliasNames[g],g.slice(8));
  }
  function aliasKey(s){return s?.scope?"reader-project-alias:"+s.kind+":"+s.scope:null;}
  function patchLabels(){
    if(!source||!selectionModel)return;
    for(const [g,n] of projectNodes){
      if(!g)continue;
      const next=groupName(g);if(n.name!==next){n.name=next;n.label.textContent=next;}
      const resolved=!!ReaderRoutes.projectName(source.groups?.[g],g.slice(8));
      if(n.alias){n.alias.hidden=resolved;n.alias.setAttribute("aria-label",L(`为${n.name}设置本地别名`,`Set local alias for ${n.name}`));}
    }
    for(const n of $("source-rows").querySelectorAll("[data-source-label]")){
      const next=groupName(n.dataset.sourceLabel);if(n.textContent!==next)n.textContent=next;
    }
    for(const line of $("target-mappings").children){
      const g=line.dataset.group;
      if(!ReaderRoutes.groupKey(g))continue;
      const name=projectLabel(g);
      line.updateSource(groupName(g),name,name?"":line.sourceSample);
    }
    if($("project-query").value.trim()){
      const scroll=$("project-groups").scrollTop,rowsTop=$("source-rows").scrollTop,focused=document.activeElement,group=focused?.closest("li[data-group]")?.dataset.group;
      const inProjects=$("project-groups").contains(focused);
      projectList(true);$("project-groups").scrollTop=scroll;$("source-rows").scrollTop=rowsTop;
      if(inProjects&&document.activeElement!==focused){
        (focused.isConnected&&!focused.hidden?focused:projectNodes.get(group)?.button||$("project-query")).focus({preventScroll:true});
      }
    }
    counts();
  }
  function editAlias(group){
    const dialog=$("project-alias"),field=$("alias-name");
    aliasEdit={source,group};field.value=aliasNames[group]||"";field.setCustomValidity("");
    if(!dialog.open)dialog.showModal();field.focus();
  }
  $("alias-label").textContent=L("本地项目别名","Local project alias");
  $("alias-save").textContent=L("保存","Save");$("alias-cancel").textContent=L("取消","Cancel");
  $("alias-cancel").onclick=()=>$("project-alias").close();
  $("alias-name").oninput=e=>e.target.setCustomValidity("");
  $("alias-form").onsubmit=e=>{
    e.preventDefault();const edit=aliasEdit,field=$("alias-name"),value=field.value.trim();
    if(edit?.source!==source)return;
    if(value&&!ReaderRoutes.projectName(value,edit.group.slice(8))){field.setCustomValidity(L("请输入项目名称","Enter a project name"));field.reportValidity();return;}
    void work(async()=>{
      const key=aliasKey(edit.source);
      if(key)await navigator.locks.request(key,async()=>{
        const existing=(await storage.get(key))[key]||{};
        if(edit.source!==source)return;
        if(value)existing[edit.group]=value;else delete existing[edit.group];
        await storage.set({[key]:existing});
      });
      if(source!==edit.source)return;
      if(value)aliasNames[edit.group]=value;else delete aliasNames[edit.group];
      $("project-alias").close();patchLabels();
    });
  };
  function scheduleNames(ms=2200){
    clearTimeout(nameTimer);
    if(source?.kind==="web"&&source.scope&&(step===1||step===2)&&!sourceBlocked)
      nameTimer=setTimeout(()=>void updateNames(),ms);
  }
  async function updateNames(){
    const selected=source,token=++nameRequest;
    if(!selected?.catalog||!selected.scope||document.visibilityState==="hidden"){scheduleNames();return;}
    try{
      const missing=selected.rows.find(r=>selected.evidence?.[r.group]?.source==="missing")?.group;
      const recheck=Date.now()>=nextOwnerCheck;
      const result=await chrome.runtime.sendMessage({kind:"batch-project-names",catalog:selected.catalog,revision:selected.namesRevision,missing,recheck});
      if(selected!==source||token!==nameRequest||!(step===1||step===2))return;
      if(result?.error==="source-changed"){
        sourceBlocked=true;targetsReady=false;$("confirm-import").disabled=true;counts();failure(Error("source-changed"));return;
      }
      if(recheck)nextOwnerCheck=Date.now()+60000;
      if(result?.catalog===selected.catalog&&result.scope===selected.scope&&result.groups){
        const different=JSON.stringify(selected.groups)!==JSON.stringify(result.groups);
        Object.assign(selected,{groups:result.groups,evidence:result.evidence,observed:result.observed,namesRevision:result.namesRevision});
        if(different)patchLabels();
      }
    }catch{/* An inactive source tab can become available again. */}
    finally{if(token===nameRequest)scheduleNames();}
  }
  globalThis.ReaderProjectReport=()=>{
    if(!source)return null;
    const groups=[...new Set(source.rows.map(r=>r.group).filter(ReaderRoutes.groupKey))];
    return {kind:source.kind,complete:source.complete===true,verifiedScope:!!source.scope,projects:groups.map((g,i)=>{
      const sourceName=ReaderRoutes.projectName(source.groups?.[g],g.slice(8)),view=projectNodes.get(g)?.label;
      return {n:i+1,selectedFilter:g===activeGroup,observed:source.observed?.[g]?.source||source.evidence?.[g]?.source||"missing",
        resolved:source.evidence?.[g]?.source||"missing",named:!!sourceName,localAlias:!sourceName&&!!aliasNames[g],
        labelAgrees:view&&step===1?view.textContent===groupName(g):null};
    })};
  };
  const selectionOptions=()=>({group:activeGroup,page,selectedOnly});
  function projectLayout(){
    const pane=$("conversation-pane"),review=selectedOnly,key=review?"":activeGroup;
    const anchor=projectNodes.get(key)||projectNodes.get(""),focused=document.activeElement;
    const parent=wide.matches?document.querySelector(".catalogue-layout"):anchor?.li;
    if(parent&&pane.parentElement!==parent)parent.append(pane);
    pane.hidden=!wide.matches&&collapsed&&!review;
    for(const [group,n] of projectNodes){
      const active=group===key;
      n.button.setAttribute("aria-current",String(active));
      if(wide.matches)n.button.removeAttribute("aria-expanded");
      else n.button.setAttribute("aria-expanded",String(active&&!pane.hidden));
    }
    if(focused&&pane.contains(focused)&&!pane.hidden)focused.focus({preventScroll:true});
    document.querySelector(".catalogue-layout").dataset.wide=String(wide.matches);
  }
  function chooseGroup(group,toggle=false){
    const same=group===activeGroup&&!selectedOnly;
    collapsed=toggle&&!wide.matches&&same?!collapsed:false;activeGroup=group;
    if(!same)page=0;
    selectedOnly=false;$("source-group").disabled=false;
    selection(); // no checkbox or source-read side effects
  }
  function projectList(namesOnly=false){
    // Both columns and compact accordions reuse one pane; never clone its rows.
    const pane=$("conversation-pane"),parent=$("project-groups"),layout=document.querySelector(".catalogue-layout");
    if(!namesOnly){layout.append(pane);projectNodes.clear();parent.replaceChildren();}
    const summary=selectionModel.summary(),v=selectionModel.groups({page:projectPage,query:$("project-query").value});
    projectPage=v.page;
    const entries=[{id:"",name:L("全部已发现对话","All discovered conversations"),knownCount:summary.knownCount,selectedCount:summary.selectedCount},...v.groups];
    // A rename can fall outside the typed query. Keep the user's open compact
    // row until they change the filter; never show its conversations under "All".
    const offPage=activeGroup&&!entries.some(g=>g.id===activeGroup)&&summary.groups.find(g=>g.id===activeGroup);
    if(namesOnly&&!wide.matches&&!selectedOnly&&offPage)entries.push(offPage);
    if(namesOnly){
      const keep=new Set(entries.map(g=>g.id));
      for(const [key,n] of projectNodes)if(!keep.has(key)){
        if(n.li.contains(pane))layout.append(pane);n.li.remove();projectNodes.delete(key);
      }
    }
    const createRow=g=>{
      const li=el("li"),line=el("div",null,"project-line"),button=el("button"),check=document.createElement("input");
      li.dataset.group=button.dataset.group=g.id;button.type="button";button.setAttribute("aria-controls","conversation-pane");check.type="checkbox";
      const name=el("span",g.name,"project-name"),count=el("span",null,"project-count");button.append(name,count);
      button.onclick=()=>chooseGroup(g.id,true);
      check.onchange=()=>work(()=>{selectionModel.apply(selectionModel.snapshot("filtered",{group:g.id}),{selected:check.checked});selection();});
      const target=el("label",null,"project-select");target.append(check);
      let alias;
      if(ReaderRoutes.groupKey(g.id)){
        alias=el("button",L("别名","Alias"),"edit-alias");alias.type="button";alias.onclick=()=>editAlias(g.id);
        alias.setAttribute("aria-label",L(`为${g.name}设置本地别名`,`Set local alias for ${g.name}`));
        alias.hidden=!!ReaderRoutes.projectName(source.groups?.[g.id],g.id.slice(8));line.append(button,alias,target);
      }else line.append(button,target);
      li.append(line);projectNodes.set(g.id,{li,button,check,count,label:name,alias,name:g.name});return li;
    };
    let next=parent.firstElementChild;
    for(const g of entries){
      const li=projectNodes.get(g.id)?.li||createRow(g);
      if(li!==next)parent.insertBefore(li,next);
      next=li.nextElementSibling;
    }
    // The compact select is a shortcut for this project page, not an unbounded
    // second copy of a large directory. The active off-page choice remains named.
    const choices=[...entries];
    if(offPage&&!choices.includes(offPage))choices.push(offPage);
    $("source-group").replaceChildren(...choices.map(g=>new Option(g.name,g.id)));$("source-group").value=activeGroup;
    $("project-prev").disabled=!v.hasPrevious;$("project-next").disabled=!v.hasNext;
    $("project-prev").parentElement.hidden=v.pages<2;
    $("project-page-status").textContent=L(`${v.total?projectPage+1:0} / ${v.pages}`,`${v.total?projectPage+1:0} / ${v.pages}`);
    projectLayout();
  }
  function selection(){
    const options=selectionOptions(),v=options.selectedOnly?selectionModel.selected({page}):selectionModel.view(options);
    $("source-group").value=options.selectedOnly?"":activeGroup;
    page=v.page;
    $("source-rows").replaceChildren(...v.rows.map(row=>{
      const li=el("li"),label=el("label"),check=document.createElement("input"),copy=el("span",null,"item-copy");check.type="checkbox";check.checked=chosen.has(row.id);
      li.dataset.id=row.id;
      check.onchange=()=>{
        const index=v.rows.indexOf(row),focused=document.activeElement===check;
        selectionModel.set(row.id,check.checked);
        if(options.selectedOnly){selection();if(focused){const next=$("source-rows").querySelectorAll("input");
          (next[Math.min(index,next.length-1)]||$("selected-count")).focus({preventScroll:true});}}
        else counts();
      };
      const updated=Number.isFinite(row.update_time)?new Date(row.update_time*1000):row.updatedAt?new Date(row.updatedAt):null;
      const group=el("span",groupName(row.group));group.dataset.sourceLabel=row.group;
      const metadata=[];
      if(sourceBindings.get(row.id))metadata.push(L("增量更新","Update existing"));
      if(updated&&!isNaN(+updated))metadata.push(updated.toLocaleDateString());
      if(Number.isSafeInteger(row.attachmentCount)&&row.attachmentCount>=0)metadata.push(L(`附件 ${row.attachmentCount}`,`${row.attachmentCount} files`));
      const meta=el("span",null,"meta");meta.append(group,...(metadata.length?[" · "+metadata.join(" · ")]:[]));
      copy.append(el("span",row.title,"title"),meta);label.append(check,copy);li.append(label);return li;
    }));
    $("source-more").hidden=$("source-prev").hidden=v.pages<2;$("source-more").disabled=!v.hasNext;$("source-prev").disabled=!v.hasPrevious;
    $("source-page-status").textContent=L(`${v.from}–${v.to} / ${v.total} 条`,`${v.from}–${v.to} of ${v.total}`);
    $("group-label").textContent=source.kind==="web"?L("来源项目 · 部分目录","Source projects · partial directory"):L("导出包项目","Export projects");
    $("selection-empty").hidden=!!v.total;$("selection-empty").textContent=options.selectedOnly?L("尚未勾选对话。","No conversations selected."):L("此范围没有匹配的已发现对话。","No discovered conversations match this scope.");
    counts();projectLayout();
  }
  function counts(){
    const summary=selectionModel.summary();
    $("selected-count").textContent=L(`已选 ${chosen.size} 条`,`${chosen.size} selected`);
    $("selected-count").setAttribute("aria-pressed",String(selectedOnly));
    $("selected-count").setAttribute("aria-label",L(`已选 ${chosen.size} 条，${selectedOnly?"返回全部目录":"查看已选"}`,`${chosen.size} selected; ${selectedOnly?"show all discovered":"review selection"}`));
    const checked=sourceBindings.size,existing=[...sourceBindings.values()].filter(Boolean).length;
    $("saved-state-note").textContent=checked?L(`已核对 ${checked} 条 · ${existing} 条可检查增量更新`,`${checked} checked · ${existing} available for update checks`):
      L("Reader 保存状态未核对","Reader saved state not checked.");
    $("to-target").disabled=!canTarget();updateSteps();
    const byID=new Map(summary.groups.map(g=>[g.id,g]));byID.set("",{knownCount:summary.knownCount,selectedCount:summary.selectedCount});
    for(const [id,n] of projectNodes){const g=byID.get(id);n.count.textContent=`${g.selectedCount}/${g.knownCount}`;
      n.check.checked=g.knownCount>0&&g.knownCount===g.selectedCount;n.check.indeterminate=g.selectedCount>0&&g.selectedCount<g.knownCount;
      n.check.setAttribute("aria-label",L(`选择${n.name}中已发现的 ${g.knownCount} 条`,`Select ${g.knownCount} discovered in ${n.name}`));}
    for(const o of $("source-group").options){const g=byID.get(o.value);if(g)o.textContent=`${o.value?groupName(o.value):L("全部来源项目","All source projects")} (${g.selectedCount}/${g.knownCount})`;}
  }
  function catalogue(){
    sourceBindings.clear();
    aliasNames={};aliasEdit=null;if($("project-alias").open)$("project-alias").close();
    const key=aliasKey(source),snapshot=source;
    if(key)void storage.get(key).then(saved=>{if(source===snapshot&&saved[key]){aliasNames=saved[key];patchLabels();}}).catch(()=>{});
    nextOwnerCheck=Date.now()+60000;
    unnamedGroups.clear();
    chosen.clear();page=projectPage=0;collapsed=sourceBlocked=selectedOnly=false;activeGroup="";$("project-query").value="";
    $("refresh-status").textContent="";
    $("refresh-source").hidden=source.kind!=="web";
    $("source-group").disabled=false;
    selectionModel=ReaderCenterSelection.create({source,chosen,groupName});
    const groups=selectionModel.summary().groups.map(g=>g.id);
    const validHint=source.kind==="web"&&source.scope&&source.hint&&groups.includes(source.hint);
    if(validHint){activeGroup=source.hint;projectPage=Math.floor(groups.indexOf(activeGroup)/ReaderCenterSelection.PAGE_SIZE);}
    projectList();show(1);selection();
  }
  async function clearSource(){
    sourceBindings.clear();
    nameRequest++;clearTimeout(nameTimer);aliasNames={};
    readVersion++;sourceRun++;bindingRun++;targetRun++;source=null;selectionModel=null;chosen.clear();mappings={};mappingScope="";
    refreshing=sourceBlocked=false;$("refresh-source").disabled=false;
    if($("bindings-status"))$("bindings-status").textContent="";
    if(sourceDirName){const key=sourceDirName;sourceDirName=null;await (await root).removeEntry(key,{recursive:true}).catch(()=>{});}
  }
  async function pick(file,resume=false){
    if(!file||running||reading)return;reading=true;sourceRun++;ownerChanged=false;const existing=plan;
    const version=++readVersion,check=()=>{if(version!==readVersion)throw new DOMException("Cancelled","AbortError");};
    $("source-file").disabled=$("resume-file").disabled=true;
    const name="reader-catalogue-"+crypto.randomUUID(),dir=await (await root).getDirectoryHandle(name,{create:true});
    try{
      const parsed=await ReaderLocalArchive.open(file,dir,check,display.update);check();
      if(resume&&(!existing||existing.source.kind!=="archive"||existing.source.scope!==parsed.digest))throw Error("source-changed");
      const next={...parsed,kind:"archive",scope:parsed.digest};
      // Validate the new catalogue before releasing the draft's OPFS directory.
      if(!resume)ReaderCenterSelection.create({source:next});
      const previous=sourceDirName;
      sourceDirName=name;source=next;mappings={};mappingScope="";
      if(resume){$("source-needed").hidden=$("resume-file-label").hidden=true;$("activity").textContent=L("已核实原导出包，可继续。","Original export verified. Ready to resume.");}
      else catalogue();
      if(previous)await (await root).removeEntry(previous,{recursive:true}).catch(()=>{});
    }catch(e){await (await root).removeEntry(name,{recursive:true}).catch(()=>{});throw e;}
    finally{reading=false;$("source-file").disabled=$("resume-file").disabled=false;display.flush();if(selectionModel)counts();else updateSteps();}
  }
  $("source-file").onchange=()=>work(()=>pick($("source-file").files[0]));
  $("resume-file").onchange=()=>work(()=>pick($("resume-file").files[0],true));
  $("source-group").onchange=()=>chooseGroup($("source-group").value);$("source-more").onclick=()=>{page++;selection();};$("source-prev").onclick=()=>{page=Math.max(0,page-1);selection();};
  function projectPageAt(n,restoreFocus=false){
    projectPage=n;projectList();
    // When the browsed project page changes, compact view must not show the
    // prior project's conversations under an unrelated group label.
    if(!wide.matches&&!projectNodes.has(activeGroup)){activeGroup="";page=0;collapsed=true;}
    selection();
    if(restoreFocus)(projectNodes.get(activeGroup)||projectNodes.get("")).button.focus({preventScroll:true});
  }
  $("project-prev").onclick=()=>projectPageAt(projectPage-1,true);
  $("project-next").onclick=()=>projectPageAt(projectPage+1,true);
  $("project-query").oninput=()=>projectPageAt(0);
  wide.addEventListener("change",()=>{
    if(!selectionModel||step!==1)return;
    if(!wide.matches&&!projectNodes.has(activeGroup)){
      $("project-query").value="";
      const i=selectionModel.summary().groups.findIndex(g=>g.id===activeGroup);
      projectPage=Math.max(0,Math.floor(i/ReaderCenterSelection.PAGE_SIZE));projectList();counts();
    }
    projectLayout();
  });
  $("selected-count").onclick=()=>{if(step!==1||!selectionModel)return;selectedOnly=!selectedOnly;page=0;collapsed=false;$("source-group").disabled=selectedOnly;selection();};
  function cancelRefresh(){
    if(refreshing){
      sourceBlocked=true;
      $("refresh-status").textContent=L("刷新已取消，原目录及勾选保留；请重新核实来源后继续。","Refresh cancelled. Original directory and selections retained; verify source again before continuing.");
    }
    refreshing=false;$("refresh-source").disabled=false;
  }
  $("back-source").onclick=()=>work(()=>goStep(0));
  async function current(){
    await ReaderClient.trust;const d=(await storage.get("device")).device;
    if(d?.origin!==READER_ORIGIN)return null;return d;
  }
  function rememberedTargets(saved){
    const targets={...saved};
    if(source.kind!=="web")return targets;
    // Older web catalogues keyed some groups by a URL slug. Restore an explicit
    // choice (including Unclassified), but never choose between conflicting ones.
    const byId=new Map();
    for(const [key,target] of Object.entries(saved)){
      const id=key.startsWith("project:")&&ReaderRoutes.projectId(key.slice(8));
      if(!id)continue;
      const previous=byId.get(id),value=target||"";
      byId.set(id,previous!==undefined&&previous!==value?"unavailable":value);
    }
    for(const [id,target] of byId)targets["project:"+id]=target;
    return targets;
  }
  async function targets(lookup=false){
    const n=++targetRun,snapshot=source;bindingRun++;targetsReady=false;
    $("confirm-import").disabled=$("target-mode").disabled=$("target-mappings").inert=true;
    if($("bindings-status"))$("bindings-status").textContent="";
    const owner=await current();if(n!==targetRun||step!==2||source!==snapshot)return;
    device=owner;$("mapping-tools").hidden=!device;
    $("pair-start").hidden=!!device;$("targets").hidden=!device;
    if(!device||!snapshot)return;
    const sourceScope=snapshot.scope,ownerScope=JSON.stringify([READER_ORIGIN,owner.id,owner.user,sourceScope]);
    if(mappingScope!==ownerScope){$("target-mappings").replaceChildren();projectDrafts.clear();sourceBindings.clear();}
    const caps=await (await ReaderClient.request(owner.id,"capabilities")).json();
    if(caps.protocol!==1||caps.import_profile!=="reader-chat-v1"||!caps.capture||!caps.resumable_capture)throw Error("upgrade-required");
    const loaded=await (await ReaderClient.request(owner.id,"projects")).json();
    const {destination,batchMappings=[]}=await storage.get(["destination","batchMappings"]);
    const d=await current();if(n!==targetRun||step!==2||source!==snapshot)return;
    if(d?.id!==owner.id||d.user!==owner.user)throw Error("owner-changed");
    projects=loaded.filter(p=>uuid(p.id)&&!p.default).map((p,i)=>{
      const name=ReaderRoutes.projectName(p.name,p.id);
      return {id:p.id,name,label:name||L(`名称未知的项目 ${i+1}`,`Unnamed project ${i+1}`)};
    });
    webProject=caps.web_import_project===true;
    const saved=batchMappings.find(m=>m.origin===READER_ORIGIN&&m.user===device.user&&m.source===source.scope);
    if(mappingScope!==ownerScope){
      const defaultProject=destination?.device===device.id?destination.project||"":"";mappings=saved?.targets?rememberedTargets(saved.targets):{"*":defaultProject};
      mappingScope=ownerScope;$("target-mode").value="groups";
      $("include-files").checked=destination?.device===device.id?!destination.textOnly:true;
    }
    if($("check-bindings")){$("check-bindings").hidden=!caps.source_lookup;$("check-bindings").disabled=false;
      $("check-bindings").textContent=L(`核对已选 ${chosen.size} 条的已有绑定`,`Check saved references for ${chosen.size} selected conversations`);}
    for(const [group,draft] of projectDrafts){
      if(!draft.result&&!draft.legacy)continue;
      const matches=projects.filter(p=>p.name===draft.name.trim()&&(!draft.result||p.id===draft.result));
      if(matches.length===1){mappings[group]=matches[0].id;projectDrafts.delete(group);}
      else if(draft.result)draft.note=L("项目已变更，请重新选择保存位置。","Project changed. Choose a destination again.");
    }
    targetsReady=true;$("target-mode").disabled=$("target-mappings").inert=false;
    renderTargets();
    // Choosing "Reader destination" is an explicit request to compare only the
    // selected references. Passive catalogue discovery still discloses none.
    if(lookup&&caps.source_lookup===true)await checkBindings();
  }
  function releaseProjectWindows(){
    for(const [group,draft] of projectDrafts){
      if(draft.busy||draft.legacy||draft.result)projectDrafts.set(group,{name:draft.name});
    }
  }
  async function confirmProject(group,draft){
    const owner=device,snapshot=source,scope=mappingScope,wanted=draft.name.trim();
    const live=()=>step===2&&source===snapshot&&mappingScope===scope&&device?.id===owner.id&&device.user===owner.user&&projectDrafts.get(group)===draft;
    if(!targetsReady||!wanted||Array.from(wanted).length>120||draft.busy||!live())return;
    draft.busy=true;
    try{
      const now=await current();if(!live()||now?.id!==owner.id||now.user!==owner.user)return;
      const matches=projects.filter(p=>p.name===wanted);
      if(matches.length>1){draft.note=L("有多个同名项目，请从列表选择。","Several projects share that name. Choose from the list.");return;}
      const exact=matches[0];
      if(exact&&(!draft.result||draft.result===exact.id)){mappings[group]=exact.id;projectDrafts.delete(group);renderTargets(group);return;}
      renderTargets();
      if(webProject){
        const result=await ReaderClient.confirmProject(owner,wanted);
        if(!live()||!uuid(result))return;
        draft.result=result;
      }else if(!draft.legacy){
        await chrome.tabs.create({url:READER_ORIGIN+"/"});if(!live())return;
        draft.legacy=true;
        draft.note=L(`在 Reader 侧栏新建「${wanted}」，然后返回刷新项目。`,`Create “${wanted}” in the Reader sidebar, then return and refresh projects.`);
        return;
      }
      await targets();
    }catch{
      if(live())draft.note=L("尚未核实新项目。请刷新项目核对结果，或重新打开 Reader 确认。","Project not confirmed. Refresh projects to check the result, or reopen confirmation in Reader.");
    }finally{
      draft.busy=false;
      if(live())renderTargets(group,"button[type=submit]");
      else if(step===2&&source===snapshot&&mappingScope===scope&&mappings[group]===draft.result)focusMapping(group);
    }
  }
  function focusMapping(group,selector="select"){
    const row=[...$("target-mappings").children].find(line=>line.dataset.group===group);
    row?.querySelector(selector)?.focus({preventScroll:true});
  }
  function renderTargets(focus,selector){
    mappingRevision++;
    const samples=new Map();
    for(const r of source.rows)if(chosen.has(r.id)&&!sourceBindings.get(r.id)&&!samples.has(r.group))samples.set(r.group,r.title);
    const groups=$("target-mode").value==="one"&&samples.size?["*"]:[...samples.keys()];
    $("target-mappings").replaceChildren(...groups.map((g,i)=>{
      const name=g.startsWith("project:")?projectLabel(g):"";
      const value=(Object.hasOwn(mappings,g)?mappings[g]:mappings["*"])||"";
      mappings[g]=value;
      const draft=projectDrafts.get(g),line=ReaderProjectRow({id:"mapping-"+i,name,projects,value,draft,webCreate:webProject,L,
        label:g==="*"?L("全部已选对话","All selected conversations"):groupName(g),
        sample:g.startsWith("project:")&&!name?ReaderRoutes.projectName(samples.get(g),g.slice(8)):"",
        selectValue:next=>{if(!targetsReady||!line.isConnected)return;projectDrafts.delete(g);mappings[g]=next;renderTargets(g);},
        edit:()=>{if(!targetsReady||!line.isConnected)return;projectDrafts.set(g,{name:g.startsWith("project:")?projectLabel(g):""});renderTargets(g,"input");},
        cancel:()=>{projectDrafts.delete(g);renderTargets(g);},
        submit:()=>confirmProject(g,draft)});
      line.dataset.group=g;line.sourceSample=ReaderRoutes.projectName(samples.get(g),g.slice(8));return line;
    }));
    confirmCopy();if(focus)focusMapping(focus,selector);
  }
  function confirmCopy(){
    $("confirm-import").disabled=sourceBlocked||!targetsReady||!chosen.size||!!$("target-mappings").querySelector('[data-ready="false"]');
    const n=chosen.size,updates=[...chosen].filter(id=>sourceBindings.get(id)).length,checked=[...chosen].filter(id=>sourceBindings.has(id)).length;
    $("confirm-summary").textContent=(checked?L(`${updates} 条已有对应对话，按增量更新检查；${checked-updates} 条未发现已存版本。`,`${updates} existing conversations to check for updates; ${checked-updates} without a saved reference.`):"")+
      L("已保存的对话保留在原项目。","Previously saved conversations keep their project.");
    $("confirm-import").textContent=updates===n&&n?L(`确认更新 ${n} 条对话`,`Update ${n} conversations`):
      updates?L(`确认保存 / 更新 ${n} 条对话`,`Save / update ${n} conversations`):L(`确认导入 ${n} 条对话`,`Import ${n} conversations`);
  }
  $("to-target").onclick=()=>work(()=>goStep(2));
  async function checkBindings(){
    if($("check-bindings").disabled||!targetsReady||step!==2)return;
    const snapshot=source,owner=await current(),ids=source.rows.filter(r=>chosen.has(r.id)).map(r=>r.id),n=++bindingRun;
    if(!owner||owner.id!==device?.id||owner.user!==device.user)throw Error("owner-changed");
    $("check-bindings").disabled=true;let found=0,read=0;
    const valid=async()=>{
      const now=await current();
      if(n!==bindingRun||step!==2||source!==snapshot)throw new DOMException("Cancelled","AbortError");
      if(now?.id!==owner.id||now?.user!==owner.user)throw Error("owner-changed");
    };
    try{
      for(const id of ids)sourceBindings.delete(id);
      renderTargets();
      for(const id of ids){
        await valid();
        const r=await (await ReaderClient.request(owner.id,"sources/status",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({source_id:id})})).json();
        await valid();
        if(!r||!Object.hasOwn(r,"conversation_id")||r.conversation_id!==null&&!uuid(r.conversation_id))throw Error("operation-unconfirmed");
        sourceBindings.set(id,r.conversation_id);found+=uuid(r.conversation_id)?1:0;read++;
        confirmCopy();
        $("bindings-status").textContent=L(`已核对 ${read}/${ids.length} 条；${found} 条找到绑定。绑定不代表内容一致。`,
          `Checked ${read}/${ids.length}; ${found} saved references. A reference does not prove identical content.`);
        if(read<ids.length)await new Promise(resolve=>setTimeout(resolve,200));
      }
      await valid();renderTargets();
    }finally{if(n===bindingRun)$("check-bindings").disabled=false;}
  }
  $("check-bindings").onclick=()=>work(checkBindings);
  $("target-mode").onchange=()=>{releaseProjectWindows();renderTargets();};$("reload-projects").onclick=()=>work(()=>targets(true));
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
      if(!j||!j.iid&&!j.packageReady&&!j.active&&!ReaderProgress.scheduledCheck(j)&&!["cancelled","review","result-unavailable"].includes(j.phase))
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
    const wake=await chrome.runtime.sendMessage({kind:"wake"});if(!wake?.ok)throw Error("background-unavailable");
    const r=await chrome.runtime.sendMessage({kind:"panel-host",device:plan.device,op,key,...extra});
    if(!r?.ok)throw Error(Object.hasOwn(errors,r?.error)?r.error:"operation-unconfirmed");
  }
  $("confirm-import").onclick=()=>work(async()=>{
    if(running||submitting||step!==2||$("confirm-import").disabled)return;
    submitting=true;$("confirm-import").setAttribute("aria-busy","true");updateSteps();
    try{
    const snapshot=source,epoch=targetRun,revision=mappingRevision,scope=mappingScope,d=await current();
    const stillConfirmed=()=>!sourceBlocked&&step===2&&source===snapshot&&epoch===targetRun&&revision===mappingRevision&&scope===mappingScope&&!$("confirm-import").disabled;
    if(!stillConfirmed())return;
    if(!d||d.id!==device?.id||d.user!==device.user)throw Error("owner-changed");
    const rows=source.rows.filter(r=>chosen.has(r.id)),fixed={};
    const needsDestination=new Set(rows.filter(r=>!sourceBindings.get(r.id)).map(r=>r.group));
    for(const row of rows)fixed[row.group]=needsDestination.has(row.group)?mappings[$("target-mode").value==="one"?"*":row.group]||null:null;
    const next=ReaderBatch.create({device:d,origin:READER_ORIGIN,source:{kind:source.kind,scope:source.scope,...(source.kind==="web"?{catalog:source.catalog,tab:source.tab}: {})},rows,targets:fixed,attachments:$("include-files").checked});
    next.projectLabels=Object.fromEntries([...new Set(rows.map(r=>r.group))].filter(ReaderRoutes.groupKey).map(g=>[g,groupName(g)]));
    await navigator.locks.request("reader-batch-plan",async()=>{
      const {device:now,batchPlan:previous,jobs=[]}=await storage.get(["device","batchPlan","jobs"]);
      if(now?.id!==d.id||now.user!==d.user||now.origin!==READER_ORIGIN)throw Error("owner-changed");
      if(!stillConfirmed())throw Error("source-changed");
      if(previous&&previous.id!==plan?.id)throw Error("queue-open");
      if(previous?.items.some(i=>!i.cancelled&&!i.skipped&&(!ReaderBatch.success(jobs.find(j=>j.key===i.key&&j.device===previous.device)))))throw Error("plan-retained");
      await storage.set({batchPlan:next});
    });plan=next;show(3);await renderTasks();
    // Remember only at the explicit commit boundary, never while viewing or
    // changing a mapping. A queued import retains its fixed destination.
    await navigator.locks.request("reader-device",async()=>{
      const now=await current();if(now?.id!==d.id||now.user!==d.user)throw Error("owner-changed");
      const {batchMappings=[]}=await storage.get("batchMappings");
      const old=batchMappings.find(m=>m.origin===READER_ORIGIN&&m.user===d.user&&m.source===snapshot.scope);
      const remembered={...old?.targets};
      // An update did not choose a new project: do not overwrite a remembered
      // new-import destination with null just because all selected rows exist.
      for(const group of needsDestination)remembered[group]=fixed[group];
      await storage.set({batchMappings:[...batchMappings.filter(m=>m!==old),
        {origin:READER_ORIGIN,user:d.user,source:snapshot.scope,targets:remembered}]});
    });
    await ReaderClient.rememberSources(d,rows.map(r=>r.id));
    await runQueue();
    }finally{submitting=false;$("confirm-import").removeAttribute("aria-busy");updateSteps();}
  });
  const isolatedSourceFailure=d=>d?.category==="source"&&["SOURCE_FORMAT_INVALID","SOURCE_PAGE_INVALID","SOURCE_PAGE_CHANGED","SOURCE_BRANCH_UNVERIFIED","SOURCE_ATTACHMENT_FAILED"].includes(d.code);
  async function requestReceipt(item){
    const receipt=await (await ReaderClient.request(plan.device,"requests/"+item.key)).json();
    if(!receipt||!Object.hasOwn(receipt,"id")||receipt.id!==null&&!uuid(receipt.id))
      throw Object.assign(Error("Receipt unconfirmed"),{code:"UPLOAD_RECEIPT_INVALID"});
    return receipt;
  }
  async function stage(item){
    if(!source||source.scope!==plan.source.scope)throw Error("source-needed");
    if(source.kind==="web"){
      const r=await chrome.runtime.sendMessage({kind:"batch-capture",plan:plan.id,key:item.key});
      if(!r?.ok)throw Error(r?.error||"source-changed");
      const until=Date.now()+35000;
      for(;;){
        const j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===item.key);
        if(j?.active||j?.iid||j?.packageReady)return;
        if(j?.phase==="capture-interrupted"&&isolatedSourceFailure(j.diagnostic))return false;
        if(j?.phase!=="source-starting"||Date.now()>until)throw Error("source-unavailable");
        await new Promise(r=>setTimeout(r,300));
      }
    }
    return navigator.locks.request("reader-local-"+item.key,async()=>{
      const d=await current();if(!ReaderBatch.owned(plan,d,READER_ORIGIN))throw Error("owner-changed");
      const receipt=await requestReceipt(item);
      if(uuid(receipt.id)){await journal(item,{iid:receipt.id,phase:"received",active:true});return;}
      const dir=await (await root).getDirectoryHandle(item.key,{create:true});let sealed=false,lastStep={stage:"index",done:0};
      const report=ReaderProgress.throttle(p=>{lastStep=p;display.update(p);void journal(item,{step:p}).catch(()=>{});},600);
      const check=()=>{if(ownerChanged)throw Error("owner-changed");if(stop)throw new DOMException("Paused","AbortError");};
      try{
        await journal(item,{phase:"reading",active:true,step:lastStep,diagnostic:null});
        const built=await source.build(item.id,dir,{attachments:plan.attachments,check,report:report.update});check();
        if(!ReaderBatch.owned(plan,await current(),READER_ORIGIN))throw Error("owner-changed");
        for await(const [name] of dir)if(name!=="import.zip")await dir.removeEntry(name);
        report.flush();
        await journal(item,{phase:"upload-paused",active:false,packageReady:true,partial:built.partial,losses:built.losses,
          binding:{size:built.file.size,sha256:built.sha256,project:item.project,excerpt:false},step:null});sealed=true;
      }catch(e){
        report.flush();
        const full=e.name==="QuotaExceededError"||e.message==="storage-full";
        const diagnostic=full?{category:"local-storage",stage:lastStep.stage,recovery:"free_storage"}:ReaderProgress.sourceDiagnostic(e,lastStep.stage);
        await journal(item,{phase:full?"storage-full":"capture-interrupted",active:false,step:lastStep,diagnostic});
        // Only a definitively invalid individual record can release the queue.
        // Storage, owner, file access and pause failures still affect the batch.
        if(isolatedSourceFailure(diagnostic))return false;
        throw e;
      }
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
        if(!wake?.ok)throw Error("background-unavailable");
        const jobs=(await storage.get("jobs")).jobs||[],items=ReaderBatch.candidates(plan,jobs,retry);
        for(const candidate of items){
          if(stop)break;if(!ReaderBatch.owned(plan,await current(),READER_ORIGIN))throw Error("owner-changed");
          const item=await claimItem(candidate.key);if(!item)continue;claimed=item;
          let j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===item.key);
          // A source capture or accepted server job can outlive this view.
          // Let its host reconcile the existing operation, never start a second one.
          while((j?.active||ReaderProgress.scheduledCheck(j))&&!stop){
            await renderTasks();await new Promise(r=>setTimeout(r,700));
            if(!ReaderBatch.owned(plan,await current(),READER_ORIGIN))throw Error("owner-changed");
            j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===item.key);
          }
          if(stop)break;
          if(ReaderBatch.success(j)||["review","cancelled","result-unavailable"].includes(j?.phase))continue;
          if(!j?.iid&&!j?.packageReady){
            // Even an interrupted or unknown result must query its original receipt first.
            const receipt=await requestReceipt(item);
            if(uuid(receipt.id)){await journal(item,{iid:receipt.id,phase:"received",active:true});}
            else if(await stage(item)===false)continue;
          }
          if(stop)break;
          j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===item.key);
          if(!j?.active&&!ReaderProgress.scheduledCheck(j))await command(item.key,retry?"retry":"check");
          for(;;){
            await renderTasks();j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===item.key);
            if(!j?.active&&!ReaderProgress.scheduledCheck(j))break;
            if(stop)break;await new Promise(r=>setTimeout(r,700));
            if(!ReaderBatch.owned(plan,await current(),READER_ORIGIN))throw Error("owner-changed");
          }
          // Do not pile up more packages behind an unacknowledged transfer.
          if(j?.packageReady||["upload-unknown","check","reconnect"].includes(j?.phase)){stop=true;break;}
        }
      }catch(e){
        const j=((await storage.get("jobs")).jobs||[]).find(j=>j.key===claimed?.key);
        if(j?.phase==="source-starting"&&!j.active&&!j.iid&&!j.packageReady)
          await journal(claimed,{phase:"capture-interrupted",active:false,
            diagnostic:e.code==="UPLOAD_RECEIPT_INVALID"?{category:"protocol",stage:"upload",code:e.code}:ReaderProgress.sourceDiagnostic(e)}).catch(()=>{});
        throw e;
      }finally{running=false;await savePlan({paused:true}).catch(()=>{});await renderTasks();}
    });
  }
  function stateCopy(j,item){
    if(item.skipped)return L("本次已跳过，原件未改；待核对资料保留在 Reader","Skipped in this plan; original unchanged. Review remains available in Reader.");
    if(item.cancelled&&!j?.iid)return L("未发送，已取消","Cancelled before submission");
    if(!j)return L("等待读取","Waiting to read");
    if(ReaderProgress.scheduledCheck(j))return L("等待自动核对收据","Receipt check scheduled");
    if(j.active&&j.step)return ReaderProgress.describe(j.step,zh);
    if(j.phase==="done"){
      if(j.partial||j.result?.completeness!=="complete")return L("部分保存或完整性待核对","Partially saved or completeness unverified");
      return {created:L("已新建","Saved"),unchanged:L("已存在，未更改","Already saved; unchanged"),
        appended:L(`已在末尾追加 ${j.result.added_messages} 条消息`,`${j.result.added_messages} messages appended`),
        separate_copy:L("已另存，原件未改","Saved separately; original unchanged")}[j.result.action]||L("已处理","Processed");
    }
    return {reading:L("正在读取","Reading"),"capture-interrupted":ReaderProgress.sourceReason(j.diagnostic?.code,zh)||L("读取已暂停，未发送","Reading paused; not sent"),
      "storage-full":errors["storage-full"],review:L("需要核对，尚未保存","Needs review; not saved"),
      "upload-paused":L("上传暂停，原包保留","Upload paused; original package retained"),reconnect:L("需重新授权","Reconnect required"),
      "upload-unknown":L("回执待核对","Receipt unconfirmed"),check:L("状态待核对","Status unconfirmed"),attention:L("Reader 处理失败或需要检查","Reader processing failed or needs attention"),
      "instance-limit":L("Reader 导入配额不足","Reader import allowance exceeded"),"server-storage":L("Reader 空间不足","Reader storage is full"),
      "upload-rejected":L("上传被拒绝，未保存","Upload rejected; not saved"),"resource-wait":L("等待 Reader 可用内存","Waiting for Reader memory"),
      cancelled:L("已取消","Cancelled"),"result-unavailable":L("原记录不可用","Saved record unavailable")}[j.phase]||(j.active?L("Reader 正在处理","Reader is processing"):L("需检查收据","Check receipt"));
  }
  async function renderTasks(){
    updateSteps();
    if(!plan)return;const {device:d,jobs=[]}=await storage.get(["device","jobs"]);
    if(!ReaderBatch.owned(plan,d,READER_ORIGIN)){stop=true;ownerChanged=true;$("task-rows").replaceChildren();throw Error("owner-changed");}
    const byKey=new Map(jobs.filter(j=>j.device===plan.device).map(j=>[j.key,j]));
    const category=i=>{
      const j=byKey.get(i.key);if(i.skipped||i.cancelled||["cancelled","result-unavailable"].includes(j?.phase))return "done";
      if(j?.review)return "review";
      if(j?.phase==="done")return j.partial||j.result?.completeness!=="complete"?"attention":"done";
      return !j||j.active||ReaderProgress.scheduledCheck(j)||j.phase==="source-starting"?"waiting":"attention";
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
        const label=ReaderRoutes.projectName(plan.projectLabels?.[item.group],item.group.slice(8));
        copy.append(el("div",item.title,"title"),el("div",[label,stateCopy(j,item)].filter(Boolean).join(" · "),"meta"));
        const actual=j?.result?.current_project;
        if(actual)copy.append(el("div",L("实际保存位置：","Saved destination: ")+(actual.state==="project"?
          ReaderRoutes.projectName(actual.name,actual.id)||L("项目名称未知","Project name unavailable"):
          actual.state==="unclassified"?L("未分类","Unclassified"):L("项目不可用","Project unavailable")),"meta"));
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
            if(!fresh?.review||fresh.active||fresh.review.receipt!==r.receipt)throw Error("review-changed");
            // This dismisses only this plan item. It cannot cancel a server job or delete its source.
            await changeItems(items=>items.map(i=>i.key===item.key?{...i,skipped:true}:i));await renderTasks();
          }));
        }else if(j&&!j.active&&!ReaderBatch.success(j)&&!item.cancelled&&!item.skipped){if(!ReaderProgress.scheduledCheck(j)&&!isolatedSourceFailure(j.diagnostic)){
          const b=btn(L("检查原收据","Check original receipt"),async()=>{await command(item.key);await renderTasks();});b.dataset.action="check";actions.append(b);}
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
    $("resume-box").hidden=!plan;updateSteps();
  }
  $("resume-plan").onclick=()=>work(async()=>{show(3);await renderTasks();await chrome.runtime.sendMessage({kind:"wake"});});
  $("forget-plan").onclick=()=>work(async()=>{
    if(running||!plan)return;
    const jobs=(await storage.get("jobs")).jobs||[];
    if(plan.items.some(i=>!i.skipped&&ReaderBatch.pending(jobs.find(j=>j.key===i.key))))throw Error("unfinished-imports");
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
      throw Error("pending-items");
    await storage.remove("batchPlan");plan=null;await clearSource();show(0);await resumeBox();
  });
  async function chooseWeb(container,accept){
    const n=++sourceRun,atStep=step;let discovery=0;
    const check=()=>{if(n!==sourceRun||step!==atStep)throw new DOMException("Cancelled","AbortError");};
    const r=await chrome.runtime.sendMessage({kind:"batch-tabs"});check();if(r?.error)throw Error(r.error);
    const tabs=[...(r?.tabs||[])].sort((a,b)=>Number(b.id===tabHint)-Number(a.id===tabHint));
    container.hidden=false;container.replaceChildren(...tabs.map(tab=>btn((tab.title||"ChatGPT")+(tab.id===tabHint?L(" · 从此标签页打开"," · Opened from this tab"):""),async()=>{
      check();const choice=++discovery,result=await chrome.runtime.sendMessage({kind:"batch-discover",tab:tab.id});check();
      if(choice!==discovery)throw new DOMException("Cancelled","AbortError");
      if(result?.error)throw Error(result.error);
      if(!result?.rows)throw Error("source-changed");await accept({...result,kind:"web",tab:tab.id});container.hidden=true;
    })));
    if(!container.children.length)container.textContent=L("先打开已登录的 ChatGPT 私人页面，再重试。","Open a signed-in private ChatGPT page, then retry.");
  }
  $("web-source").onclick=()=>work(()=>chooseWeb($("web-tabs"),async result=>{
    ReaderCenterSelection.create({source:result});
    const previous=sourceDirName;sourceDirName=null;readVersion++;bindingRun++;targetRun++;mappings={};mappingScope="";
    source=result;catalogue();if(!source.scope)failure(Error("scope-unverified"));
    if(previous)await (await root).removeEntry(previous,{recursive:true}).catch(()=>{});
  }));
  $("refresh-source").onclick=()=>work(async()=>{
    if(refreshing||source?.kind!=="web"||step!==1)return;
    const before=source,n=++sourceRun;refreshing=true;$("refresh-source").disabled=true;counts();
    $("refresh-status").textContent=L("正在重新核实已发现目录…","Rechecking discovered directory…");
    try{
      const result=await chrome.runtime.sendMessage({kind:"batch-discover",tab:before.tab});
      if(n!==sourceRun||step!==1||source!==before)throw new DOMException("Cancelled","AbortError");
      if(result?.error)throw Error(result.error);
      const next={...result,kind:"web",tab:before.tab};
      if(!next.scope||next.scope!==before.scope)throw Error("source-changed");
      const changed=selectionModel.refreshSource(next);source=next;sourceBlocked=false;bindingRun++;targetRun++;
      const groups=selectionModel.summary().groups;
      if(!groups.some(g=>g.id===activeGroup))activeGroup="";
      if(!wide.matches&&activeGroup){$("project-query").value="";projectPage=Math.floor(groups.findIndex(g=>g.id===activeGroup)/ReaderCenterSelection.PAGE_SIZE);}
      projectList();selection();
      $("refresh-status").textContent=changed.removedCount?
        L(`已保留 ${changed.retainedCount} 条勾选；${changed.removedCount} 条因不再发现或归属改变而移出，请核对。`,
          `${changed.retainedCount} selections retained; ${changed.removedCount} removed because no longer discovered or membership changed. Review before continuing.`):
        L(`目录已刷新，保留 ${changed.retainedCount} 条勾选；新发现项未自动勾选。`,
          `Directory refreshed; ${changed.retainedCount} selections retained. New discoveries are not selected automatically.`);
    }catch(e){
      if(e.name!=="AbortError"){
        sourceBlocked=true;$("refresh-status").textContent=L("刷新未完成，原目录及勾选保留；核实来源后再继续。","Refresh incomplete. Original directory and selections retained; verify source before continuing.");
      }
      throw e;
    }finally{
      if(n===sourceRun){refreshing=false;$("refresh-source").disabled=false;counts();scheduleNames();}
    }
  });
  $("restore-web").onclick=()=>work(()=>chooseWeb($("resume-web-tabs"),async result=>{
    if(result.scope!==plan.source.scope)throw Error("source-changed");
    await clearSource();source=result;await savePlan({source:{...plan.source,catalog:result.catalog,tab:result.tab}});await renderTasks();
  }));
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=="local")return;
    if(changes.device&&(changes.device.oldValue?.id!==changes.device.newValue?.id||changes.device.oldValue?.user!==changes.device.newValue?.user)){
      sourceRun++;cancelRefresh();projectDrafts.clear();sourceBindings.clear();mappingScope="";targetsReady=false;
      $("target-mappings").replaceChildren();
      stop=true;ownerChanged=true;if(step===3)work(renderTasks);else if(step===2)work(targets);else if(step===1)counts();}
    if(changes.jobs&&step===3)work(renderTasks);
  });
  addEventListener("pagehide",()=>{stop=true;sourceRun++;readVersion++;nameRequest++;clearTimeout(nameTimer);clearInterval(pairTimer);clearInterval(taskTimer);
    if(sourceDirName)void root.then(r=>r.removeEntry(sourceDirName,{recursive:true})).catch(()=>{});
  });
  show(0);work(resumeBox);
  taskTimer=setInterval(()=>{if(step===3&&!running)work(renderTasks);},3000);
})();
