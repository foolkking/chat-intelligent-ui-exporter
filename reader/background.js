importScripts("config.js","client.js","source-actions.js");
const HOST="host.html";
async function host(){
  return navigator.locks.request("reader-host",async()=>{
    if(!(await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL(HOST)]})).length)
      await chrome.offscreen.createDocument({url:HOST,reasons:["BLOBS"],justification:"Bounded temporary ZIP transfer for an explicitly selected conversation and private Context downloads."});
  });
}
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});
function source(sender){
  if(sender.id!==chrome.runtime.id||!sender.tab||!sender.documentId||sender.frameId!==0||sender.documentLifecycle!=="active"&&sender.documentLifecycle!==undefined)return false;
  try{return new URL(sender.url).origin==="https://chatgpt.com"&&(!sender.origin||sender.origin==="https://chatgpt.com");}catch{return false;}
}
async function currentSource(tabId,documentId,path){
  if(!/^\/(?:g\/[\w-]+\/)?c\/[\w-]{1,128}\/?$/.test(path)||!documentId)return false;
  const tab=await chrome.tabs.get(tabId).catch(()=>null);
  if(!tab?.active||!tab.url)return false;
  const u=new URL(tab.url);
  if(u.origin!=="https://chatgpt.com"||u.pathname!==path)return false;
  const r=await chrome.tabs.sendMessage(tabId,{kind:"reader-confirm-path",path},{documentId}).catch(()=>null);
  return r?.current===true;
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(s.url===chrome.runtime.getURL(HOST)&&m?.kind==="host-rpc"){
    (async()=>{
      await ReaderClient.trust;
      if(m.op==="ticket"){
        const k="ticket:"+m.ticket;
        const t=(await chrome.storage.session.get(k))[k];await chrome.storage.session.remove(k);
        const {device}=await chrome.storage.local.get("device");
        if(!t||t.expires<Date.now()||t.tab!==m.tab||t.doc!==m.doc||t.device!==device?.id||
          !await currentSource(t.tab,t.doc,t.path))throw Error("Capture expired.");
        return t;
      }
      if(m.op==="access")return ReaderClient.access(m.device);
      if(m.op==="device")return (await chrome.storage.local.get("device")).device?.id||null;
      if(m.op==="source-current")return currentSource(m.tab,m.doc,m.path);
      if(m.op==="jobs")return (await chrome.storage.local.get("jobs")).jobs||[];
      if(m.op==="saveJobs"){const id=(await chrome.storage.local.get("device")).device?.id;await chrome.storage.local.set({jobs:m.jobs.filter(j=>j.device===id)});return true;}
      if(m.op==="download"){
        if(typeof m.url!=="string"||!m.url.startsWith("blob:"+chrome.runtime.getURL("")))throw Error("Invalid artifact");
        return chrome.downloads.download({url:m.url,filename:"Reader.context.zip",saveAs:true});
      }
      throw Error("Unknown operation");
    })().then(value=>reply({value}),e=>reply({error:e.message}));return true;
  }
  if(["start","start-append","open-append","source-state","open-saved","find-saved","open-panel"].includes(m?.kind)&&source(s)&&
    typeof m.path==="string"&&/^\/(?:g\/[\w-]+\/)?c\/[\w-]{1,128}\/?$/.test(m.path)){
    if(m.kind==="open-panel"){chrome.sidePanel.open({tabId:s.tab.id}).then(()=>reply({ok:true}),()=>reply({error:"panel"}));return true;}
    // sender.url can remain the original document URL after history.pushState().
    // The live browser tab AND this exact, visible top-level document must agree.
    currentSource(s.tab.id,s.documentId,m.path).then(ok=>ok?ReaderSourceAction(m,s,m.path,host):{error:"changed"})
      .then(reply,e=>reply({error:e.status===401?"reconnect":e.status===403?"denied":
      e.status===404?"unavailable":e.readerReason||"offline"}));return true;
  }
  if(m?.kind==="wake"&&s.url===chrome.runtime.getURL("panel.html")){
    host().then(()=>reply({ok:true}),()=>reply({error:"Background unavailable"}));return true;
  }
});
chrome.alarms.onAlarm.addListener(async a=>{
  if(a.name==="reader-pending"&&(await chrome.storage.local.get("jobs")).jobs?.some(j=>j.active)){
    await host();await chrome.runtime.sendMessage({kind:"tick"}).catch(()=>{});
  }
});
const resumePending=async()=>{await ReaderClient.trust;await chrome.alarms.create("reader-pending",{periodInMinutes:1});
  if((await chrome.storage.local.get("jobs")).jobs?.some(j=>j.active)){await host();await chrome.runtime.sendMessage({kind:"tick"}).catch(()=>{});}};
chrome.runtime.onInstalled.addListener(()=>resumePending().catch(()=>{}));
chrome.runtime.onStartup.addListener(()=>resumePending().catch(()=>{}));
chrome.downloads.onChanged.addListener(d=>{if(["complete","interrupted"].includes(d.state?.current))
  chrome.runtime.sendMessage({kind:"download-ended",id:d.id}).catch(()=>{});});
