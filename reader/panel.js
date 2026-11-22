/* global READER_ORIGIN, ReaderClient */
const $=id=>document.getElementById(id),zh=navigator.language.startsWith("zh"),loc=(c,e)=>zh?c:e;
document.documentElement.lang=zh?"zh-CN":"en";
const txt=(id,cn,en)=>$(id).textContent=loc(cn,en);
txt("connect","登录并连接 Reader","Connect to Reader");txt("settings-label","账号与设备","Account and device");
txt("disconnect","断开此设备","Disconnect this device");txt("target-label","新对话保存到","Save new chats to");
txt("choose","确认目标","Confirm destination");txt("chats","对话","Conversations");txt("files","文件","Files");
txt("find","搜索","Search");txt("filter-label","浏览范围","Browse scope");txt("more","加载更多","Load more");
$("q").placeholder=loc("搜索 Reader 资料","Search Reader");$("q").setAttribute("aria-label",$("q").placeholder);
$("instance").textContent=READER_ORIGIN;const storage=chrome.storage.local;
const btn=(label,action,cls="")=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.className=cls;b.onclick=()=>run(b,action);return b;};
function link(title,cid,aid){if(!uuid(cid)||aid&&!uuid(aid))throw Error("Invalid Reader link");const a=document.createElement("a");a.textContent=title;
  a.href=READER_ORIGIN+"/conversations/"+cid+(aid?"?files=open&attachmentId="+aid:"");a.target="_blank";a.rel="noopener noreferrer";return a;}
const uuid=s=>typeof s==="string"&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(s);
const option=(v,label)=>new Option(label,v);
let device,projects=[],mode="chats",offset=0,epoch=0,jobsKey="",lastFilter="";
const session=async()=>{const v=(await storage.get("device")).device;if(!device||v?.id!==device.id)throw Error(loc("账号已改变，请重新打开侧栏。","Account changed; reopen the panel."));return v;};
async function req(p,opts){await session();return ReaderClient.request(device.id,p,opts);}
const json=async(p,opts)=>(await req(p,opts)).json();
async function run(b,fn){if(b.disabled)return;b.disabled=true;$("error").textContent="";try{await fn();}catch(e){$("error").textContent=e.message;}finally{b.disabled=false;}}
const wake=async()=>{const r=await chrome.runtime.sendMessage({kind:"wake"});if(!r?.ok)throw Error("Reader transfer unavailable");};
const cmd=async(fields)=>{await session();await wake();const r=await chrome.runtime.sendMessage({kind:"panel-host",device:device.id,...fields});if(!r?.ok)throw Error(r?.error||"Reader task unavailable");};
async function startExport(cid){
  return navigator.locks.request("reader-export-request",async()=>{
  const saved=(await storage.get("exportJob")).exportJob;
  if(saved?.device===device.id&&saved.cid!==cid&&!saved.aid)throw Error(loc("请先完成当前上下文导出。","Finish the current export first."));
  const key=saved?.device===device.id&&saved.cid===cid&&!saved.aid?saved.key:crypto.randomUUID(),owner=device.id;
  await storage.set({exportJob:{cid,key,device:owner}}); // Recover after close or a lost POST using exactly this key.
  const job=await json(`conversations/${cid}/context`,{method:"POST",headers:{"Idempotency-Key":key}});
  await session();await storage.set({exportJob:{cid,key,device:owner,id:job.id}});await renderJobs();
  });
}
async function download(aid){await cmd({op:"download",aid});}
async function renderJobs(){
  const {jobs=[],exportJob}=await storage.get(["jobs","exportJob"]);
  if(!device)return;
  const list=jobs.filter(j=>j.device===device.id).reverse(),ex=exportJob?.device===device.id?exportJob:null;
  const sig=JSON.stringify([list,ex,zh]);if(sig===jobsKey)return;jobsKey=sig;
  const div=$("jobs"),wasOpen=div.querySelector("details")?.open;div.replaceChildren();
  const history=document.createElement("details");history.open=!!wasOpen;const summary=document.createElement("summary");
  summary.textContent=loc(`其他导入任务（${list.length-1}）`,`Other imports (${list.length-1})`);history.append(summary);
  const phases={reading:["正在读取当前对话","Reading the selected conversation"],"capture-interrupted":["读取中断，未发送。请重新打开原对话并保存。","Capture interrupted; nothing was sent. Reopen the source and save again."],
    "storage-full":["浏览器临时空间不足，未发送。释放空间后从原对话重试。","Not enough temporary browser space. Nothing was sent. Free space and retry from the source."],
    uploading:["正在上传","Uploading"],received:["已接收，等待处理","Received; waiting"],processing:["正在处理","Processing"],
    queued:["正在写入 Reader","Saving in Reader"],"resource-wait":["已接收，等待可用内存","Waiting for memory"],done:["已存入 Reader","Saved to Reader"],
    review:["保存前需确认","Review before saving"],attention:["需要在 Reader 检查导入任务","Review the import in Reader"],
    reconnect:["授权失效，请重新连接","Authorization expired; reconnect"],"upload-rejected":["上传被拒绝，未导入","Upload rejected; not imported"],
    "upload-unknown":["上传结果未知，请先检查回执","Upload uncertain; check receipt first"],check:["状态未确认","Status unknown"]};
  for(const j of list){
    const box=document.createElement("div");box.className="job";const p=document.createElement("p");
    p.textContent=loc(...(phases[j.phase]||["等待处理","Pending"]));box.append(p);
    if(j.cid){box.append(link(j.title||loc("阅读已保存的对话","Read saved conversation"),j.cid),btn(loc("导出上下文","Export context"),()=>startExport(j.cid)));}
    else if(j.review){
      const r=j.review,info=document.createElement("p");info.textContent=[
        r.partial?loc(`未完整保留：文件提示 ${j.losses?.files||0}、交互 ${j.losses?.interactions||0}、外链 ${j.losses?.links||0}。可返回原对话重新保存，或只保存可用内容。`,`Not fully preserved: file warnings ${j.losses?.files||0}, interactions ${j.losses?.interactions||0}, links ${j.losses?.links||0}. Retry from the source or save available content.`):"",
        r.live_share?loc("追加的内容将对现有整条实时分享的读者可见。","Existing live-share readers will see the appended messages."):"",
        r.action==="conflict"?loc("分支或本地内容已改变；原对话不会被覆盖。","The branch or local content changed; the original will not be overwritten."):""].filter(Boolean).join(" ");
      box.append(info);
      if(r.conversation_id)box.append(link(loc("已有对话","Existing conversation"),r.conversation_id));
      box.append(btn(r.action==="conflict"?loc("另存一份","Save separate copy"):loc("确认保存","Confirm save"),
        ()=>cmd({op:"check",key:j.key,decision:{receipt:r.receipt,accept_partial:r.partial,accept_share:r.live_share,separate:r.action==="conflict"}})));
    }else if(!j.active&&!["upload-rejected","capture-interrupted","storage-full"].includes(j.phase))box.append(btn(loc("检查状态","Check status"),()=>cmd({op:"check",key:j.key})));
    (j===list[0]?div:history).append(box);
  }
  if(list.length>1)div.append(history);
  if(ex){
    const box=document.createElement("div");box.className="job";
    box.append(document.createTextNode(ex.aid?loc("上下文包已生成 ","Context package ready "):loc("正在生成上下文包 ","Preparing context package ")));
    if(ex.aid)box.append(btn(loc("下载 .context.zip","Download .context.zip"),()=>download(ex.aid)));
    else if(!ex.id)box.append(btn(loc("核对导出请求","Recover export request"),()=>startExport(ex.cid)));
    box.append(btn(loc("收起","Dismiss"),()=>storage.remove("exportJob"),"quiet"));div.append(box);
  }
}
let exportPolling=false;
async function pollExport(){
  if(!device||exportPolling)return;exportPolling=true;
  try{const {exportJob:j}=await storage.get("exportJob");if(!j?.id||j.aid||j.device!==device.id)return;
    const s=await json("exports/"+j.id);await session();
    if((await storage.get("exportJob")).exportJob?.id!==j.id)return;
    if(s.status==="committed"&&s.artifact_id){await navigator.locks.request("reader-export-request",async()=>{
      const latest=(await storage.get("exportJob")).exportJob;
      if(latest?.id!==j.id||latest.aid)return;
      await session();await storage.set({exportJob:{...j,aid:s.artifact_id}});await download(s.artifact_id);
    });}
    else if(["failed","canceled","cancelled"].includes(s.status)){await storage.remove("exportJob");throw Error(loc("导出未完成，可以重试。","Export failed; retry."));}
  }catch(e){$("error").textContent=e.message;}finally{exportPolling=false;}
}
function row(item){
  const li=document.createElement("li"),r=document.createElement("div");r.className="row";li.append(r);
  const file=mode==="files",cid=file?item.conversation_id:item.id;
  const a=link(file?item.name:item.title,cid,file?item.id:null);a.className="row-title";r.append(a);
  if(!file)r.append(btn(loc("导出上下文","Export context"),()=>startExport(cid),"quiet"));
  const act=document.createElement("div");act.className="actions";act.hidden=true;
  const more=btn(loc("更多","More"),()=>{act.hidden=!act.hidden;more.setAttribute("aria-expanded",String(!act.hidden));},"quiet");
  more.setAttribute("aria-expanded","false");r.append(more);
  if(file){
    const meta=document.createElement("small");meta.textContent=[item.conversation_title,item.mime,item.bytes==null?"":`${(item.bytes/1024).toFixed(1)} KiB`].filter(Boolean).join(" · ");li.append(meta);
    const field=document.createElement("input");field.value=item.name;field.maxLength=500;field.setAttribute("aria-label",loc("文件显示名","Display name"));
    act.append(field,btn(loc("保存名称","Save name"),async()=>{await req(`conversations/${cid}/files/${item.id}`,ReaderClient.json("PATCH",{display_name:field.value}));await load(true);}));
  }else{
    const target=document.createElement("select");target.setAttribute("aria-label",loc("移到项目","Move to project"));
    target.append(option("",loc("未归类","Unclassified")),...projects.filter(p=>!p.default).map(p=>option(p.id,p.name)));
    if(item.project_id)target.value=item.project_id;
    act.append(target,btn(loc("移动","Move"),async()=>{await req(`conversations/${cid}/project`,ReaderClient.json("PUT",{project_id:target.value||null}));await load(true);}));
    if(typeof item.pinned==="boolean"){
      const project=uuid($("filter").value)?$("filter").value:null;
      const label=project?(item.pinned?loc("取消项目置顶","Unpin in project"):loc("项目置顶","Pin in project")):
        (item.pinned?loc("取消全局置顶","Unpin globally"):loc("全局置顶","Pin globally"));
      act.append(btn(label,async()=>{
        await req(`conversations/${cid}/pin`+(project?"?project_id="+project:""),ReaderClient.json("PATCH",{is_pinned:!item.pinned}));await load(true);}));
    }
  }
  li.append(act);return li;
}
async function load(reset){
  const n=++epoch;if(reset){offset=0;$("rows").replaceChildren();}
  $("more").hidden=true;$("status").textContent=loc("正在读取…","Loading…");
  const params=new URLSearchParams({offset:String(offset)}),q=$("q").value.trim(),filter=$("filter").value;
  if(q)params.set("q",q);if(uuid(filter))params.set("project_id",filter);
  if(filter==="unclassified"&&mode==="chats")params.set("scope",filter);
  const s=await json((mode==="chats"?"conversations":"files")+"?"+params);
  if(n!==epoch)return;$("rows").append(...s.items.map(row));offset+=s.items.length;$("more").hidden=!s.has_more;
  $("status").textContent=!offset?loc("没有匹配结果。","No results."):"";
}
function filters(){
  const f=$("filter");f.replaceChildren(option("",loc("全部项目","All projects")));
  if(mode==="chats")f.append(option("unclassified",loc("未归类","Unclassified")));
  f.append(...projects.filter(p=>!p.default).map(p=>option(p.id,p.name)));if([...f.options].some(o=>o.value===lastFilter))f.value=lastFilter;
}
async function init(){
  await ReaderClient.trust;({device}=await storage.get("device"));$("pair").hidden=!!device;$("library").hidden=!device;
  if(!device)return;
  $("identity").textContent=device.name+" · "+READER_ORIGIN;projects=await json("projects");filters();
  const t=$("target");t.replaceChildren(option("",loc("未归类","Unclassified")),...projects.filter(p=>!p.default).map(p=>option(p.id,p.name)));
  $("destination-summary").textContent=loc("设置导入目标","Set import destination");
  const {destination}=await storage.get("destination");if(destination?.device===device.id&&[...t.options].some(o=>o.value===(destination.project||""))){
    t.value=destination.project||"";$("choose").disabled=true;showDestination();
  }else if(destination){await storage.remove("destination");}
  $("target").onchange=()=>{$("choose").disabled=false;};
  await renderJobs();await load(true);
}
function showDestination(){
  $("destination-summary").textContent=loc("保存到：","Save to: ")+$("target").selectedOptions[0].text;
  $("destination").open=false;
}
$("connect").onclick=()=>run($("connect"),async()=>{await ReaderClient.connect();await init();});
$("disconnect").onclick=()=>run($("disconnect"),async()=>{await ReaderClient.disconnect();location.reload();});
$("dest").onsubmit=e=>{e.preventDefault();const b=$("choose");run(b,async()=>{await session();await storage.set({destination:{device:device.id,project:$("target").value||null}});showDestination();$("status").textContent=loc("目标已保存。","Destination saved.");});};
$("search").onsubmit=e=>{e.preventDefault();filters();run($("find"),()=>load(true));};
$("filter").onchange=()=>{lastFilter=$("filter").value;run($("find"),()=>load(true));};
for(const m of ["chats","files"])$(m).onclick=()=>run($(m),async()=>{mode=m;for(const x of ["chats","files"])$(x).setAttribute("aria-pressed",String(x===m));filters();await load(true);});
$("more").onclick=()=>run($("more"),()=>load(false));
chrome.storage.onChanged.addListener((c,area)=>{if(area!=="local")return;if(c.device&&device&&c.device.newValue?.id!==device.id){location.reload();return;}if(c.jobs||c.exportJob)renderJobs().catch(e=>{$("error").textContent=e.message;});});
init().catch(e=>{$("error").textContent=e.message;});setInterval(pollExport,1600);
