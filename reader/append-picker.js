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
  function selected(messages,picks,tree,{extended=false}={}){
    if(!picks.size||!extended&&picks.size>LIMIT||[...picks].some(i=>!Number.isInteger(i)||i<0||i>=messages.length))throw Error("Invalid selection");
    const items=[];let question;
    for(const [i,row] of messages.entries()){
      if(row.role==="user")question=picks.has(i)?row.id:null;
      if(picks.has(i))items.push({row,question:tree&&row.role==="assistant"?question:null});
    }
    return items;
  }
  function model(messages){
    const picks=new Set(messages.map((_,i)=>i)),turns=[],owners=[];
    for(let i=0;i<messages.length;i++){
      if(messages[i].role==="user"||!turns.length)turns.push({start:i,end:i+1});
      else turns.at(-1).end=i+1;
      owners[i]=turns.length-1;
    }
    const range=(from,to,value=true)=>{
      if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=messages.length||to>=messages.length)return false;
      for(let i=Math.min(from,to);i<=Math.max(from,to);i++)value?picks.add(i):picks.delete(i);
      return true;
    };
    return {picks,turns,owners,range,
      apply(kind){for(let i=0;i<messages.length;i++){
        const yes=kind==="all"||kind==="invert"&&!picks.has(i)||kind===messages[i].role;
        yes?picks.add(i):picks.delete(i);
      }},
      turn(index,value){const t=turns[index];return !!t&&range(t.start,t.end-1,value);},
      interval(from,to,operation="only"){if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to>turns.length||from>to||
          !["only","add","exclude"].includes(operation))return false;
        if(operation==="only")picks.clear();
        return range(turns[from-1].start,turns[to-1].end-1,operation!=="exclude");},
      turnState(index){const t=turns[index];let count=0;for(let i=t.start;i<t.end;i++)if(picks.has(i))count++;
        return {count,total:t.end-t.start,checked:count===t.end-t.start,partial:count>0&&count<t.end-t.start};}
    };
  }
  function choose(messages,title,preview,signal,{extended=false}={}){
    signal.throwIfAborted();
    const zh=navigator.language.startsWith("zh"),L=(a,b)=>zh?a:b,d=document,owner=d.activeElement;
    const host=d.createElement("div"),root=host.attachShadow({mode:"closed"}),style=d.createElement("style");
    style.textContent=`:host{all:initial}dialog{--paper:#faf9f6;--ink:#24332d;--soft:#52645b;--line:#cbd5cd;--accent:#096c59;color:var(--ink);background:var(--paper);font:14px/1.5 system-ui,sans-serif;color-scheme:light;
      box-sizing:border-box;width:min(34rem,calc(100vw - 24px));max-height:min(78dvh,48rem);padding:0;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px #0003}
      dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#14241e66}header,footer{padding:12px 16px}h2,p{margin:0}h2{font-size:18px}header p{color:var(--soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      section{min-height:90px;overflow:auto;overscroll-behavior:contain;border-block:1px solid var(--line);padding:8px 16px}label{display:flex;gap:8px;align-items:flex-start;min-height:44px;padding-block:6px;cursor:pointer}label span{min-width:0}small{display:block;color:var(--soft);overflow-wrap:anywhere}input{accent-color:var(--accent)}
      .group{border-radius:8px;background:color-mix(in srgb,var(--accent) 7%,var(--paper));margin:0 0 8px;padding:4px 8px}.group>label{font-weight:600;align-items:center}
      [hidden]{display:none!important}.turn-head{display:flex;align-items:center;gap:4px}.turn-head>label{flex:1;min-width:0;font-weight:600;align-items:center}.turn-fold{flex:0 0 44px;padding:0}
      .message{padding-inline-start:20px;border-top:1px solid var(--line)}.message>label{flex:1}.message input{margin-top:4px}.message details{margin:0 0 4px 24px}
      summary{cursor:pointer;min-height:44px;color:var(--accent)}.full-text{max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;font-size:13px}
      .tools,.range,.search{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:4px 16px;flex:none}.tools button{border:1px solid var(--line);border-radius:20px;font-size:12px;padding-inline:10px}
      .range input,.range select{box-sizing:border-box;min-height:44px;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:6px;padding:6px}.range input{width:5em}.range select:focus-visible{outline:2px solid var(--accent)}
      .search input{min-width:0;flex:1;width:100%;min-height:44px;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:6px;padding:6px 10px}
      .notice{font-size:12px;color:var(--soft);padding:0 16px 6px}.notice:empty{display:none}header{display:flex;gap:8px;align-items:center}header>div{min-width:0;flex:1}
      footer,nav{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px}nav{padding:2px 16px}nav span{margin-inline-end:auto}button{min-height:44px;border:0;border-radius:7px;padding:5px 10px;color:var(--accent);background:transparent;font:inherit;cursor:pointer}button:disabled{opacity:.48;cursor:not-allowed}button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
      footer{justify-content:space-between}.next{background:var(--ink);color:var(--paper);font-weight:600}@media(prefers-color-scheme:dark){dialog{color-scheme:dark;--paper:#282d29;--ink:#eff3ef;--soft:#b5c2b8;--line:#4b564d;--accent:#98dcbf}}`;
    const el=(tag,value)=>{const e=d.createElement(tag);if(value!=null)e.textContent=value;return e;};
    return new Promise((resolve,reject)=>{
      const dialog=el("dialog"),head=el("header"),list=el("section"),nav=el("nav"),foot=el("footer"),tools=el("div"),interval=el("div"),search=el("div"),notice=el("p");
      tools.className="tools";interval.className="range";search.className="search";notice.className="notice";notice.setAttribute("role","status");
      const name=L("选择要追加的消息","Choose messages to append");dialog.setAttribute("aria-label",name);
      const heading=el("div");heading.append(el("h2",name),el("p",title));head.append(heading);const count=el("span"),prev=el("button",L("上一页","Previous")),next=el("button",L("下一页","Next"));
      const cancel=el("button",L("取消","Cancel")),confirm=el("button",L("选择 Reader 对话","Choose Reader conversation"));confirm.className="next";count.setAttribute("aria-live","polite");
      const selection=model(messages),picks=selection.picks,folded=new Set();let page=0,settled=false,anchor=null,searchCtl=null,searchTimer,composing=false,indices=messages.map((_,i)=>i),query="";
      const finish=ok=>{if(settled)return;settled=true;clearTimeout(searchTimer);searchCtl?.abort();signal.removeEventListener("abort",abort);dialog.close();host.remove();if(owner?.isConnected)owner.focus?.({preventScroll:true});ok?resolve(picks):reject(new DOMException("Selection cancelled","AbortError"));};
      const abort=()=>finish(false);
      const update=()=>{let turnCount=0;for(const t of selection.turns)for(let i=t.start;i<t.end;i++)if(picks.has(i)){turnCount++;break;}
        count.textContent=L(`已选择 ${picks.size} / ${messages.length} 条消息 · ${turnCount} 轮`,`${picks.size} / ${messages.length} messages selected · ${turnCount} turns`);confirm.disabled=!picks.size||!extended&&picks.size>LIMIT;
        if(!extended&&picks.size>LIMIT)notice.textContent=L("此 Reader 仍使用旧版追加合同。更新 Reader 后可一次追加全部；当前勾选未截断，也未发送。","This Reader uses the legacy append contract. Update Reader to append this selection together. Nothing was truncated or sent.");
        else if(!searchCtl)notice.textContent=query?L(`匹配 ${indices.length} 条；筛选不会改变勾选。`,`${indices.length} matches; filtering does not change selection.`):"";
        list.querySelectorAll("input[data-index]").forEach(i=>{i.checked=picks.has(Number(i.dataset.index));});
        list.querySelectorAll("input[data-turn]").forEach(i=>{const state=selection.turnState(Number(i.dataset.turn));i.checked=state.checked;i.indeterminate=state.partial;});
      };
      for(const [kind,cn,en] of [["all","全选","All"],["none","清空","Clear"],["user","只选提问","Questions"],["assistant","只选回答","Answers"],["invert","反选","Invert"]]){
        const b=el("button",L(cn,en));b.type="button";b.onclick=()=>{selection.apply(kind);update();};tools.append(b);
      }
      const from=el("input"),to=el("input"),operation=el("select"),applyRange=el("button",L("应用","Apply"));
      operation.setAttribute("aria-label",L("区间操作","Range action"));
      for(const [value,cn,en] of [["only","仅选此区间","Select only this range"],["add","加入选择","Add to selection"],["exclude","排除此区间","Exclude this range"]]){
        const option=el("option",L(cn,en));option.value=value;operation.append(option);
      }
      for(const [input,label] of [[from,L("起始轮次","First turn")],[to,L("结束轮次","Last turn")]]){
        input.type="number";input.min="1";input.max=String(selection.turns.length);input.setAttribute("aria-label",label);
      }from.value="1";to.value=String(selection.turns.length);
      applyRange.onclick=()=>{if(!selection.interval(Number(from.value),Number(to.value),operation.value)){notice.textContent=L("请输入有效的起止轮次。","Enter a valid turn range.");return;}anchor=null;update();};
      interval.append(el("span",L("轮次","Turns")),from,el("span",L("至","to")),to,operation,applyRange);
      const input=el("input");input.type="search";input.placeholder=L("搜索完整正文…","Search full messages…");input.setAttribute("aria-label",input.placeholder);search.append(input);
      const schedule=()=>{searchCtl?.abort();clearTimeout(searchTimer);searchTimer=setTimeout(()=>void find(),180);};
      input.oninput=()=>{if(!composing)schedule();};input.oncompositionstart=()=>{composing=true;searchCtl?.abort();clearTimeout(searchTimer);};input.oncompositionend=()=>{composing=false;schedule();};
      async function find(){
        const ctl=new AbortController();searchCtl=ctl;query=input.value.trim();page=0;const matches=[],needle=query.toLocaleLowerCase();
        try{for(let i=0;i<messages.length;i++){
          if(ctl.signal.aborted||signal.aborted||settled)return;
          if(!needle||String(await preview(messages[i],ctl.signal)).toLocaleLowerCase().includes(needle))matches.push(i);
          if(i%16===0){notice.textContent=L(`正在搜索 ${i+1} / ${messages.length} 条`, `Searching ${i+1} / ${messages.length}`);
            await new Promise(r=>setTimeout(r,0));}
        }
        if(ctl.signal.aborted||signal.aborted||settled)return;indices=matches;searchCtl=null;paint();
        }catch(e){if(!ctl.signal.aborted&&!settled){searchCtl=null;notice.textContent=L("正文搜索中断；已选范围保留，可重试。","Search interrupted; your selection is retained. Retry.");}}
      }
      function paint(){
        list.replaceChildren();prev.disabled=!page;next.disabled=(page+1)*PAGE>=indices.length;prev.hidden=next.hidden=indices.length<=PAGE;
        let group,turn=-1;
        for(const i of indices.slice(page*PAGE,(page+1)*PAGE)){
          const m=messages[i],currentTurn=selection.owners[i];
          if(currentTurn!==turn){turn=currentTurn;group=el("div");group.className="group";
            const head=el("div"),label=el("label"),check=el("input");head.className="turn-head";check.type="checkbox";check.dataset.turn=String(turn);
            const start=selection.turns[turn].start,title=messages[start].title||messages[start].summary||"";
            label.append(check,el("span",L(`第 ${turn+1} 轮`,`Turn ${turn+1}`)+(title?" · "+snippet(title):"")));
            const fold=el("button",folded.has(turn)?"▸":"▾"),ownedGroup=group;fold.type="button";fold.className="turn-fold";
            fold.setAttribute("aria-label",L(`展开或折叠第 ${turn+1} 轮`,`Expand or collapse turn ${turn+1}`));
            fold.setAttribute("aria-expanded",String(!folded.has(turn)));
            fold.onclick=()=>{const open=folded.has(currentTurn);open?folded.delete(currentTurn):folded.add(currentTurn);
              fold.textContent=open?"▾":"▸";fold.setAttribute("aria-expanded",String(open));ownedGroup.querySelectorAll(".message").forEach(row=>{row.hidden=!open;});};
            head.append(label,fold);group.append(head);list.append(group);
            let shift=false;check.onclick=e=>{shift=e.shiftKey;};
            check.onchange=()=>{if(shift&&anchor!==null){const prior=selection.turns[selection.owners[anchor]],now=selection.turns[currentTurn];
                selection.range(Math.min(prior.start,now.start),Math.max(prior.end,now.end)-1,check.checked);
              }else selection.turn(currentTurn,check.checked);anchor=start;shift=false;update();};}
          const row=el("div"),label=el("label"),check=el("input"),content=el("span");row.className="message";
          row.hidden=folded.has(currentTurn);
          check.type="checkbox";check.dataset.index=String(i);check.checked=picks.has(i);const role=m.role==="user"?L("提问","Question"):L("回答","Answer");
          check.setAttribute("aria-label",`${i+1} · ${role}`);let shift=false;
          check.onclick=e=>{shift=e.shiftKey;};check.onchange=()=>{if(shift&&anchor!==null)selection.range(anchor,i,check.checked);else check.checked?picks.add(i):picks.delete(i);anchor=i;shift=false;update();};
          content.append(el("strong",role),el("small",snippet(m.title||m.summary||m.md||"")||L("按需预览正文","Preview message")));
          label.append(check,content);row.append(label);
          const detail=el("details"),summary=el("summary",L("预览完整正文","Preview full message"));detail.append(summary);
          detail.ontoggle=async()=>{if(!detail.open){detail.replaceChildren(summary);return;}let body=detail.querySelector("pre");if(body)return;
            body=el("pre",L("正在读取…","Reading…"));body.className="full-text";detail.append(body);
            try{const value=await preview(m,signal);if(detail.isConnected&&body.isConnected&&detail.open&&!settled)body.textContent=value;}
            catch{if(body.isConnected)body.textContent=L("正文未读取，收起后重试。","Message unavailable. Reopen to retry.");}
          };row.append(detail);group.append(row);
        }
        if(!indices.length)list.append(el("p",L("没有匹配的消息。","No matching messages.")));
        list.scrollTop=0;update();
      }
      prev.onclick=()=>{page--;paint();};next.onclick=()=>{page++;paint();};cancel.onclick=abort;confirm.onclick=e=>{if(e.isTrusted&&picks.size&&(extended||picks.size<=LIMIT))finish(true);};
      dialog.addEventListener("cancel",e=>{e.preventDefault();abort();});signal.addEventListener("abort",abort,{once:true});
      nav.append(count,prev,next);foot.append(cancel,confirm);dialog.append(head,tools,interval,search,notice,nav,list,foot);root.append(style,dialog);d.body.append(host);paint();dialog.showModal();list.querySelector("input")?.focus();
    });
  }
  return {choose,selected,snippet,model};
})();
