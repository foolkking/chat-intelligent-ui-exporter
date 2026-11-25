// Durable plans contain selected references and fixed targets, never source bodies or credentials.
globalThis.ReaderBatch = (() => {
  const id=v=>typeof v==="string"&&/^[\w-]{1,128}$/.test(v);
  const uuid=v=>typeof v==="string"&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(v);
  const pending=j=>!!j&&(j.active||j.packageReady||["source-starting","check","upload-unknown","reconnect","review"].includes(j.phase));
  const success=j=>j?.phase==="done";
  function create({device,origin,source,rows,targets,attachments}){
    if(!device?.id||device.origin!==origin||!source||!["archive","web"].includes(source.kind)||!source.scope||!rows.length)throw Error("plan-invalid");
    const seen=new Set();
    const items=rows.map(row=>{
      if(!id(row.id)||seen.has(row.id)||!Object.hasOwn(targets,row.group))throw Error("plan-invalid");seen.add(row.id);
      const target=targets[row.group];if(target!==null&&!uuid(target))throw Error("plan-invalid");
      return {id:row.id,title:String(row.title||"ChatGPT").slice(0,512),group:row.group,project:target,key:crypto.randomUUID(),cancelled:false};
    });
    return {version:1,id:crypto.randomUUID(),device:device.id,user:device.user,origin,source:{...source},attachments:!!attachments,items,created:Date.now(),paused:true};
  }
  function owned(plan,device,origin){return plan?.version===1&&device?.origin===origin&&plan.origin===origin&&plan.device===device.id&&plan.user===device.user;}
  function candidates(plan,jobs,retry=false){
    return plan.items.filter(item=>{
      if(item.cancelled||item.skipped)return false;
      const j=jobs.find(j=>j.key===item.key&&j.device===plan.device);
      if(!j)return !retry;
      return !success(j)&&!["review","cancelled","result-unavailable"].includes(j.phase)&&(!retry||!j.active&&
        !["received","source-starting","queued","processing"].includes(j.phase));
    });
  }
  return {create,owned,pending,success,candidates};
})();
