// Read-only presentation of an already sanitized task. No fetch, account IDs,
// filenames, source text or private task identifiers belong in this component.
globalThis.ReaderProgressView = ({zh=false}={}) => {
  const L=(a,b)=>zh?a:b,el=(tag,cls="",copy="")=>{const n=document.createElement(tag);n.className=cls;n.textContent=copy;return n;};
  const root=el("section","reader-progress-view"),headline=el("p","progress-headline"),list=el("dl","progress-rows"),elapsed=el("p","progress-elapsed");
  const current=el("div","progress-current"),currentText=el("p"),meter=el("progress"),failureStage=el("p","progress-failure-stage"),recovery=el("p","progress-recovery");
  current.hidden=true;meter.hidden=true;meter.setAttribute("aria-label",L("当前附件读取进度","Current file reading progress"));
  current.append(currentText,meter);
  root.setAttribute("aria-label",L("保存进度","Save progress"));headline.setAttribute("role","status");
  const rows=new Map();
  for(const [key,label] of [
    ["source",L("读取来源","Read source")],["index",L("核对会话","Verify conversation")],
    ["messages",L("转换正文","Convert messages")],["asset",L("读取附件","Read files")],
    ["package",L("生成导入包","Build archive")],["upload",L("上传到 Reader","Upload to Reader")],
    ["server",L("服务端导入","Reader import")]
  ]){const line=el("div"),term=el("dt","",label),value=el("dd");line.dataset.stage=key;line.append(term,value);list.append(line);rows.set(key,{line,value});}
  failureStage.hidden=true;root.append(headline,list,current,elapsed,failureStage,recovery);
  const size=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KiB`:`${(n/1048576).toFixed(1)} MiB`;
  const number=v=>Number.isSafeInteger(v)&&v>=0;
  function update({step,stats,startedAt,finishedAt,state,diagnostic,taskPhase}={}){
    const values=ReaderProgress.accumulate(null,stats),phase=ReaderProgress.snapshot(step),pending=L("等待","Waiting");
    const stopped=["saved","copy","partial","failed","review","uncertain","paused","cancelled","reconnect","previous","append-ready","append-complete","append-partial","append-review","append-processed","system-hold"].includes(state);
    const measured=(key,unit="")=>number(values[key])?values[key]+unit:pending;
    const bytes=key=>number(values[key])?size(values[key]):pending;
    const read=number(values.sourceBytes)||number(values.assetBytes);
    headline.textContent=read?L("来源累计读取 ","Source bytes read ")+size((values.sourceBytes||0)+(values.assetBytes||0)):"";
    rows.get("source").value.textContent=bytes("sourceBytes")+(number(values.sourcePages)?L(` · ${values.sourcePages} 页`,` · ${values.sourcePages} pages`):"");
    rows.get("index").value.textContent=measured("indexedNodes",L(" 个节点"," nodes"));
    rows.get("messages").value.textContent=measured("messageCount",L(" 条"," messages"))+(number(values.textBytes)?" · "+bytes("textBytes"):"");
    let files=number(values.filesSucceeded)?L(`${values.filesSucceeded} 已读取`,`${values.filesSucceeded} read`):pending;
    if(number(values.filesTotal))files+=L(` / 共 ${values.filesTotal} 个`,` / ${values.filesTotal} files`);
    else if(number(values.filesDiscovered))files+=L(` · 已发现 ${values.filesDiscovered} 个`,` · ${values.filesDiscovered} discovered`);
    if(values.filesFailed)files+=L(` · ${values.filesFailed} 未取得`,` · ${values.filesFailed} unavailable`);
    if(values.unresolvedResources)files+=L(` · ${values.unresolvedResources} 个未解析资源提示`,` · ${values.unresolvedResources} unresolved resource hints`);
    if(number(values.assetBytes))files+=" · "+bytes("assetBytes");
    rows.get("asset").value.textContent=files;
    rows.get("package").value.textContent=bytes("packageBytes");
    rows.get("upload").value.textContent=number(values.uploadBytes)?bytes("uploadBytes")+(number(values.packageBytes)?" / "+bytes("packageBytes"):""):pending;
    rows.get("server").value.textContent=state==="append-ready"?L("已接收所选内容 · 等待 Reader 确认","Selection received · awaiting confirmation in Reader"):
      state==="append-complete"?L("已确认追加","Append confirmed"):
      state==="append-partial"?L("已确认追加可用内容 · 缺件记录保留","Available content appended · unavailable files recorded"):
      state==="append-processed"?L("已处理 · 原收据无完整性明细","Processed · this receipt has no completeness details"):
      state==="append-review"?L("追加需要重新核对 · 原勾选保留","Review append again · original selection retained"):
      state==="system-hold"?L("处理已停止 · 保留原任务供修复","Processing stopped · original task retained for repair"):
      ["saved","copy","partial"].includes(state)?
      state==="partial"?L("部分内容已保存","Available content saved"):L("已确认保存","Save confirmed"):
      state==="failed"?L("尚未完成 · 诊断已保留","Incomplete · diagnostics retained"):
      state==="uncertain"?L("结果待核对","Result unconfirmed"):
      state==="review"?L("等待核对所选内容或变更","Review selected content or changes"):
      state==="cancelled"?L("已取消 · 记录已保留","Cancelled · measurements retained"):
      state==="paused"?L("已暂停 · 可继续原任务","Paused · original task can resume"):
      state==="reconnect"?L("授权需重新连接","Reconnect authorization"):
      state==="previous"?L("已存版本 · 本次完整性待核对","Saved version · completeness unverified"):
      number(values.serverProgress)?L(`处理中 · ${values.serverProgress}%`,`Processing · ${values.serverProgress}%`):pending;
    const activeStage=["received","processing","queued","resource-wait"].includes(taskPhase)?"server":phase?.stage;
    if(!stopped&&taskPhase==="resource-wait")rows.get("server").value.textContent=L("已接收 · 等待可用资源","Received · waiting for available resources");
    else if(!stopped&&taskPhase==="received")rows.get("server").value.textContent=L("已接收 · 等待处理","Received · awaiting processing");
    for(const [key,{line}] of rows)line.dataset.active=String(!stopped&&activeStage===key);
    current.hidden=stopped||activeStage!=="asset";
    if(!current.hidden){
      currentText.textContent=L("当前附件","Current file")+(phase.files?" "+phase.files:"")+
        (number(phase.done)?" · "+size(phase.done):"")+(phase.total?" / "+size(phase.total):"");
      meter.hidden=!phase.total;if(phase.total){meter.max=phase.total;meter.value=phase.done||0;}
    }
    const reason=ReaderProgress.diagnostic(diagnostic);
    const stages={source:["读取来源","Read source"],index:["核对会话","Verify conversation"],messages:["转换正文","Convert messages"],
      asset:["读取附件","Read files"],package:["生成导入包","Build archive"],upload:["上传到 Reader","Upload to Reader"],
      admission:["服务端接收","Server admission"],analysis:["分析导入内容","Analyze import"],archive:["检查导入包","Check archive"],
      commit:["写入 Reader","Commit in Reader"],file:["处理文件","Process file"],grouping:["分组","Group messages"],
      mapping:["匹配数据","Map data"],normalization:["规范化内容","Normalize content"],validation:["验证内容","Validate content"],server:["服务端处理","Server processing"]};
    failureStage.hidden=!(stopped&&reason?.stage&&stages[reason.stage]);
    failureStage.textContent=failureStage.hidden?"":L("停止阶段：","Stopped at: ")+L(...stages[reason.stage]);
    recovery.textContent=stopped&&reason?.recovery?({
      system_support:L("系统处理异常。请保留原任务；重复提交同一个包不能解决问题，可复制诊断供修复。",
        "A system processing issue needs repair. Keep the original task; resubmitting the same archive will not fix it. Diagnostics are available to copy."),
      retry_existing:L("可继续原任务，系统会先核对已有收据。","Resume the original task; Reader checks its existing receipt first."),
      free_storage:L("可用空间不足。释放空间后再继续原任务。","Storage is insufficient. Free space before resuming the original task."),
      reconnect:L("请重新连接 Reader 后核对原任务。","Reconnect to Reader, then check the original task."),
      review_in_reader:L("请在 Reader 中核对原任务和追加目标。","Review the original task and append destination in Reader.")
    })[reason.recovery]:"";
    if(number(startedAt)&&startedAt>0){
      const end=number(finishedAt)&&finishedAt>=startedAt?finishedAt:Date.now();
      elapsed.textContent=L("耗时 ","Elapsed ")+(Math.max(0,end-startedAt)/1000).toFixed(1)+" s";
    }else elapsed.textContent="";
    return values;
  }
  return {root,update};
};
// Only explicit canonical completion is success. Receipt accepted, processing
// 100%, and old records without completeness remain separate states.
ReaderProgressView.stateForJob=j=>{
  if(j.phase==="done")return j.partial||j.result?.completeness==="partial"||Object.values(j.losses||{}).some(Number)?"partial":
    j.result?.completeness==="complete"?"saved":"uncertain";
  if(j.phase==="append-complete")return !j.appendResult?"append-processed":
    j.appendResult.partial||j.partial||Object.values(j.losses||{}).some(Number)?"append-partial":"append-complete";
  if(j.phase==="append-attention"&&j.diagnostic?.recovery==="review_in_reader")return "append-review";
  if(j.diagnostic?.recovery==="system_support"&&!j.active)return "system-hold";
  if(j.phase==="append-ready")return "append-ready";
  if(j.phase==="review")return "review";
  if(j.phase==="cancelled")return "cancelled";
  if(j.active)return "saving";
  if(j.phase==="reconnect")return "reconnect";
  if(j.phase==="upload-paused"||j.packageReady)return "paused";
  if(["check","upload-unknown","result-unavailable"].includes(j.phase))return "uncertain";
  return "failed";
};
