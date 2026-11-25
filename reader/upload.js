// Resume only the exact, already-authorized package. Each returned offset acknowledges durable server bytes.
globalThis.ReaderUpload = async ({request,key,file,binding,report,signal}) => {
  const endpoint="transfers/"+key;
  const receipt=await (await request("requests/"+key)).json();if(receipt.id)return receipt;
  let state=await (await request(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(binding)})).json();
  if(state.id)return state;
  if(file.size!==binding.size||state.size!==file.size||!Number.isSafeInteger(state.offset)||state.offset<0||state.offset>file.size||
    !Number.isSafeInteger(state.chunk_bytes)||state.chunk_bytes<=0||state.chunk_bytes>8*1024*1024)throw Error("Invalid transfer receipt.");
  report({stage:"upload",done:state.offset,total:file.size});
  while(state.offset<file.size){
    signal?.throwIfAborted();
    const end=Math.min(state.offset+state.chunk_bytes,file.size),part=file.slice(state.offset,end);
    const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",await part.arrayBuffer()));
    const form=new FormData();form.append("offset",String(state.offset));
    form.append("sha256",Array.from(digest,x=>x.toString(16).padStart(2,"0")).join(""));form.append("chunk",part,"chunk");
    const ack=await (await request(endpoint+"/chunks",{method:"POST",body:form,signal})).json();
    if(ack.offset!==end||ack.size!==file.size)throw Error("Unconfirmed Reader upload offset.");
    state.offset=end;report({stage:"upload",done:end,total:file.size});
  }
  return (await request(endpoint+"/finish",{method:"POST",signal})).json();
};
