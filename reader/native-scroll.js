// Page replies are hints. Only ReaderPageIndex can certify a landing.
globalThis.ReaderNativeScroll=(()=>{
  const channel="reader-native-row-v1";
  const states=new Set(["requested","no-witness","unverified","ambiguous","uncancellable","unsupported","budget","not-loaded","cancelled"]);
  function prepare(id,signal,{trial=false}={}){
    signal.throwIfAborted();
    const root=ChatExportSourceDOM.timeline(),conversation=ReaderRoutes.chat(location.pathname);
    if(!conversation||root?.getAttribute?.("role")!=="region")return Promise.resolve("unsupported");
    const seq=crypto.randomUUID();
    return new Promise(resolve=>{
      const finish=status=>{
        clearTimeout(timer);root.removeEventListener(channel+"-result",receive);signal.removeEventListener("abort",cancel);resolve(status);
      };
      const cancel=()=>{document.dispatchEvent(new CustomEvent(channel+"-cancel",{detail:seq}));finish("cancelled");};
      const receive=e=>{
        let result;try{result=JSON.parse(e.detail);}catch{return;}
        if(result?.seq===seq&&states.has(result.status))finish(result.status);
      };
      const timer=setTimeout(cancel,2100);
      signal.addEventListener("abort",cancel,{once:true});root.addEventListener(channel+"-result",receive);
      root.dispatchEvent(new CustomEvent(channel,{bubbles:true,detail:JSON.stringify({seq,conversation,id,trial})}));
    });
  }
  return {prepare};
})();
