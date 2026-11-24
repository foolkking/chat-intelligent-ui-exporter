// Completion, transport progress and completeness are different facts.
function policyText(p){
  if(!p)return "";
  return [p.attachments==="include"?L("包含附件文件","Includes attachment files"):L("仅附件信息","Attachment metadata only"),
    p.continuation==="auto"?L("自动纳入接续信息","Includes available continuation"):L("不含接续信息","No continuation"),
    L("可含个人批注和笔记","May include personal notes")].join(" · ");
}
function jobLabel(j){
  const r=j.result;
  if(j.mode==="append"&&j.phase==="append-ready")return L("所选消息已接收 · 等待确认追加","Selected messages received · review append");
  if(j.mode==="append"&&j.phase==="append-complete")return L("追加已处理","Append processed");
  if(j.mode==="append"&&j.phase==="append-attention")return L("追加需要核对","Append needs attention");
  if(j.phase==="done"){
    if(r?.completeness==="partial"||j.partial||Object.values(j.losses||{}).some(Number))return L("部分已保存","Partially saved");
    if(!r||r.completeness!=="complete")return L("已处理，完整性待核对","Processed · completeness unverified");
    return {created:L("已新建对话","Conversation saved"),unchanged:L("已存在，未作更改","Already saved · no changes"),
      appended:L(`已追加 ${r.added_messages} 条消息`,`${r.added_messages} new message${r.added_messages===1?"":"s"} appended`),
      separate_copy:L("已另存副本，原件未改","Copy saved · original unchanged")}[r.action]||L("已处理，请在 Reader 核对","Processed · check in Reader");
  }
  return {reading:L("正在读取当前对话","Reading conversation"),uploading:L("正在上传","Uploading"),received:L("已接收，等待处理","Received · waiting"),
    processing:L("正在保存…","Saving…"),queued:L("正在保存…","Saving…"),"resource-wait":L("已接收，等待可用内存","Received · waiting for memory"),
    review:L("保存前需确认","Review before saving"),"capture-interrupted":L("读取中断，未发送","Capture interrupted · not sent"),
    "storage-full":L("临时空间不足，未发送","Storage full · not sent"),"capture-limit":L("超过单次采集上限，未发送","Capture limit exceeded · not sent"),"upload-unknown":L("上传结果待核对","Upload receipt unconfirmed"),
    "upload-rejected":L("上传被拒绝，未导入","Upload rejected · not saved"),reconnect:L("请重新连接 Reader","Reconnect to Reader"),
    attention:L("需要检查导入任务","Import needs attention"),cancelled:L("任务已取消","Import cancelled"),
    "result-unavailable":L("已处理，原对话不可用","Processed · conversation unavailable"),check:L("状态待核对","Status unconfirmed")}[j.phase]||L("等待处理","Pending");
}
function incomplete(j){return j.result?.completeness==="partial"||j.partial||Object.values(j.losses||{}).some(Number);}
function warn(j){return incomplete(j)||!!j.review||!j.active&&!["done","cancelled","append-ready","append-complete"].includes(j.phase);}
const mustResolve=j=>j.active||!!j.review||["check","reconnect","upload-unknown"].includes(j.phase);
function boxFor(copy,iconName,warning,key){
  const box=node("details","job"),sum=node("summary"),body=node("div","job-body");box.dataset.key=key;box.dataset.tone=warning?"warning":"plain";
  sum.append(glyph(iconName),node("span","",copy),glyph("chevron"));box.append(sum,body);return {box,body};
}
function lossText(loss){
  const out=[];for(const [k,cn,en] of [["files","文件提示","file warnings"],["interactions","交互","interactions"],["links","外链","links"]]){
    if(loss?.[k]>0)out.push(L(`${cn} ${loss[k]}`,`${loss[k]} ${en}`));}
  return out.join(" · ");
}
function taskBox(j){
  const r=j.result,current=r?.current_project,where=current?projectName(current):"";
  const {box,body}=boxFor(jobLabel(j)+(where?" · "+where:""),warn(j)?"warning":j.phase==="done"?"ok":"clock",warn(j),j.key);
  if(j.mode==="append"&&uuid(j.iid)&&["append-ready","append-attention","append-complete"].includes(j.phase)){
    body.append(btn(j.phase==="append-complete"?L("查看追加结果","View append result"):L("在 Reader 核对","Review in Reader"),async()=>{
      await session();const {jobs=[],device:current}=await storage.get(["jobs","device"]);
      if(current?.id!==j.device||!jobs.some(x=>x.key===j.key&&x.device===current.id&&x.mode==="append"&&x.iid===j.iid))throw Error(L("设备已切换","Device changed"));
      await chrome.tabs.create({url:READER_ORIGIN+"/append-imports/"+j.iid});
    }));
    if(j.phase!=="append-complete")body.append(btn(L("核对任务状态","Check task status"),()=>cmd({op:"check",key:j.key})));
  }else if(j.phase==="done"&&j.cid){
    if(incomplete(j))body.append(node("p","",L("只存入了可用内容。","Only available content was saved.")+
      (lossText(j.losses)?" "+lossText(j.losses):"")+" "+L("可从原页面重新检查。","You can check again on the source page.")));
    if(r&&incomplete(j)){
      const action={created:L("已新建对话","New conversation"),unchanged:L("原件未改","Original unchanged"),
        appended:L(`已追加 ${r.added_messages} 条消息`,`${r.added_messages} messages appended`),separate_copy:L("已另存副本","Saved as a copy")}[r.action];
      if(action)body.append(node("p","",action));
    }
    if(r?.saved_project&&current&&JSON.stringify(r.saved_project)!==JSON.stringify(current))
      body.append(node("p","",L("保存时：","Saved to: ")+projectName(r.saved_project)+L("；现在："," · Now: ")+where));
    body.append(link(j.title||L("打开 Reader 对话","Open conversation in Reader"),j.cid));
  }else if(j.review){
    const v=j.review;
    if(v.partial)body.append(node("p","",L("部分资源未能保留。可从原页重试，或只保存可用内容。","Some resources are missing. Retry from the source, or save available content.")+" "+lossText(j.losses)));
    if(v.live_share)body.append(node("p","",L("新增消息会对现有整条实时分享的读者可见。","Readers of the existing live share will see the new messages.")));
    if(v.action==="conflict")body.append(node("p","",L("分支或 Reader 原件已改变。另存不会改写原件。","The branch or saved content changed. A separate copy leaves the original intact.")));
    if(v.conversation_id)body.append(link(L("查看原件","View original"),v.conversation_id));
    body.append(btn(v.action==="conflict"?L("另存一份","Save separate copy"):v.partial?L("只保存可用内容","Save available content"):L("确认保存","Confirm save"),
      ()=>cmd({op:"check",key:j.key,decision:{receipt:v.receipt,accept_partial:v.partial,accept_share:v.live_share,separate:v.action==="conflict"}})));
  }else if(["storage-full","capture-interrupted","upload-rejected","capture-limit"].includes(j.phase)){
    body.append(node("p","",j.phase==="storage-full"?L("释放浏览器临时空间后，从原对话重试。","Free temporary browser space, then retry from the source."):
      j.phase==="capture-limit"?L("未发送此版本。请在 Reader 手动导入来源文件。","This version was not sent. Import the source file in Reader."):
      L("没有保存此版本。请核对来源和目标后，从原对话重试。","This version was not saved. Check the source and destination before retrying.")));
  }else if(j.phase==="reconnect"){body.append(btn(L("打开设置","Open settings"),()=>{if(!$("settings").open)settings($("settings-label"));}));}
  else if(!j.active&&!["cancelled","result-unavailable"].includes(j.phase)){body.append(btn(L("检查原收据","Check original receipt"),()=>cmd({op:"check",key:j.key})));}
  else if(j.active){body.append(node("p","",j.phase==="reading"?L("请保留来源标签页，直到 Reader 接收。","Keep the source tab open until Reader receives the import."):L("可以关闭侧栏，已接收的任务会继续。","You can close the panel; received work continues in Reader.")));}
  if(warn(j)&&!mustResolve(j))body.append(btn(L("收起提醒","Dismiss notice"),async()=>{
    await session();const {seenWarnings=[]}=await storage.get("seenWarnings");
    await storage.set({seenWarnings:[...seenWarnings.filter(k=>k!==j.key),j.key].slice(-16)});
    focus($("history").open?$("history").querySelector(".dismiss"):$("settings-label"));
  }));
  return box;
}
function exportBox(ex){
  const {box,body}=boxFor(ex.aid?L("上下文包已生成","Context package ready"):L("正在生成上下文包","Preparing context package"),"download",false,"export");
  if(ex.policy)body.append(node("p","",policyText(ex.policy)));
  if(ex.aid)body.append(btn(L("下载 .context.zip","Download .context.zip"),()=>download(ex.aid)));
  else if(!ex.id)body.append(btn(L("核对导出请求","Check export request"),()=>startExport(ex.cid)));
  body.append(btn(L("收起","Dismiss"),()=>storage.remove("exportJob")));return box;
}
function updateBoxes(el,items,make,signature){
  if(el._signature===signature)return;
  const expanded=new Set([...el.querySelectorAll("details[open]")].map(d=>d.dataset.key));
  const prev=document.activeElement,owned=el.contains(prev),key=owned&&prev.closest("details")?.dataset.key;
  const boxes=items.map(make);for(const b of boxes)b.open=expanded.has(b.dataset.key);
  el.replaceChildren(...boxes);el._signature=signature;
  if(owned&&document.activeElement===document.body){const b=boxes.find(v=>v.dataset.key===key);focus(b?.querySelector("summary")||$("settings-label"));}
}
let jobsRender=0;
async function renderJobs(history=false){
  const seq=++jobsRender;const {jobs=[],exportJob,seenWarnings=[]}=await storage.get(["jobs","exportJob","seenWarnings"]);if(!device||seq!==jobsRender)return;
  const list=jobs.filter(j=>j.device===device.id).reverse(),ex=exportJob?.device===device.id?exportJob:null;
  const pending=list.find(mustResolve),notice=list.find(j=>warn(j)&&!seenWarnings.includes(j.key));
  const flash=["done","append-ready"].includes(list[0]?.phase)&&!seenWarnings.includes(list[0].key)&&Date.now()-(list[0].settledAt||0)<6000?list[0]:null;
  const top=pending||(!ex||ex.aid?flash:null)||notice||ex;
  const current=top?[top]:[];
  const make=j=>j===ex?exportBox(j):taskBox(j);
  updateBoxes($("jobs"),current,make,JSON.stringify(current));
  if(history||$("history").open){const all=[...(ex?[ex]:[]),...list];updateBoxes($("past"),all,make,JSON.stringify(all));
    if(!all.length)$("past").textContent=L("还没有任务。","No tasks yet.");}
  if(flash&&flash===top)setTimeout(()=>renderJobs().catch(showError),6100);
}
