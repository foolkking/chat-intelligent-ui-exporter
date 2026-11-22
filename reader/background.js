importScripts("config.js","client.js");
const HOST="host.html";
async function host(){
  return navigator.locks.request("reader-host",async()=>{
    if(!(await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL(HOST)]})).length)
      await chrome.offscreen.createDocument({url:HOST,reasons:["BLOBS"],justification:"Bounded temporary ZIP transfer for an explicitly selected conversation and private Context downloads."});
  });
}
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});
function source(sender){
  if(!sender.tab||sender.frameId!==0||sender.documentLifecycle!=="active"&&sender.documentLifecycle!==undefined)return "";
  try{const u=new URL(sender.url);return u.origin==="https://chatgpt.com"&&/^\/(?:g\/[\w-]+\/)?c\/[\w-]+\/?$/.test(u.pathname)?u.pathname:"";}catch{return "";}
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(s.url===chrome.runtime.getURL(HOST)&&m?.kind==="host-rpc"){
    (async()=>{
      await ReaderClient.trust;
      if(m.op==="ticket"){
        const k="ticket:"+m.ticket;
        const t=(await chrome.storage.session.get(k))[k];await chrome.storage.session.remove(k);
        const {device}=await chrome.storage.local.get("device");
        if(!t||t.expires<Date.now()||t.tab!==m.tab||t.doc!==m.doc||t.path!==m.path||t.device!==device?.id)throw Error("Capture expired.");
        return t;
      }
      if(m.op==="access")return ReaderClient.access(m.device);
      if(m.op==="device")return (await chrome.storage.local.get("device")).device?.id||null;
      if(m.op==="jobs")return (await chrome.storage.local.get("jobs")).jobs||[];
      if(m.op==="saveJobs"){const id=(await chrome.storage.local.get("device")).device?.id;await chrome.storage.local.set({jobs:m.jobs.filter(j=>j.device===id)});return true;}
      if(m.op==="download"){
        if(typeof m.url!=="string"||!m.url.startsWith("blob:"+chrome.runtime.getURL("")))throw Error("Invalid artifact");
        return chrome.downloads.download({url:m.url,filename:"Reader.context.zip",saveAs:true});
      }
      throw Error("Unknown operation");
    })().then(value=>reply({value}),e=>reply({error:e.message}));return true;
  }
  if(m?.kind==="start"&&source(s)){
    (async()=>{
      await ReaderClient.trust;
      const {device,destination}=await chrome.storage.local.get(["device","destination"]);
      if(!device||destination?.device!==device.id)return {error:"请先在 Chat Reader 工具栏侧栏连接账号并确认目标项目。"};
      const capabilities=await (await ReaderClient.request(device.id,"capabilities")).json();
      if(capabilities.protocol!==1||capabilities.import_profile!=="reader-chat-v1"||!capabilities.capture)
        return {error:"Reader 尚未启用此导入协议 · Reader capture unavailable"};
      await host();
      const ticket=crypto.randomUUID();await chrome.storage.session.set({["ticket:"+ticket]:{tab:s.tab.id,doc:s.documentId,path:source(s),
          device:device.id,project:destination.project||null,expires:Date.now()+30000}});
      return {ticket};
    })().then(reply,()=>reply({error:"无法准备导入；请打开 Reader 侧栏。"}));return true;
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
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create("reader-pending",{periodInMinutes:1}));
chrome.downloads.onChanged.addListener(d=>{if(["complete","interrupted"].includes(d.state?.current))
  chrome.runtime.sendMessage({kind:"download-ended",id:d.id}).catch(()=>{});});
