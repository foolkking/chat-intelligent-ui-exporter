// Worker-side grants. A source document may open a fixed private view, never request its contents.
const privatePage = (s, name) => s.id === chrome.runtime.id && s.url === chrome.runtime.getURL(name) && (!s.tab || s.frameId === 0);
const privateView = view => view === "library" || view === "import";
// Chromium resolves dynamic WAR URLs to the stable extension origin in MessageSender.
// Compare that authenticated identity, not getURL()'s per-session public alias.
const framePage = s => {
  if(s.id!==chrome.runtime.id || !s.tab || !(s.frameId>0) || !s.documentId ||
    s.documentLifecycle!==undefined && s.documentLifecycle!=="active")return false;
  try{const u=new URL(s.url);return u.protocol==="chrome-extension:"&&u.hostname===chrome.runtime.id&&u.pathname==="/frame.html"&&!u.search;}
  catch{return false;}
};
async function liveParent(owner) {
  const tab = await chrome.tabs.get(owner.tab).catch(()=>null);
  if (!tab?.url || new URL(tab.url).origin !== "https://chatgpt.com" || new URL(tab.url).pathname !== owner.path) return false;
  const r=await chrome.tabs.sendMessage(owner.tab,{kind:"reader-surface-path",path:owner.path},{documentId:owner.doc}).catch(()=>null);
  return r?.current===true;
}
async function authorizedFrame(s) {
  if (!framePage(s)) return null;
  const key="frame:"+s.documentId, owner=(await chrome.storage.session.get(key))[key];
  return owner && privateView(owner.view) && owner.tab===s.tab.id && await liveParent(owner) ? owner : null;
}
async function sourceView(owner,view) {
  await chrome.tabs.sendMessage(owner.tab,{kind:view==="import"?"reader-open-import":"reader-open-library"},{documentId:owner.doc});
  return {ok:true};
}
chrome.action.onClicked.addListener(async tab => {
  if(tab.url && new URL(tab.url).origin==="https://chatgpt.com" && ReaderRoutes.eligible(new URL(tab.url).pathname)){
    // Source navigation must not silently become a separate window/tab.
    await chrome.tabs.sendMessage(tab.id,{kind:"reader-toggle"},{frameId:0}).catch(()=>null);
    return;
  }
  try{
    // Invoke before the first await: Chromium requires the toolbar's user gesture.
    if(chrome.sidePanel?.open){await chrome.sidePanel.open({windowId:tab.windowId});return;}
  }catch{}
  // Older browsers or a disabled native panel retain the fixed extension-page fallback.
  await chrome.tabs.create({url:chrome.runtime.getURL("center.html")});
});
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  const key = m?.kind;
  if (!["frame-ticket","frame-claim","frame-close","frame-view","panel-allowed","open-center","surface-tab"].includes(key)) return;
  (async()=>{
    await ReaderClient.trust;
    if (key==="panel-allowed") {
      if(!privatePage(s,"host.html"))return false;
      const ownerKey="frame:"+m.doc, owner=(await chrome.storage.session.get(ownerKey))[ownerKey];
      return !!(owner&&privateView(owner.view)&&owner.tab===m.tab&&await liveParent(owner));
    }
    if (key==="frame-claim" && framePage(s) && /^[\da-f-]{36}$/.test(m.ticket)) {
      return navigator.locks.request("reader-frame-ticket", async()=>{
        const k="surface:"+m.ticket, owner=(await chrome.storage.session.get(k))[k];
        if(!owner||!privateView(owner.view)||owner.tab!==s.tab.id||owner.expires<Date.now()||!await liveParent(owner))return {};
        if((await chrome.storage.session.get("frame:"+s.documentId))["frame:"+s.documentId])return {};
        await chrome.storage.session.remove(k);await chrome.storage.session.set({["frame:"+s.documentId]:owner});
        return {ok:true,view:owner.view,tab:owner.tab};
      });
    }
    if(key==="frame-close"){
      const owner=await authorizedFrame(s);if(owner)await chrome.tabs.sendMessage(owner.tab,{kind:"reader-collapse"},{documentId:owner.doc});
      return {};
    }
    if(key==="frame-view"){
      if(!privateView(m.view))return {};
      const owner=await authorizedFrame(s);return owner?sourceView(owner,m.view):{};
    }
    if(key==="open-center"){
      const owner=await authorizedFrame(s);if(owner)return sourceView(owner,"import");
      if(privatePage(s,"panel.html")){
        await chrome.tabs.create({url:chrome.runtime.getURL("center.html")});return {ok:true};
      }
    }
    if(!source(s)||!ReaderRoutes.eligible(m.path||""))return {};
    const owner={tab:s.tab.id,doc:s.documentId,path:m.path,expires:Date.now()+20000};
    if(!s.tab.active||!await liveParent(owner))return {};
    if(key==="frame-ticket"){
      // Omitted view keeps the original library caller compatible; explicit invalid values fail closed.
      owner.view=m.view===undefined?"library":m.view;if(!privateView(owner.view))return {};
      const ticket=crypto.randomUUID(),store=chrome.storage.session,all=await store.get(null);
      const stale=Object.entries(all).filter(([k,v])=>(k.startsWith("surface:")&&v.expires<Date.now())||
        ((k.startsWith("surface:")||k.startsWith("frame:"))&&v.tab===owner.tab&&(v.doc!==owner.doc||v.path!==owner.path))).map(([k])=>k);
      if(stale.length)await store.remove(stale);await store.set({["surface:"+ticket]:owner});return {ticket};
    }
    if(key==="surface-tab"){
      if(["outline","library","import"].includes(m.view))await chrome.storage.local.set({surfaceView:m.view});
      return {view:(await chrome.storage.local.get("surfaceView")).surfaceView||"outline"};
    }
    if(key==="open-center")return sourceView(owner,"import");
    return {};
  })().then(reply,()=>reply({}));return true;
});
chrome.tabs.onRemoved.addListener(async tab=>{
  const store=chrome.storage.session,all=await store.get(null);
  const keys=Object.entries(all).filter(([k,v])=>(k.startsWith("surface:")||k.startsWith("frame:"))&&v.tab===tab).map(([k])=>k);
  if(keys.length)await store.remove(keys);
});
