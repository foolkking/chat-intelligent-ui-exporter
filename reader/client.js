/* global READER_ORIGIN */
globalThis.ReaderClient=(()=>{
  const base=READER_ORIGIN+"/api/extension/v1/", storage=chrome.storage.local;
  const scopedKeys=["device","destination","jobs","exportJob","seenWarnings","sourceLookupDevice"];
  const trust=Promise.all([storage,chrome.storage.session].map(s=>s.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"})))
    .then(()=>navigator.locks.request("reader-device",async()=>{
      const {device}=await storage.get("device");
      // All private builds share an extension ID. Updating one to point at
      // another instance must neither display its old ledger nor send a grant.
      if(!device || device.origin!==READER_ORIGIN){
        await storage.remove(scopedKeys);await chrome.storage.session.clear();
      }
    }));
  const enc=new TextEncoder(), b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
  async function call(url, opts={}){
    const r=await fetch(base+url,{...opts,credentials:"omit",redirect:"error",cache:"no-store",referrerPolicy:"no-referrer"});
    if(!r.ok){const e=Error(`Reader: HTTP ${r.status}`);e.status=r.status;throw e;} return r;
  }
  const json=(method,data)=>({method,headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  async function remember(body){
    await storage.set({device:{origin:READER_ORIGIN,id:body.device_id,user:body.user_id,name:body.account,refresh:body.refresh_token}});
    await chrome.storage.session.set({access:{origin:READER_ORIGIN,token:body.access_token,device:body.device_id,until:Date.now()+body.expires_in*1000-15000}});
  }
  async function connect(){
    await trust;
    return navigator.locks.request("reader-device",async()=>{
      if((await storage.get("device")).device)throw Error("Disconnect the current account first.");
      const verifier=random(),state=random(), challenge=b64(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(verifier))));
      const client=chrome.runtime.id, redirect=chrome.identity.getRedirectURL("reader");
      const result=await chrome.identity.launchWebAuthFlow({interactive:true,url:`${READER_ORIGIN}/extension/connect/${client}/${challenge}/${state}`});
      const u=new URL(result);
      if(u.origin+u.pathname!==redirect||u.searchParams.get("state")!==state||!u.searchParams.get("code"))throw Error("Authorization was not confirmed.");
      const response=await call("token",json("POST",{client,code:u.searchParams.get("code"),verifier}));
      await remember(await response.json());await storage.remove(scopedKeys.filter(key=>key!=="device"));
    });
  }
  async function lockedAccess(deviceId){
      const {device}=await storage.get("device");if(device?.origin!==READER_ORIGIN||device.id!==deviceId)throw Error("Reconnect this Reader account.");
      const {access}=await chrome.storage.session.get("access");
      if(access?.origin===READER_ORIGIN&&access.device===device.id&&access.until>Date.now())return access.token;
      const body=await (await call("token",json("POST",{client:chrome.runtime.id,refresh:device.refresh}))).json();
      if(body.device_id!==device.id||body.user_id!==device.user)throw Error("Account changed.");await remember(body);return body.access_token;
  }
  async function access(deviceId){
    await trust;
    return navigator.locks.request("reader-device",()=>lockedAccess(deviceId));
  }
  async function request(device,path,opts={}){
    if(!/^[a-z][a-z0-9/-]*(?:\?[^#]*)?$/i.test(path)||path.includes("..")||path.includes("//"))throw Error("Invalid operation");
    return call(path,{...opts,headers:{...opts.headers,Authorization:"Bearer "+await access(device)}});
  }
  async function disconnect(){
    await trust;
    return navigator.locks.request("reader-device",async()=>{
      const {device}=await storage.get("device");
      if(device?.origin===READER_ORIGIN){try{await call("device",{method:"DELETE",headers:{Authorization:"Bearer "+await lockedAccess(device.id)}});}catch(e){if(![401,403,404].includes(e.status))throw e;}}
      await storage.remove(scopedKeys);await chrome.storage.session.clear();
    });
  }
  return {connect,disconnect,request,json,trust,access};
})();
