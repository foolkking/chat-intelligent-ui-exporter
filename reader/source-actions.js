// Trusted worker only. Source pages receive a small display state, never a Reader id, URL or grant.
const saveUuid=s=>typeof s==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
async function sourceKey(id){const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("Reader source v1\0"+id));
  return Array.from(new Uint8Array(buf),x=>x.toString(16).padStart(2,"0")).join("");}
// A manual find is display-only. Never leave that decision in the source document:
// it can outlive the Reader account. Keep only a few live document scopes, no target IDs or grants.
const manualFinds=new Map();
function manualFound(s,device,key){
  const tab=s.tab.id,p=manualFinds.get(tab);
  if(p&&p.device===device&&p.doc===s.documentId&&p.key===key)return true;
  manualFinds.delete(tab);return false;
}
function rememberFind(s,device,key){
  manualFinds.delete(s.tab.id);
  if(manualFinds.size>=12)manualFinds.delete(manualFinds.keys().next().value);
  manualFinds.set(s.tab.id,{device,doc:s.documentId,key});
}
const pendingSave=j=>j&&(j.active||j.packageReady||["review","upload-unknown","check","reconnect"].includes(j.phase));
function sourceDisplay(j,attempt){
  if(!j)return "save";
  if(j.phase==="cancelled")return "cancelled";
  if(j.mode==="append"&&j.phase==="append-ready")return "append-ready";
  if(j.mode==="append"&&j.phase==="append-complete")return !j.appendResult?"append-processed":
    j.appendResult.partial||j.partial||Object.values(j.losses||{}).some(Number)?"append-partial":"append-complete";
  if(j.mode==="append"&&j.phase==="append-attention"&&j.diagnostic?.recovery==="review_in_reader")return "append-review";
  if(j.diagnostic?.recovery==="system_support"&&!j.active)return "system-hold";
  if(j.phase==="done"){
    if(j.partial||j.result?.completeness==="partial"||Object.values(j.losses||{}).some(Number))return "partial";
    if(j.result?.completeness!=="complete"||j.key!==attempt)return "previous";
    return j.result.action==="separate_copy"?"copy":"saved";
  }
  if(j.phase==="review")return "review";
  if(j.packageReady&&!j.active)return "paused";
  if(j.phase==="upload-unknown"||j.phase==="check")return "uncertain";
  if(j.active)return "saving";
  if(j.phase==="reconnect")return "reconnect";
  return "failed";
}
async function stillHere(s,path,deviceId){
  if(!await currentSource(s.tab.id,s.documentId,path))return false;
  const d=(await chrome.storage.local.get("device")).device;return d?.id===deviceId&&d.origin===READER_ORIGIN;
}
async function act(m,s,path,host){
  await ReaderClient.trust;
  const {device,destination,jobs=[],sourceLookupDevice}=await chrome.storage.local.get(["device","destination","jobs","sourceLookupDevice"]);
  if(!device||device.origin!==READER_ORIGIN){manualFinds.delete(s.tab.id);return {state:"connect",progressKey:null};}
  const id=path.split("/").filter(Boolean).at(-1);if(!/^[a-z0-9_-]{1,128}$/i.test(id))return {error:"unavailable"};
  const key=await sourceKey(id),same=jobs.filter(j=>j.device===device.id&&j.sourceKey===key),matches=same.filter(j=>j.mode!=="append");
  let j=m.kind==="source-state"?(same.find(j=>j.key===m.attempt)||same.at(-1)):matches.at(-1);
  const dest=destination?.device===device.id?destination:null;
  const knownHere=manualFound(s,device.id,key);
  let state=j?sourceDisplay(j,m.attempt):dest?"save":"destination";
  const api=async(p,opts)=>(await ReaderClient.request(device.id,p,opts)).json();
  if(m.kind==="source-state"){
    if(j?.mode==="append"&&saveUuid(j.iid)){
      // Returning from Web confirmation must reflect the real receipt, not
      // forever retain the inactive "append-ready" upload record. This is
      // read-only: the source document still cannot confirm or retry an append.
      const rec=await api("imports/"+j.iid);
      if(!await stillHere(s,path,device.id))return {error:"changed"};
      const observed=ReaderProgress.appendReceipt(rec);if(!observed)return {error:"unavailable"};
      j={...j,...observed};
      if(observed.active)j.stats=ReaderProgress.accumulate(j.stats,{serverProgress:observed.percent});
      state=sourceDisplay(j,m.attempt);
    }else if(j?.phase==="done"&&saveUuid(j.iid)){
      // This is a known *Reader receipt*, not a disclosure of passive browsing history.
      const rec=await api("imports/"+j.iid);
      if(!await stillHere(s,path,device.id))return {error:"changed"};
      if(rec.status!=="committed"||!saveUuid(rec.conversation_id))return {state:"save",progressKey:null};
    }else if(!j&&sourceLookupDevice===device.id){
      // Visiting a source is not consent to report its ID. Unknown local
      // receipts are checked automatically only on an explicitly opted-in device.
      manualFinds.delete(s.tab.id); // Fresh authorized evidence supersedes an earlier manual hint.
      const capabilities=await api("capabilities");
      if(!await stillHere(s,path,device.id))return {error:"changed"};
      const optedIn=async()=>(await chrome.storage.local.get("sourceLookupDevice")).sourceLookupDevice===device.id;
      if(capabilities.source_lookup===true&&await optedIn()){
        const receipt=await api("sources/status",ReaderClient.json("POST",{source_id:id}));
        if(!await stillHere(s,path,device.id))return {error:"changed"};
        if(await optedIn()&&saveUuid(receipt.conversation_id))state="previous";
      }
    }else if(!j&&knownHere){
      if(!await stillHere(s,path,device.id))return {error:"changed"};
      state="previous";
    }
    // A display-only fingerprint separates tasks/accounts without disclosing
    // receipt IDs, device IDs or an actionable transfer key to the source page.
    const progressKey=j?await sourceKey("display\0"+device.id+"\0"+j.key):null;
    if(!await stillHere(s,path,device.id))return {error:"changed"};
    return {state,progressKey,name:dest?.showName?String(dest.name||"").slice(0,120):"",canSave:!!dest,
      ...(j?{step:ReaderProgress.snapshot(j.step),stats:ReaderProgress.accumulate(null,j.stats),
        taskPhase:["reading","uploading","received","processing","queued","resource-wait","review","done",
          "cancelled","attention","capture-interrupted","upload-paused","upload-unknown","reconnect","check",
          "append-ready","append-complete","append-attention"].includes(j.phase)?j.phase:null,
        diagnostic:ReaderProgress.diagnostic(j.diagnostic),
        startedAt:Number.isSafeInteger(j.startedAt)?j.startedAt:null,
        finishedAt:Number.isSafeInteger(j.finishedAt)?j.finishedAt:null}: {})};
  }
  if(m.kind==="open-saved"||m.kind==="find-saved"){
    let cid;
    if(m.kind==="open-saved"&&j?.phase==="done"&&saveUuid(j.iid)){
      const receipt=await api("imports/"+j.iid);
      // Never substitute the original for a separate copy which has been deleted.
      cid=receipt.status==="committed"?receipt.conversation_id:null;
    }else{
      if((await api("capabilities")).source_lookup!==true)return {error:"unavailable"};
      if(!await stillHere(s,path,device.id))return {error:"changed"};
      cid=(await api("sources/status",ReaderClient.json("POST",{source_id:id}))).conversation_id;
    }
    if(!await stillHere(s,path,device.id))return {error:"changed"};
    if(!saveUuid(cid)){manualFinds.delete(s.tab.id);return {state:"not-found"};}
    if(m.kind==="find-saved")rememberFind(s,device.id,key);
    if(m.kind==="open-saved")await chrome.tabs.create({url:READER_ORIGIN+"/conversations/"+cid});
    return {state:"previous"};
  }
  if(m.kind==="open-append"){
    const appends=same.filter(x=>x.mode==="append"&&saveUuid(x.iid));
    const job=m.attempt?appends.find(x=>x.key===m.attempt):appends.at(-1);
    if(!job||!await stillHere(s,path,device.id))return {error:"changed"};
    const s1=await api("imports/"+job.iid);
    if(s1.mode!=="selective_append"||!await stillHere(s,path,device.id))return {error:"changed"};
    await chrome.tabs.create({url:READER_ORIGIN+"/append-imports/"+job.iid});return {ok:true};
  }
  const excerpt=m.kind==="start-append";
  if(m.kind!=="start"&&!excerpt)return {error:"unavailable"};
  if(!excerpt&&!dest)return {state:"destination"};
  // Re-read under the start lock so the same source in two tabs cannot issue parallel tickets.
  return navigator.locks.request("reader-start",async()=>{
    const now=Date.now(),snapshot=await chrome.storage.local.get(["device","destination","jobs"]);
    if(snapshot.device?.id!==device.id||!excerpt&&(snapshot.destination?.device!==device.id||snapshot.destination.project!==dest.project))return {error:"changed"};
    const job=(snapshot.jobs||[]).filter(x=>x.device===device.id&&x.sourceKey===key&&(x.mode==="append")===excerpt).at(-1);
    if(pendingSave(job))return {state:sourceDisplay(job,m.attempt)};
    const all=await chrome.storage.session.get(null);
    for(const [k,t] of Object.entries(all))if(k.startsWith("ticket:")){
      if(t.expires<=now)await chrome.storage.session.remove(k);else if(t.device===device.id&&t.sourceKey===key)return {state:"saving"};
    }
    const c=await api("capabilities");
    if(c.protocol!==1||c.import_profile!=="reader-chat-v1"||!c.capture||excerpt&&!c.selective_append)return {error:"unavailable"};
    if(c.resumable_capture!==true)return {state:"upgrade-required"};
    if(!excerpt&&dest.project&&!(await api("projects")).some(p=>p.id===dest.project&&!p.default)){
      await chrome.storage.local.remove("destination");return {state:"destination"};
    }
    await host();if(!await stillHere(s,path,device.id))return {error:"changed"};
    const ticket=crypto.randomUUID(),attempt=crypto.randomUUID();
    await chrome.storage.session.set({["ticket:"+ticket]:{tab:s.tab.id,doc:s.documentId,path,device:device.id,
      project:excerpt?null:dest.project||null,mode:excerpt?"append":"save",sourceKey:key,attempt,expires:Date.now()+30000,
      extendedSelection:excerpt&&c.selective_append_ranges===true}});
    return {ticket,attempt,textOnly:!excerpt&&!!dest.textOnly,...(excerpt?{extendedSelection:c.selective_append_ranges===true}:{})};
  });
}
globalThis.ReaderSourceAction=act;
// These ports only wake the local control. They never broadcast which chat/account/project changed.
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=="reader-display"||!source(port.sender))return;
  const notify=()=>{try{port.postMessage({refresh:true});}catch{/* document gone */}};
  const wake=(changes,area)=>{if(area==="local"&&(changes.jobs||changes.destination||changes.device||changes.sourceLookupDevice))notify();};
  // A receipt may settle while this known source document is behind the panel.
  // Only wake its already-connected port; do not query other tabs or their URLs.
  const activated=info=>{if(info.tabId===port.sender.tab.id)notify();};
  chrome.storage.onChanged.addListener(wake);chrome.tabs.onActivated.addListener(activated);
  port.onDisconnect.addListener(()=>{chrome.storage.onChanged.removeListener(wake);chrome.tabs.onActivated.removeListener(activated);});
});
