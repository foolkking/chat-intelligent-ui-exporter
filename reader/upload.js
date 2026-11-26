// Resume only the exact, already-authorized package. Each returned offset acknowledges durable server bytes.
globalThis.ReaderUpload = async ({request,key,file,binding,report,signal,retryLimit=0,onRetry=()=>{}}) => {
  const endpoint="transfers/"+key,body=JSON.stringify(binding),size=binding.size;
  const limit=Number.isSafeInteger(retryLimit)&&retryLimit>=0?Math.min(retryLimit,2):0;
  async function call(route,opts={}){
    signal?.throwIfAborted();
    try{return await (await request(route,{...opts,signal})).json();}
    catch(e){if(e.name==="TypeError"&&e.status==null)e.code="NETWORK_UNAVAILABLE";throw e;}
  }
  async function attempt(){
    // This is also the recovery path: never blindly resend an uncertain chunk
    // or finish, and never change the authorized key, file or target binding.
    const receipt=await call("requests/"+key);if(receipt.id)return receipt;
    let state=await call(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body});
    if(state.id)return state;
    if(file.size!==size||state.size!==file.size||!Number.isSafeInteger(state.offset)||state.offset<0||state.offset>file.size||
      !Number.isSafeInteger(state.chunk_bytes)||state.chunk_bytes<=0||state.chunk_bytes>8*1024*1024)
      throw Object.assign(Error("Invalid transfer receipt."),{code:"UPLOAD_RECEIPT_INVALID"});
    report({stage:"upload",done:state.offset,total:file.size,uploadBytes:state.offset});
    while(state.offset<file.size){
      signal?.throwIfAborted();
      const end=Math.min(state.offset+state.chunk_bytes,file.size),part=file.slice(state.offset,end);
      const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",await part.arrayBuffer()));
      const form=new FormData();form.append("offset",String(state.offset));
      form.append("sha256",Array.from(digest,x=>x.toString(16).padStart(2,"0")).join(""));form.append("chunk",part,"chunk");
      const ack=await call(endpoint+"/chunks",{method:"POST",body:form});
      if(ack.offset!==end||ack.size!==file.size)
        throw Object.assign(Error("Unconfirmed Reader upload offset."),{code:"UPLOAD_OFFSET_INVALID"});
      state.offset=end;report({stage:"upload",done:end,total:file.size,uploadBytes:end});
    }
    return call(endpoint+"/finish",{method:"POST"});
  }
  for(let retry=0;;retry++){
    try{return await attempt();}
    catch(e){
      if(retry>=limit||signal?.aborted||e.code!=="NETWORK_UNAVAILABLE"||e.status!=null)throw e;
      await onRetry();
      await new Promise(resolve=>setTimeout(resolve,200*(retry+1)));
    }
  }
};
