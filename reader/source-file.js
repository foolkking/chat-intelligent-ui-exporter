// Index a browser-backed Blob using UTF-8 byte ranges. Only the selected node/page item is decoded.
globalThis.ReaderSourceFile = (() => {
  const decoder = new TextDecoder("utf-8", {fatal:true});
  const ws = b => b===32 || b===13 || b===10 || b===9;
  function invalid(code="SOURCE_FORMAT_INVALID",message="Unrecognized conversation source.") { throw Object.assign(Error(message),{code}); }
  const branchFailure=()=>invalid("SOURCE_BRANCH_UNVERIFIED","The displayed branch could not be confirmed.");
  function decode(bytes){try{return JSON.parse(decoder.decode(bytes));}catch{invalid();}}
  function fileReader(file,cache={start:-1,window:new Uint8Array()}) {
    return async (a,b) => {
      if (!(a >= 0 && b >= a && b <= file.size)) invalid();
      // A large record is decoded once but never retained as a parser cache.
      // Paginated sources share one small window instead of one per page.
      if(b-a>262144)return decode(await file.slice(a,b).arrayBuffer());
      if (cache.file!==file || a < cache.start || b > cache.start + cache.window.length) {
        cache.file=file;cache.start=a;
        cache.window=new Uint8Array(await file.slice(a,a+262144).arrayBuffer());
      }
      return decode(cache.window.subarray(a-cache.start,b-cache.start));
    };
  }
  // Yield object fields or array items. Delimiters in escaped strings or nested containers never split a value.
  async function* entries(file, begin, end, object, check = ()=>{}) {
    const get=fileReader(file), open=object?123:91, close=object?125:93;
    let pos=begin,state="open",a=0,key=null,quoted=false,escape=false,bom=0;
    const stack=[];
    const stream=file.slice(begin,end).stream().getReader();
    try {
      for (;;) {
        check();const {done,value}=await stream.read();if(done)break;
        for(let i=0;i<value.length;i++,pos++) {
          const b=value[i];
          if(bom){if(b!==(bom===1?187:191))invalid();bom=bom===1?2:0;continue;}
          if(begin===0&&pos===0&&b===239){bom=1;continue;}
          if(quoted) {
            if(escape)escape=false;
            else if(b===92)escape=true;
            else if(b===34) {
              quoted=false;
              if(state==="key"){key=await get(a,pos+1);state="colon";}
            }
            continue;
          }
          if(state==="value" && !stack.length && (b===44||b===close)) {
            if(pos===a)invalid();
            yield {key,start:a,end:pos};
            key=null;state=b===close?"done":"next";continue;
          }
          if(state==="value"){
            if(b===34)quoted=true;
            else if(b===123||b===91)stack.push(b===123?125:93);
            else if((b===125||b===93)&&stack.pop()!==b)invalid();
            continue;
          }
          if(ws(b))continue;
          if(state==="open"&&b===open){state="first";continue;}
          if(state==="first"&&b===close){state="done";continue;}
          if(state==="first"||state==="next"){
            if(object){if(b!==34)invalid();a=pos;state="key";quoted=true;continue;}
            state="start";
          }
          if(state==="colon"&&b===58){state="start";continue;}
          if(state!=="start"||[44,93,125,58].includes(b))invalid();
          a=pos;state="value";if(b===34)quoted=true;
          if(b===123||b===91)stack.push(b===123?125:93);
        }
      }
      if(state!=="done")invalid();
    }finally{await stream.cancel().catch(()=>{});stream.releaseLock();}
  }
  async function header(file,check,projectNames=false) {
    const fields=new Map(),get=fileReader(file);
    const wanted=new Set(["id","conversation_id","project_id","title","update_time","mapping","messages","current_node","page_info"]);
    if(projectNames){wanted.add("project_name");wanted.add("project_title");}
    for await(const f of entries(file,0,file.size,true,check)) {
      if(!wanted.has(f.key))continue;
      if(fields.has(f.key))invalid();
      if((f.key==="project_name"||f.key==="project_title")&&f.end-f.start>8192){fields.set(f.key,null);continue;}
      fields.set(f.key,["mapping","messages"].includes(f.key)?f:await get(f.start,f.end));
    }
    return Object.fromEntries(fields);
  }
  const valid=id=>typeof id==="string"&&/^[\w-]{1,128}$/.test(id);
  async function tree(file,h,leaf,check,report) {
    const range=h.mapping;if(!range)invalid();
    const nodes=new Map(),get=fileReader(file);let candidate,ambiguous=false;
    for await(const f of entries(file,range.start,range.end,true,check)) {
      if(!valid(f.key)||nodes.has(f.key))invalid();
      const n=await get(f.start,f.end);
      if(!n || n.parent!=null&&!valid(n.parent) || n.children!=null&&(!Array.isArray(n.children)||!n.children.every(valid)))invalid();
      nodes.set(f.key,{parent:n.parent,children:n.children||[],message:n.message?.id,hasMessage:n.message!=null,from:f.start,to:f.end});
      if(leaf&&n.message?.id===leaf){if(candidate)ambiguous=true;candidate=f.key;}
      if(nodes.size%64===0)report({stage:"index",done:nodes.size});
    }
    report({stage:"index",done:nodes.size});
    check();if(!nodes.has(leaf)&&ambiguous)branchFailure();
    const selected=nodes.has(leaf)?leaf:candidate;
    if(leaf&&!selected)branchFailure();
    let last=selected||h.current_node;
    if(selected&&h.current_node) {
      const seen=new Set();
      for(let id=h.current_node;id;id=nodes.get(id)?.parent){
        if(seen.has(id))branchFailure();seen.add(id);
        if(id===selected){last=h.current_node;break;}
      }
    }
    const seen=new Set();
    while(nodes.get(last)?.children.length) {
      const children=nodes.get(last).children;
      if(children.length!==1||seen.has(last))branchFailure();
      seen.add(last);last=children[0];
    }
    if(!nodes.has(last))branchFailure();
    seen.clear();const branch=[],ids=new Set();
    for(let id=last;id!=null;id=nodes.get(id).parent) {
      if(seen.has(id)||!nodes.has(id))branchFailure();seen.add(id);branch.push(id);
      if(nodes.get(id).message){if(ids.has(nodes.get(id).message))branchFailure();ids.add(nodes.get(id).message);}
    }
    if(selected&&!seen.has(selected))branchFailure();
    branch.reverse();const warnings=[],byMessage=new Map(branch.filter(k=>nodes.get(k).message).map(k=>[nodes.get(k).message,k]));
    async function row(id){
      check();const key=byMessage.get(id);if(!key)return null;
      const n=nodes.get(key),raw=await get(n.from,n.to);
      return FastTextExporter.records([raw.message],{allowEmpty:true}).messages.find(m=>m.id===id)||null;
    }
    async function* rows() {
      let segment=[];const displayed=new Set();
      for(const key of branch){
        check();segment.push(key);
        const n=nodes.get(key);if(!n.hasMessage)continue;
        const raw=await get(n.from,n.to);
        const result=FastTextExporter.records([raw.message],{allowEmpty:true});
        if(result.warnings.length)warnings.push(...result.warnings.map(()=>true));
        for(const row of result.messages){
          if(!valid(row.id)||displayed.has(row.id))invalid();
          displayed.add(row.id);row.sourcePath=segment;segment=[];yield row;
        }
      }
      if(!displayed.size)invalid();
    }
    // DOM attributes can name mapping nodes rather than message IDs. Expose
    // only aliases on the validated branch; keep row IDs and wire paths intact.
    const identities=new Set([...branch,...ids]);
    return {title:h.title||"ChatGPT",branch:last,source:"conversation-tree",ids,identities,rows,row,warnings};
  }
  // The fork owns source selection and requests. These callbacks only consume each authorized response.
  function conversation(id,leaf,check,report=()=>{}) {
    const keys=new Map(),cache={start:-1,window:new Uint8Array()};let title;
    async function read(response,page) {
      const file=await response.readerFile(page);
      report({stage:"index"});
      const h=await header(file,check);
      if(h.conversation_id!=null&&h.conversation_id!==id)branchFailure();
      return {file,h};
    }
    return {
      async tree(response){const {file,h}=await read(response,1);return tree(file,h,leaf,check,report);},
      async page(response,number){
        const {file,h}=await read(response,number);
        if(h.mapping&&number===1)return {result:await tree(file,h,leaf,check,report)};
        if(!h.messages||typeof h.page_info?.has_previous_page!=="boolean")invalid("SOURCE_PAGE_INVALID");
        title||=h.title||"ChatGPT";
        const get=fileReader(file,cache);let ordinal=0;
        for await(const f of entries(file,h.messages.start,h.messages.end,false,check)){
          const value=await get(f.start,f.end),m=value?.message??value;if(!valid(m?.id))invalid("SOURCE_PAGE_INVALID");
          const row={get,from:f.start,to:f.end,time:m.create_time,id:m.id,page:number,ordinal:ordinal++};
          if(keys.has(m.id)){
            const old=keys.get(m.id),previous=await old.get(old.from,old.to);
            if(!FastTextExporter.samePageRecord(previous,value))invalid("SOURCE_PAGE_CHANGED","Conversation changed between pages.");
            // Equivalent to prepending each older page and keeping its first occurrence.
            if(number>old.page)keys.set(m.id,row);
          }else {keys.set(m.id,row);
            if(keys.size%64===0)report({stage:"index",done:keys.size});}
        }
        report({stage:"index",done:keys.size});
        if(h.page_info.has_previous_page)return {before:h.page_info.start_cursor};
        const descriptors=[...keys.values()].sort((a,b)=>b.page-a.page||a.ordinal-b.ordinal);
        if(descriptors.every(m=>Number.isFinite(m.time)))descriptors.sort((a,b)=>a.time-b.time);
        const warnings=[];
        async function* rows() {
          let displayed=false;for(const m of descriptors){check();const value=await m.get(m.from,m.to);
            const r=FastTextExporter.records([value.message??value],{allowEmpty:true});
            if(r.warnings.length)warnings.push(...r.warnings.map(()=>true));if(r.messages.length)displayed=true;yield* r.messages;}
          if(!displayed)invalid();
        }
        async function row(id){check();const m=keys.get(id);if(!m)return null;
          const value=await m.get(m.from,m.to);return FastTextExporter.records([value.message??value],{allowEmpty:true}).messages.find(r=>r.id===id)||null;}
        return {result:{source:"paginated-conversation",title,ids:new Set(keys.keys()),rows,row,warnings}};
      }
    };
  }
  return {entries,header,tree,conversation,fileReader};
})();
