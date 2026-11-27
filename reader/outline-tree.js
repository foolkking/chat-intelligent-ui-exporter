// One model per checked source. Source bytes remain in its provider. Only a
// confirmed landing (or the verified initial reading position) moves the window.
globalThis.ReaderChapterWindow=({rows,load,valid,patch,error})=>{
  const turns=[],order=new Map(),owner=new Map(),cache=new Map(),pending=new Map();
  let center=-1,allowed=new Set(),generation=0,controller=new AbortController();
  for(const [i,row] of rows.entries()){
    if(row.role==="user"||!turns.length)turns.push({q:row.role==="user"?row:null,answers:[]});
    if(row.role!=="user")turns.at(-1).answers.push(row);
    order.set(row.id,i);owner.set(row.id,turns.length-1);
  }
  const first=i=>turns[i]?.q||turns[i]?.answers[0];
  const equal=(a,b)=>a.length===b.length&&a.every((h,i)=>h.text===b[i].text&&h.level===b[i].level);
  function refresh(id,changes){
    const item=cache.get(id),row=rows[order.get(id)],stamp=ReaderPageIndex.renderState(id);
    if(!item||item.stamp?.node===stamp.node&&item.stamp?.version===stamp.version)return;
    const headings=ReaderPageIndex.localHeadings(row,item.source);
    item.stamp=stamp;
    if(!item.detail||!equal(headings,item.detail.headings)){
      item.detail={id,headings,sections:ReaderPageIndex.sections({id,headings})};changes.set(id,item.detail);
    }
  }
  function pause(){generation++;controller.abort();controller=new AbortController();pending.clear();}
  function request(id){
    const index=owner.get(id);if(!allowed.has(index)||!valid())return Promise.resolve();
    const turn=turns[index],token=generation,signal=controller.signal;
    const active=()=>generation===token&&!signal.aborted&&allowed.has(index)&&valid();
    const read=async row=>{
      const headings=await load(row.id,signal);if(!active())return;
      cache.set(row.id,{source:headings});const updates=new Map();refresh(row.id,updates);patch(updates);
    };
    return (async()=>{
      let budget=performance.now()+8;
      // A later answer in a multi-answer turn can itself be the clicked target.
      const selected=turn.answers.find(a=>a.id===id);
      for(const row of selected?[selected,...turn.answers.filter(a=>a!==selected)]:turn.answers){
        if(!active())break;if(cache.has(row.id))continue;
        if(!pending.has(row.id))pending.set(row.id,read(row).finally(()=>{if(generation===token)pending.delete(row.id);}));
        try{await pending.get(row.id);}catch(e){if(active())error(e);}
        if(performance.now()>=budget){await new Promise(resolve=>setTimeout(resolve,0));budget=performance.now()+8;}
      }
    })();
  }
  function move(id){
    const index=owner.get(id);if(index===undefined||!valid())return;
    if(index!==center){
      pause();const old=center;center=index;allowed=new Set();
      for(let i=Math.max(0,index-1);i<=Math.min(turns.length-1,index+2);i++)allowed.add(i);
      const updates=new Map();
      for(const key of cache.keys())if(!allowed.has(owner.get(key))){cache.delete(key);updates.set(key,null);}
      for(const key of cache.keys())refresh(key,updates);
      patch(updates,{open:first(center).id,close:first(old<0?0:old)?.id});
    }
    return request(id);
  }
  return {turns,order,owner,move,request,pause,center:()=>center,detail:id=>cache.get(id)?.detail,
    snapshot:()=>new Map([...cache].map(([id,item])=>[id,item.detail])),
    expanded:()=>Array.from(allowed,i=>first(i).id),centerId:()=>first(center)?.id,
    refresh(){if(!valid())return;const updates=new Map();for(const id of cache.keys())refresh(id,updates);if(updates.size)patch(updates);}};
};

// Transient metadata-only navigation. The owner performs body reads and verified
// source jumps; expanding/revealing this tree never scrolls the conversation.
globalThis.ReaderOutlineTree = ({container,zh=false,onLocate=()=>{},onPreview=()=>{},onBeforeRender=()=>{},onChange=()=>{}}) => {
  const doc=container.ownerDocument,L=(cn,en)=>zh?cn:en,limit=64,estimate=52;
  const make=(tag,cls="",text="")=>{const el=doc.createElement(tag);el.className=cls;el.textContent=text;return el;};
  const root=make("div","reader-outline-tree"),style=make("style"),before=make("div"),after=make("div");
  root.setAttribute("role","tree");root.setAttribute("aria-label",L("对话目录","Conversation outline"));
  before.dataset.spacer="before";after.dataset.spacer="after";
  for(const spacer of [before,after]){spacer.setAttribute("role","presentation");spacer.setAttribute("aria-hidden","true");}
  style.textContent=`
    .reader-outline-tree{font:inherit;color:var(--fg);min-width:0;overflow-anchor:none}
    .reader-outline-tree .outline-row{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;
      padding-inline-start:var(--indent,0px);min-height:52px}
    .reader-outline-tree .outline-row[data-kind=turn]{border-top:1px solid var(--line)}
    .reader-outline-tree .outline-node{font:inherit;min-width:0;width:100%;min-height:52px;display:grid;
      grid-template-columns:44px minmax(0,1fr);align-items:center;border:0;border-radius:5px;padding:0 8px 0 0;
      text-align:start;background:transparent;color:var(--fg);cursor:pointer}
    .reader-outline-tree .outline-node[data-kind=turn]{font-size:12px;font-weight:600;color:var(--sub)}
    .reader-outline-tree .outline-node[data-kind=section]{font-size:13px;color:var(--sub)}
    .reader-outline-tree .outline-label{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
      overflow:hidden;overflow-wrap:anywhere}
    .reader-outline-tree .outline-fold{width:44px;min-height:52px;display:grid;place-items:center;padding:0;text-align:center;color:var(--sub);
      border:0;border-radius:5px;background:transparent;font:inherit;cursor:pointer}
    .reader-outline-tree .outline-node:hover,.reader-outline-tree .outline-fold:hover,
    .reader-outline-tree .outline-node[aria-current=location]{background:var(--sel);color:var(--accent)}
    .reader-outline-tree .outline-node.current-path{color:var(--accent)}
    .reader-outline-tree button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
    .reader-outline-tree .question-preview{grid-column:1/-1;min-width:0}
    .reader-outline-tree .outline-empty{color:var(--sub);padding:8px}
  `;
  let nodes=new Map(),roots=[],visible=[],positions=new Map(),offsets=[0],expanded=new Map(),heights=new Map();
  let activeKey=null,focusKey=null,dead=false,scheduled=0,rendered=[],windowStart=-1,version=0,renderedVersion=-1;
  const renderedNode=new WeakMap();
  const targetKey=target=>!target?.id?null:JSON.stringify(target.heading===undefined?["message",target.id]:["section",target.id,target.heading]);
  const isOpen=node=>node.children.length&&expanded.get(node.key)!==false;
  const owns=()=>root.parentElement===container;
  function focusedKey(){
    const el=root.getRootNode().activeElement;
    return el&&root.contains(el)?el.closest("[data-tree-row]")?.dataset.treeRow:null;
  }
  function flatten(){
    visible=[];positions=new Map();const stack=[...roots].reverse();
    while(stack.length){
      const node=stack.pop();positions.set(node.key,visible.length);visible.push(node);
      if(isOpen(node))for(let i=node.children.length-1;i>=0;i--)stack.push(node.children[i]);
    }
    offsets=[0];for(const node of visible)offsets.push(offsets.at(-1)+(heights.get(node.key)||estimate));
  }
  function atOffset(top){
    let low=0,high=visible.length;
    while(low<high){const mid=(low+high)>>1;if(offsets[mid+1]<=top)low=mid+1;else high=mid;}
    return Math.min(low,Math.max(0,visible.length-1));
  }
  function mark(){
    const path=new Set();for(let node=nodes.get(activeKey)?.parent;node;node=node.parent)path.add(node.key);
    for(const button of rendered){
      const key=button.dataset.key,current=key===activeKey;
      if(current)button.setAttribute("aria-current","location");else button.removeAttribute("aria-current");
      button.classList.toggle("active",current);button.classList.toggle("current-path",path.has(key));
      const node=nodes.get(key);if(node?.children.length){
        button.setAttribute("aria-expanded",String(!!isOpen(node)));button.querySelector(".outline-fold").textContent=isOpen(node)?"▾":"▸";
      }else if(button.hasAttribute("aria-expanded")){button.removeAttribute("aria-expanded");button.querySelector(".outline-fold").textContent="";}
      button.tabIndex=key===focusKey?0:-1;
    }
  }
  function schedule(){
    if(dead||scheduled||!owns())return;
    scheduled=requestAnimationFrame(()=>{scheduled=0;if(!dead&&owns())render();});
  }
  const observer=typeof ResizeObserver==="function"?new ResizeObserver(entries=>{
    if(dead||!owns())return;
    const anchor=visible[atOffset(container.scrollTop)],oldTop=anchor&&offsets[positions.get(anchor.key)];
    let changed=false;
    for(const entry of entries){
      const key=entry.target.dataset.treeRow,height=entry.target.getBoundingClientRect().height;
      if(nodes.has(key)&&Number.isFinite(height)&&height>0&&Math.abs(height-(heights.get(key)||estimate))>1){
        heights.set(key,height);changed=true;
      }
    }
    if(changed){
      flatten();if(anchor)container.scrollTop+=offsets[positions.get(anchor.key)]-oldTop;
      schedule();
    }
  }):null;
  function toggle(node,open){
    if(dead||!node.children.length)return;
    expanded.set(node.key,open);flatten();focusKey=node.key;
    show(node.key,true);onChange({kind:"expansion",expanded:open,target:node.target});
  }
  function keydown(event,node){
    if(dead||!owns()||nodes.get(node.key)!==node||!event.isTrusted)return;
    const index=positions.get(node.key);if(index===undefined)return;
    let next;
    switch(event.key){
      case "ArrowDown":next=visible[Math.min(visible.length-1,index+1)];break;
      case "ArrowUp":next=visible[Math.max(0,index-1)];break;
      case "Home":next=visible[0];break;
      case "End":next=visible.at(-1);break;
      case "ArrowRight":
        if(node.children.length&&!isOpen(node))toggle(node,true);else next=node.children[0];
        break;
      case "ArrowLeft":
        if(isOpen(node))toggle(node,false);else next=node.parent;
        break;
      case "Enter":case " ":
        onLocate({...node.target},rendered.find(el=>el.dataset.key===node.key));break;
      default:return;
    }
    event.preventDefault();event.stopPropagation();
    if(next)show(next.key,true);
  }
  function rowElement(node){
    const row=make("div","outline-row"),button=make("button","outline-node"+(node.kind==="question"?" entry":""));
    row.dataset.treeRow=node.key;row.dataset.kind=node.kind;row.setAttribute("role","none");
    row.style.setProperty("--indent",Math.min(48,(node.level-1)*12)+"px");
    button.type="button";button.setAttribute("role","treeitem");button.setAttribute("aria-level",String(node.level));
    button.setAttribute("aria-posinset",String(node.position));button.setAttribute("aria-setsize",String(node.siblings));
    button.dataset.key=node.key;button.dataset.kind=node.kind;button.dataset.mid=node.target.id;
    if(node.target.heading!==undefined)button.dataset.heading=String(node.target.heading);
    if(node.children.length)button.setAttribute("aria-expanded",String(!!isOpen(node)));
    button.append(make("span","outline-label",node.label));row.append(button);
    const fold=make("span","outline-fold",node.children.length?(isOpen(node)?"▾":"▸"):"");
    fold.setAttribute("aria-hidden","true");
    const live=()=>!dead&&owns()&&root.contains(button)&&nodes.get(node.key)===node;
    fold.onclick=e=>{if(node.children.length&&live()&&e.isTrusted){e.stopPropagation();toggle(node,!isOpen(node));}};
    button.prepend(fold);
    button.onfocus=()=>{focusKey=node.key;mark();};
    button.onclick=e=>{if(live()&&e.isTrusted){e.stopPropagation();focusKey=node.key;mark();onLocate({...node.target},button);}};
    button.onkeydown=e=>{if(live())keydown(e,node);};
    if(node.kind==="question")onPreview(node.row,button,row);
    observer?.observe(row);renderedNode.set(button,node);return button;
  }
  function render(){
    if(dead)return;
    const previous=focusedKey(),first=Math.max(0,Math.min(Math.max(0,visible.length-limit),atOffset(container.scrollTop)-8));
    const end=Math.min(visible.length,first+limit),windowNodes=visible.slice(first,end);
    before.style.height=offsets[first]+"px";after.style.height=Math.max(0,offsets.at(-1)-offsets[end])+"px";
    // Scrolling within the mounted window must not tear down an on-demand
    // question preview or move keyboard focus.
    if(owns()&&first===windowStart&&version===renderedVersion&&rendered.length===windowNodes.length&&
      rendered.every((button,i)=>renderedNode.get(button)===windowNodes[i])){mark();return;}
    const keep=new Set(windowNodes),prior=new Map();
    for(const button of rendered)if(keep.has(renderedNode.get(button)))prior.set(renderedNode.get(button),button);
    if(prior.size!==rendered.length||!owns())onBeforeRender();
    for(const button of rendered)if(!keep.has(renderedNode.get(button))){observer?.unobserve?.(button.parentElement);button.parentElement.remove();}
    windowStart=first;renderedVersion=version;
    if(!windowNodes.some(node=>node.key===focusKey))focusKey=windowNodes[0]?.key||null;
    if(!before.parentElement)root.append(style,before,after);
    root.querySelector(".outline-empty")?.remove();
    rendered=windowNodes.map(node=>prior.get(node)||rowElement(node));
    let anchor=before;
    for(const button of rendered){
      const row=button.parentElement;
      if(anchor.nextSibling!==row)root.insertBefore(row,anchor.nextSibling);
      anchor=row;
    }
    if(!visible.length)root.insertBefore(make("p","outline-empty",L("没有消息。","No messages.")),after);
    if(!owns())container.replaceChildren(root);
    mark();
    if(previous)rendered.find(button=>button.dataset.key===focusKey)?.focus({preventScroll:true});
  }
  function show(key,focus=false){
    if(dead||!nodes.has(key))return false;
    const node=nodes.get(key);let changed=false;
    for(let parent=node.parent;parent;parent=parent.parent)if(!isOpen(parent)){expanded.set(parent.key,true);changed=true;}
    if(changed)flatten();
    const index=positions.get(key),top=offsets[index],bottom=offsets[index+1],height=container.clientHeight||300;
    if(top<container.scrollTop||bottom>container.scrollTop+height)container.scrollTop=Math.max(0,top-Math.min(80,height/3));
    if(focus)focusKey=key;
    render();
    if(focus)rendered.find(button=>button.dataset.key===key)?.focus({preventScroll:true});
    return true;
  }
  function add(key,kind,target,label,parent,row){
    const node={key,kind,target,label,parent,row,level:(parent?.level||0)+1,children:[]};
    nodes.set(key,node);(parent?.children||roots).push(node);return node;
  }
  function addSections(parent,sections){
    const added=[];
    for(const section of sections){
      const owner=section.parent===null?parent:added[section.parent];
      added[section.index]=add(targetKey(section.target),"section",{...section.target},section.text,owner);
    }
    for(const node of [parent,...added])node.children.forEach((child,i)=>{child.position=i+1;child.siblings=node.children.length;});
  }
  function patchChapters(updates,window){
    if(dead)return;
    for(const [id,detail] of updates){
      const parent=nodes.get(targetKey({id}));if(!parent)continue;
      const active=nodes.get(activeKey),focus=nodes.get(focusKey);
      const stack=parent.children.splice(0);
      while(stack.length){const old=stack.pop();stack.push(...old.children);nodes.delete(old.key);heights.delete(old.key);expanded.delete(old.key);}
      if(detail)addSections(parent,detail.sections);
      // A reused ordinal may now name another chapter. Preserve the owning
      // answer until its actual current heading has been re-verified.
      if(active&&nodes.get(activeKey)!==active)activeKey=parent.key;
      if(focus&&nodes.get(focusKey)!==focus)focusKey=parent.key;
    }
    if(window){
      if(window.close)expanded.set(JSON.stringify(["turn",window.close]),false);
      expanded.set(JSON.stringify(["turn",window.open]),true);
    }
    if(updates.size||window){flatten();if(owns())render();}
  }
  function setRows(rows,turns=ReaderPageIndex.tree(rows)){
    if(dead)return;
    const priorFocus=focusedKey();nodes=new Map();roots=[];version++;
    turns.forEach((turn,i)=>{
      const first=turn.q||turn.answers[0];if(!first)return;
      const root=add(JSON.stringify(["turn",first.id]),"turn",{id:first.id},
        L(`第 ${i+1} 轮`,`Turn ${i+1}`)+(first.title?" · "+first.title:""),null);
      if(!expanded.has(root.key))expanded.set(root.key,i===0);
      if(turn.q)add(targetKey({id:turn.q.id}),"question",{id:turn.q.id},L("提问","Question")+" · "+turn.q.title,root,turn.q);
      turn.answers.forEach((answer,i)=>{
        const parent=add(targetKey({id:answer.id}),"answer",{id:answer.id},L(`回答 ${i+1}`,`Answer ${i+1}`),root);
        if(answer.sections?.length)addSections(parent,answer.sections);
      });
    });
    for(const node of nodes.values())node.children.forEach((child,i)=>{child.position=i+1;child.siblings=node.children.length;});
    roots.forEach((node,i)=>{node.position=i+1;node.siblings=roots.length;});
    expanded=new Map([...expanded].filter(([key])=>nodes.has(key)));
    heights=new Map([...heights].filter(([key])=>nodes.has(key)));
    if(!nodes.has(activeKey))activeKey=null;
    if(!nodes.has(focusKey))focusKey=roots[0]?.key||null;
    flatten();
    if(priorFocus&&nodes.has(priorFocus))show(priorFocus,true);else render();
  }
  function setActive(target,options={}){
    if(dead)return;
    const key=targetKey(target),prior=activeKey;activeKey=nodes.has(key)?key:null;
    if(activeKey!==prior&&activeKey&&options.follow!==false&&!options.reveal&&!options.focus){
      let changed=false;
      for(let parent=nodes.get(activeKey).parent;parent;parent=parent.parent)
        if(!isOpen(parent)){expanded.set(parent.key,true);changed=true;}
      // Following the reading path only expands metadata. It never focuses a
      // tree item or scrolls the transcript/list away from a user's inspection.
      if(changed){flatten();render();}
    }
    if(activeKey&&(options.reveal||options.focus))show(activeKey,!!options.focus);else mark();
  }
  function setAll(open){
    if(dead)return;
    for(const node of nodes.values())if(node.children.length)expanded.set(node.key,!!open);
    flatten();version++;render();onChange({kind:"expansion",expanded:!!open});
  }
  function destroy(){
    if(dead)return;
    dead=true;cancelAnimationFrame(scheduled);observer?.disconnect();container.removeEventListener("scroll",schedule);
    if(owns()){onBeforeRender();container.replaceChildren();}
    nodes.clear();roots=[];visible=[];positions.clear();offsets=[];expanded.clear();heights.clear();rendered=[];
  }
  container.addEventListener("scroll",schedule,{passive:true});
  return {setRows,patchChapters,render,setActive,setAll,reveal:(target,options={})=>show(targetKey(target),!!options.focus),destroy};
};
