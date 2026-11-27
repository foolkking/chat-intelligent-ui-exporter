// Page realm, deliberately separate from every Reader privilege. This adapter
// can only ask the current page to prepare one of its own identified rows.
(() => {
  const channel="reader-native-row-v1", unit="[data-chatgpt-search-message-ids],[data-message-id]";
  const valid=id=>typeof id==="string"&&/^[\w-]{1,128}$/.test(id);
  const validKey=key=>typeof key==="string"&&key.length>0&&key.length<=256&&!/[\u0000-\u001f]/.test(key);
  const chat=()=>/\/c\/([\w-]+)\/?$/.exec(location.pathname)?.[1];
  const ids=node=>(node?.getAttribute("data-chatgpt-search-message-ids")||node?.getAttribute("data-message-id")||"").trim().split(/\s+/);
  let lastTrial,active;
  function adapter(scope,conversation,id){
    const witness=[...scope.querySelectorAll(unit)].find(n=>!n.closest('[hidden],[inert],[aria-hidden=true],[role=presentation][data-app-action-timeline-scroll]')&&
      n.getClientRects().length);if(!witness)return {status:"no-witness"};
    const candidates=new Map(),seen=new Set();let messageOnly=false;
    // Inspect only the owners of mounted UI. Never traverse unrelated fibers,
    // component state, network clients, the root store or pagination internals.
    for(const el of [witness,witness.closest("[data-turn-key]"),scope].filter(Boolean)){
      const key=Object.keys(el).find(k=>k.startsWith("__reactFiber$"));
      let owner=key&&el[key];
      for(let steps=0;owner&&steps<100&&!seen.has(owner);steps++,owner=owner.return){
        seen.add(owner);
        const props=owner.memoizedProps,api=props?.turnListApi;
        if(props?.conversationId!==conversation||!Array.isArray(props.entries))continue;
        if(typeof api?.scrollToKey==="function"&&typeof api.getRowElement==="function"){
          if(candidates.has(api)&&candidates.get(api)!==props.entries)return {status:"ambiguous"};
          candidates.set(api,props.entries);
        }else if(typeof (owner.ref?.current||props.ref?.current)?.scrollToMessage==="function")messageOnly=true;
      }
    }
    if(candidates.size!==1)return {status:candidates.size?"ambiguous":messageOnly?"uncancellable":"unsupported"};
    const [[api,entries]]=candidates;if(entries.length>30000)return {status:"budget"};
    const witnessIds=ids(witness),start=performance.now();let target,proof;
    for(const entry of entries){
      const members=entry?.turn?.messageIds;if(!Array.isArray(members)||members.length>512)return {status:"unsupported"};
      if(members.includes(id)){if(target)return {status:"ambiguous"};target=entry;}
      if(members.some(v=>witnessIds.includes(v))){if(proof)return {status:"ambiguous"};proof=entry;}
      if(performance.now()-start>12)return {status:"budget"};
    }
    if(!target)return {status:"not-loaded"};
    if(!proof||!validKey(proof.turnKey)||!validKey(target.turnKey))return {status:"no-witness"};
    const anchor=api.getRowElement(proof.turnKey);
    if(!scope.contains(anchor)||!anchor?.contains(witness)||witness.closest("[data-turn-key]")?.getAttribute("data-turn-key")!==proof.turnKey)
      return {status:"no-witness"};
    return {api,key:target.turnKey,witness:anchor,witnessKey:proof.turnKey};
  }
  document.addEventListener(channel+"-cancel",event=>{
    if(event.detail===active?.seq)active.controller.abort();
  });
  document.addEventListener(channel,async event=>{
    const timeline=event.target,conversation=chat();
    if(!conversation||!(timeline instanceof Element)||!timeline.matches('[data-app-action-timeline-scroll][role=region]')||
      timeline.closest('[hidden],[inert],[aria-hidden=true]'))return;
    let request;
    try{request=JSON.parse(event.detail);}catch{return;}
    if(!valid(request?.seq)||!valid(request.id)||request.conversation!==conversation)return;
    const reply=status=>timeline.dispatchEvent(new CustomEvent(channel+"-result",{detail:JSON.stringify({seq:request.seq,status})}));
    const scopes=[...timeline.querySelectorAll("[data-chatgpt-conversation-selection-target]")].filter(n=>
      n.getAttribute("data-chatgpt-conversation-selection-target")===conversation&&!n.closest('[hidden],[inert],[aria-hidden=true]'));
    if(scopes.length!==1)return reply("no-witness");
    const scope=scopes[0],controller=new AbortController(),path=location.pathname;
    active?.controller.abort();active={seq:request.seq,controller};
    const abort=()=>controller.abort(),input=e=>{if(e.isTrusted)abort();};
    const current=()=>!controller.signal.aborted&&location.pathname===path&&scope.isConnected&&timeline.contains(scope)&&
      scope.getAttribute("data-chatgpt-conversation-selection-target")===conversation;
    const timer=setTimeout(abort,1800);
    const inputs=["wheel","pointerdown","touchstart","keydown"];
    for(const name of inputs)document.addEventListener(name,input,{capture:true,passive:true});
    addEventListener("pagehide",abort,{once:true});addEventListener("popstate",abort,{once:true});
    try{
      const result=adapter(scope,conversation,request.id);
      if(result.status)return reply(result.status);
      const {api,key}=result;
      if(!request.trial&&(lastTrial?.scope.deref()!==scope||lastTrial.api.deref()!==api))return reply("unverified");
      if(!current())return reply("cancelled");
      const stopped=new Promise(resolve=>controller.signal.addEventListener("abort",resolve,{once:true}));
      const scroll=api.scrollToKey(key,row=>{
        if(!current()||!scope.contains(row))return row;
        return [...row.querySelectorAll(unit)].find(n=>ids(n).includes(request.id))||row;
      },{align:"top",signal:controller.signal});
      await Promise.race([Promise.resolve(scroll),stopped]);
      if(!current())return reply("cancelled");
      const mounted=()=>{
        const row=api.getRowElement(key);
        return scope.contains(row)&&row&&[...(row.matches(unit)?[row]:[]),...row.querySelectorAll(unit)]
          .some(n=>ids(n).includes(request.id)&&n.closest("[data-turn-key]")?.getAttribute("data-turn-key")===key);
      };
      if(!mounted()){
        // Optional fast path: native offsets are meaningful only if the very
        // same coordinate system reproduces a known connected row's position.
        // Never fall back to guessing a row height or scrolling another root.
        if(current()&&typeof api.getEntryGeometry==="function"&&timeline.clientHeight>0&&timeline.scrollHeight>timeline.clientHeight&&
            /^(auto|scroll|overlay)$/.test(getComputedStyle(timeline).overflowY)&&timeline.scrollTop>=0&&result.witness.isConnected&&scope.contains(result.witness)){
          try{
            const origin=api.getEntryGeometry(result.witnessKey)?.startPx,goal=api.getEntryGeometry(key)?.startPx;
            const observed=result.witness.getBoundingClientRect().top-timeline.getBoundingClientRect().top-timeline.clientTop+timeline.scrollTop;
            if(Number.isFinite(origin)&&Number.isFinite(goal)&&Math.abs(origin-observed)<=4&&goal>=0&&goal<timeline.scrollHeight&&current())
              timeline.scrollTo({top:Math.min(goal,timeline.scrollHeight-timeline.clientHeight),behavior:"instant"});
          }catch{/* A private geometry getter is optional. */}
        }
        let watch;
        try{
          await Promise.race([stopped,new Promise(resolve=>{
            if(!current()||mounted()){resolve();return;}
            watch=new MutationObserver(()=>{try{if(!current()||mounted())resolve();}catch{resolve();}});
            watch.observe(scope,{childList:true,subtree:true,attributes:true,attributeFilter:["data-turn-key","data-chatgpt-search-message-ids","data-message-id"]});
          })]);
        }finally{watch?.disconnect();}
      }
      if(!current()||!mounted())return reply("not-loaded");
      if(request.trial)lastTrial={scope:new WeakRef(scope),api:new WeakRef(api)};
      reply("requested");
    }catch{reply("unsupported");}finally{
      clearTimeout(timer);
      for(const name of inputs)document.removeEventListener(name,input,true);
      removeEventListener("pagehide",abort);removeEventListener("popstate",abort);
      if(active?.controller===controller)active=null;
    }
  });
})();
