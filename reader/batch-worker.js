// Trusted coordinator. Source catalogues are local, partial and never uploaded wholesale.
function centerPage(s){
  try{const u=new URL(s.url);return s.id===chrome.runtime.id&&s.frameId===0&&u.protocol==="chrome-extension:"&&u.hostname===chrome.runtime.id&&u.pathname==="/center.html";}
  catch{return false;}
}
async function liveBatch(t){
  const tab=await chrome.tabs.get(t.tab).catch(()=>null);if(!tab?.url)return false;
  const u=new URL(tab.url);if(u.origin!=="https://chatgpt.com"||u.pathname!==t.path||!ReaderRoutes.eligible(u.pathname))return false;
  const result=await chrome.tabs.sendMessage(t.tab,{kind:"reader-batch-check",path:t.path,nonce:t.nonce,scope:t.scope},{frameId:0}).catch(()=>null);
  return result?.current===true;
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m?.kind==="batch-source-error"&&source(s)){
    (async()=>{const {batchPlan,jobs=[],device}=await chrome.storage.local.get(["batchPlan","jobs","device"]);
      if(batchPlan?.device!==device?.id||batchPlan?.source?.kind!=="web")return;
      const c=(await chrome.storage.session.get("catalog:"+batchPlan.source.catalog))["catalog:"+batchPlan.source.catalog];
      if(!c||c.tab!==s.tab.id||c.nonce!==m.nonce)return;
      await navigator.locks.request("reader-jobs",async()=>{
        const {jobs:now=[]}=await chrome.storage.local.get("jobs"),j=now.find(j=>j.key===m.attempt&&j.batch===batchPlan.id&&j.device===device.id);
        if(j&&!j.iid&&!j.packageReady){j.active=false;j.phase="capture-interrupted";j.step=null;await chrome.storage.local.set({jobs:now});}
      });
    })().catch(()=>{});return;
  }
  if(!centerPage(s)||!["batch-tabs","batch-discover","batch-capture"].includes(m?.kind))return;
  (async()=>{
    await ReaderClient.trust;
    if(m.kind==="batch-tabs"){
      const tabs=await chrome.tabs.query({url:"https://chatgpt.com/*"});
      return {tabs:tabs.filter(t=>ReaderRoutes.eligible(new URL(t.url).pathname)).map(t=>({id:t.id,title:String(t.title||"ChatGPT").slice(0,160)}))};
    }
    if(m.kind==="batch-discover"){
      if(!Number.isSafeInteger(m.tab))throw Error("source-changed");
      const tab=await chrome.tabs.get(m.tab),u=new URL(tab.url);
      if(u.origin!=="https://chatgpt.com"||!ReaderRoutes.eligible(u.pathname))throw Error("source-changed");
      const d=await chrome.tabs.sendMessage(tab.id,{kind:"reader-batch-discover"},{frameId:0});
      if(d?.error)throw Error(d.error);
      if(!d||d.path!==u.pathname||!saveUuid(d.nonce)||!Array.isArray(d.rows)||
        d.rows.some(r=>!r||typeof r.id!=="string"||!/^[\w-]{1,128}$/.test(r.id)||typeof r.title!=="string"))throw Error("source-changed");
      const catalog=crypto.randomUUID(),record={...d,tab:tab.id,at:Date.now()};
      await chrome.storage.session.set({["catalog:"+catalog]:record});
      return {...d,catalog};
    }
    return navigator.locks.request("reader-start",async()=>{
      const {batchPlan:plan,device,jobs=[]}=await chrome.storage.local.get(["batchPlan","device","jobs"]);
      if(plan?.id!==m.plan||plan?.device!==device?.id||device?.origin!==READER_ORIGIN||plan.user!==device.user||plan.source.kind!=="web")throw Error("owner-changed");
      const item=plan.items.find(i=>i.key===m.key&&!i.cancelled&&!i.skipped);if(!item)throw Error("plan-invalid");
      const c=(await chrome.storage.session.get("catalog:"+plan.source.catalog))["catalog:"+plan.source.catalog];
      if(!c||!c.scope||c.scope!==plan.source.scope||!c.rows.some(r=>r.id===item.id&&r.group===item.group)||!await liveBatch(c))throw Error("source-changed");
      const key=await sourceKey(item.id),existing=jobs.find(j=>j.device===device.id&&j.sourceKey===key&&j.key!==item.key&&pendingSave(j));
      if(existing)throw Error("source-busy");
      const caps=await (await ReaderClient.request(device.id,"capabilities")).json();
      if(!caps.capture||!caps.resumable_capture||caps.import_profile!=="reader-chat-v1")throw Error("upgrade-required");
      const receipt=await (await ReaderClient.request(device.id,"requests/"+item.key)).json();
      if(receipt.id)throw Error("receipt-exists"); // center must reconcile the old receipt, not start another capture
      await host();if(!await liveBatch(c))throw Error("source-changed");
      const ticket=crypto.randomUUID(),t={tab:c.tab,path:c.path,scope:c.scope,nonce:c.nonce,batch:plan.id,sourceId:item.id,
        device:device.id,project:item.project,sourceKey:key,mode:"save",attempt:item.key,expires:Date.now()+30000};
      await chrome.storage.session.set({["ticket:"+ticket]:t});
      await navigator.locks.request("reader-jobs",async()=>{
        const {device:now,jobs:list=[]}=await chrome.storage.local.get(["device","jobs"]);if(now?.id!==device.id)throw Error("owner-changed");
        const patch={device:device.id,batch:plan.id,sourceKey:key,title:item.title,phase:"source-starting",active:false};
        const before=list.find(j=>j.key===item.key);if(before)Object.assign(before,patch);else list.push({key:item.key,...patch});
        await chrome.storage.local.set({jobs:list});
      });
      const r=await chrome.tabs.sendMessage(c.tab,{kind:"reader-batch-capture",id:item.id,path:c.path,scope:c.scope,nonce:c.nonce,
        ticket,attempt:item.key,textOnly:!plan.attachments},{frameId:0});
      if(!r?.started){await chrome.storage.session.remove("ticket:"+ticket);throw Error(r?.error||"source-changed");}
      return {ok:true};
    });
  })().then(reply,e=>reply({error:["source-changed","source-busy","owner-changed","plan-invalid","upgrade-required","scope-unverified","receipt-exists"].includes(e.message)?e.message:"source-unavailable"}));
  return true;
});
