// Uses the same idempotent Reader Context export as the web application.
async function startExport(cid){
  return navigator.locks.request("reader-export-request",async()=>{
  const saved=(await storage.get("exportJob")).exportJob;
  if(saved?.device===device.id&&saved.cid!==cid&&!saved.aid)throw Error(loc("请先完成当前上下文导出。","Finish the current export first."));
  const key=saved?.device===device.id&&saved.cid===cid&&!saved.aid?saved.key:crypto.randomUUID(),owner=device.id;
  await storage.set({exportJob:{cid,key,device:owner}}); // Recover after close or a lost POST using exactly this key.
  const job=await json(`conversations/${cid}/context`,{method:"POST",headers:{"Idempotency-Key":key}});
  await session();await storage.set({exportJob:{cid,key,device:owner,id:job.id,policy:job.context_policy}});await renderJobs();
  });
}
async function download(aid){await cmd({op:"download",aid});}
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
