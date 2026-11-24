// Isolated content world. Operates on already normalized messages only. No network, extension
// credentials, history or disk access. A sparse selection is not continuous source lineage.
globalThis.ReaderExcerpt=(()=>{
  const LIMIT=250, PAGE=24;
  // A bounded label, never the body sent to Reader. Keep link names and code text,
  // not storage references, fence delimiters or long signed download URLs.
  function snippet(body){
    return String(body??"").slice(0,1024)
      .replace(/^\s*(?:`{3,}|~{3,})[^\n]*$/gm,"")
      .replace(/\[!\[([^\]\n]*)\]\([^\n)]*\)\]\([^\n)]*(?:\)|$)/gm,"$1")
      .replace(/!?\[([^\]\n]*)\]\([^\n)]*(?:\)|$)/gm,"$1")
      .replace(/^\s*(?:#{1,6}\s+|>\s*)/gm,"").replace(/\s+/g," ").trim().slice(0,220);
  }
  function selected(messages,picks,tree){
    if(!picks.size||picks.size>LIMIT||[...picks].some(i=>!Number.isInteger(i)||i<0||i>=messages.length))throw Error("Invalid selection");
    const items=[];let question;
    for(const [i,row] of messages.entries()){
      if(row.role==="user")question=picks.has(i)?row.id:null;
      if(picks.has(i))items.push({row,question:tree&&row.role==="assistant"?question:null});
    }
    return items;
  }
  function choose(messages,title,preview,signal){
    signal.throwIfAborted();
    const zh=navigator.language.startsWith("zh"),L=(a,b)=>zh?a:b,d=document,owner=d.activeElement;
    const host=d.createElement("div"),root=host.attachShadow({mode:"closed"}),style=d.createElement("style");
    style.textContent=`:host{all:initial}dialog{--paper:#faf9f6;--ink:#24332d;--soft:#52645b;--line:#cbd5cd;--accent:#096c59;color:var(--ink);background:var(--paper);font:14px/1.5 system-ui,sans-serif;color-scheme:light;
      box-sizing:border-box;width:min(34rem,calc(100vw - 24px));max-height:min(78dvh,48rem);padding:0;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px #0003}
      dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#14241e66}header,footer{padding:12px 16px}h2,p{margin:0}h2{font-size:18px}header p{color:var(--soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      section{min-height:90px;overflow:auto;overscroll-behavior:contain;border-block:1px solid var(--line);padding-inline:16px}label{display:flex;gap:8px;align-items:flex-start;min-height:44px;padding-block:6px;border-bottom:1px solid var(--line);cursor:pointer}label:last-child{border:0}label span{min-width:0}small{display:block;color:var(--soft);overflow-wrap:anywhere}input{margin-top:5px;accent-color:var(--accent)}
      footer,nav{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px}nav{padding:2px 16px}nav span{margin-inline-end:auto}button{min-height:44px;border:0;border-radius:7px;padding:5px 10px;color:var(--accent);background:transparent;font:inherit;cursor:pointer}button:disabled{opacity:.48;cursor:not-allowed}button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
      footer{justify-content:space-between}.next{background:var(--ink);color:var(--paper);font-weight:600}@media(prefers-color-scheme:dark){dialog{color-scheme:dark;--paper:#282d29;--ink:#eff3ef;--soft:#b5c2b8;--line:#4b564d;--accent:#98dcbf}}`;
    const el=(tag,value)=>{const e=d.createElement(tag);if(value!=null)e.textContent=value;return e;};
    return new Promise((resolve,reject)=>{
      const dialog=el("dialog"),head=el("header"),list=el("section"),nav=el("nav"),foot=el("footer");
      const name=L("选择要追加的消息","Choose messages to append");dialog.setAttribute("aria-label",name);
      head.append(el("h2",name),el("p",title));const count=el("span"),prev=el("button",L("上一页","Previous")),next=el("button",L("下一页","Next"));
      const cancel=el("button",L("取消","Cancel")),confirm=el("button",L("选择 Reader 对话","Choose Reader conversation"));confirm.className="next";count.setAttribute("aria-live","polite");
      const picks=new Set();let page=0,settled=false;
      const finish=ok=>{if(settled)return;settled=true;signal.removeEventListener("abort",abort);dialog.close();host.remove();if(owner?.isConnected)owner.focus?.({preventScroll:true});ok?resolve(picks):reject(new DOMException("Selection cancelled","AbortError"));};
      const abort=()=>finish(false);
      const update=()=>{count.textContent=L(`共 ${messages.length} 条 · 已选 ${picks.size} 条`,`${messages.length} messages · ${picks.size} selected`)+(picks.size===LIMIT&&messages.length>LIMIT?L("（已达单次上限）"," (selection limit reached)"):"");confirm.disabled=!picks.size;
        list.querySelectorAll("input").forEach(i=>{i.disabled=picks.size>=LIMIT&&!i.checked;});};
      function paint(){
        list.replaceChildren();prev.disabled=!page;next.disabled=(page+1)*PAGE>=messages.length;prev.hidden=next.hidden=messages.length<=PAGE;
        for(let i=page*PAGE;i<Math.min(messages.length,(page+1)*PAGE);i++){
          const m=messages[i],label=el("label"),check=el("input"),content=el("span");
          check.type="checkbox";check.checked=picks.has(i);const role=m.role==="user"?L("提问","User"):L("回答","Assistant");
          check.setAttribute("aria-label",`${i+1} · ${role}`);check.onchange=()=>{if(check.checked&&picks.size<LIMIT)picks.add(i);else{picks.delete(i);check.checked=false;}update();};
          content.append(el("strong",`${i+1} · ${role}`),el("small",snippet(preview(m))||L("无文字","No text")));label.append(check,content);list.append(label);
        }
        list.scrollTop=0;update();
      }
      prev.onclick=()=>{page--;paint();};next.onclick=()=>{page++;paint();};cancel.onclick=abort;confirm.onclick=e=>{if(e.isTrusted&&picks.size)finish(true);};
      dialog.addEventListener("cancel",e=>{e.preventDefault();abort();});signal.addEventListener("abort",abort,{once:true});
      nav.append(count,prev,next);foot.append(cancel,confirm);dialog.append(head,nav,list,foot);root.append(style,dialog);d.body.append(host);paint();dialog.showModal();list.querySelector("input")?.focus();
    });
  }
  return {choose,selected,snippet};
})();
