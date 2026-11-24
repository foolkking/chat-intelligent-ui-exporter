// Poll only states in which Reader can still make progress without the user.
globalThis.ReaderTransferState = s => {
  if(s.status==="committed") return /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(s.conversation_id||"")
    ? {phase:"done",active:false,cid:s.conversation_id,title:String(s.title||"").slice(0,512),review:null,
       result:s.result?.version===1?s.result:null,settledAt:Date.now()}
    : {phase:"result-unavailable",active:false,cid:null,title:null,review:null};
  if(s.status==="canceled"||s.status==="cancelled"||s.state==="CANCELED")return {phase:"cancelled",active:false,review:null};
  if(["paused","blocked","failed","needs_grouping","resolving"].includes(s.status)||
    ["PAUSED","BLOCKED","FAILED","NEEDS_GROUPING","RESOLVING"].includes(s.state))return {phase:"attention",active:false,review:null};
  if(s.wait)return {phase:"resource-wait",active:true,percent:s.progress};
  if(["analyzing","queued","processing"].includes(s.status)||
    ["COLLECTING","ANALYZING","IMPORTING","CANCELING"].includes(s.state))return {phase:"processing",active:true,percent:s.progress};
  return {phase:"check",active:false,review:null};
};
