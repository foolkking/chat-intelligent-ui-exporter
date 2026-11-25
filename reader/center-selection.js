// Source selection only: no body reads, network, targets, receipts or DOM.
// Whole-project means the proven contents of THIS local export, never the live account.
globalThis.ReaderCenterSelection = (() => {
  const PAGE_SIZE=50;
  const validID=v=>typeof v==="string"&&/^[\w-]{1,128}$/.test(v);
  const validGroup=v=>v==="unknown"||v==="unclassified"||
    typeof v==="string"&&/^project:[\w-]+$/.test(v);
  const fail=reason=>{throw Error(reason);};
  const pageNumber=value=>Number.isSafeInteger(value)&&value>=0?value:0;

  function create({source,chosen=new Set(),groupName=g=>g}={}) {
    if(!(chosen instanceof Set)||typeof groupName!=="function")fail("selection-invalid");
    let current,rows,index,identity,generation=0;
    const snapshots=new WeakSet();
    function identify(s) {
      return [s.kind,s.scope,s.digest,s.complete];
    }
    function install(next,retain=false) {
      if(!next||!["archive","web"].includes(next.kind)||!Array.isArray(next.rows))fail("selection-source");
      const seen=new Set(),copy=next.rows.map(row=>{
        if(!row||!validID(row.id)||seen.has(row.id)||!validGroup(row.group))fail("selection-source");
        seen.add(row.id);
        // A display model must not retain a raw mapping, message body or resource Blob.
        const item={id:row.id,title:typeof row.title==="string"?row.title:"ChatGPT",group:row.group};
        for(const key of ["updatedAt","update_time","updated_at","attachmentCount","attachment_count"]) {
          const value=row[key];
          if(value===null||typeof value==="number"&&Number.isFinite(value)||typeof value==="string")item[key]=value;
        }
        return Object.freeze(item);
      });
      current=next;rows=copy;index=new Map(rows.map(r=>[r.id,r]));identity=identify(next);generation++;
      if(!retain)chosen.clear();
      reconcile();
    }
    function reconcile() {
      for(const id of chosen)if(!index.has(id))chosen.delete(id);
    }
    function assertSource(ids) {
      if(!identify(current).every((v,i)=>v===identity[i])||!Array.isArray(current.rows))fail("selection-stale");
      const wanted=new Set(ids),seen=new Set();
      for(const row of current.rows) {
        if(!row||!wanted.has(row.id))continue;
        if(seen.has(row.id)||row.group!==index.get(row.id)?.group)fail("selection-stale");
        seen.add(row.id);
      }
      if(seen.size!==wanted.size)fail("selection-stale");
    }
    function filter({group="",query="",selectedOnly=false}={}) {
      reconcile();
      if(typeof group!=="string"||typeof query!=="string")fail("selection-filter");
      const q=query.trim().toLocaleLowerCase();
      return rows.filter(row=>(!group||row.group===group)&&
        (!q||row.title.toLocaleLowerCase().includes(q))&&(!selectedOnly||chosen.has(row.id)));
    }
    function view(options={}) {
      const filtered=filter(options),total=filtered.length,pages=Math.ceil(total/PAGE_SIZE);
      const page=Math.min(pageNumber(options.page),Math.max(0,pages-1)),offset=page*PAGE_SIZE;
      const visible=filtered.slice(offset,offset+PAGE_SIZE),selectedInFilter=filtered.filter(r=>chosen.has(r.id)).length;
      return {rows:visible,page,pageSize:PAGE_SIZE,pages,total,from:total?offset+1:0,to:offset+visible.length,
        hasPrevious:page>0,hasNext:page+1<pages,selectedCount:chosen.size,selectedInFilter,
        hiddenSelected:chosen.size-selectedInFilter,pageSelected:visible.filter(r=>chosen.has(r.id)).length};
    }
    function summary() {
      reconcile();
      const groups=new Map();
      for(const row of rows) {
        if(!groups.has(row.group))groups.set(row.group,{id:row.group,name:String(groupName(row.group)),knownCount:0,selectedCount:0});
        const group=groups.get(row.group);group.knownCount++;if(chosen.has(row.id))group.selectedCount++;
      }
      return {knownCount:rows.length,selectedCount:chosen.size,
        selectedGroupCount:[...groups.values()].filter(g=>g.selectedCount).length,groups:[...groups.values()]};
    }
    function project(group) {
      const count=rows.filter(r=>r.group===group).length;
      let reason=null;
      // Do not accept a caller's `complete: true` on a private web directory.
      if(current.kind!=="archive")reason="web-partial";
      else if(!group?.startsWith("project:")||!validGroup(group))reason="not-project";
      else if(!/^[a-f\d]{64}$/i.test(current.digest||"")||current.scope!==current.digest||
        current.complete!==true)reason="archive-unproven";
      else if(!identify(current).every((v,i)=>v===identity[i]))reason="source-changed";
      else if(rows.some(r=>r.group==="unknown"))reason="membership-unknown";
      else if(!count)reason="empty-project";
      if(!reason) {
        // An appended/changed catalogue is not the completed snapshot we reviewed.
        try {
          if(current.rows.length!==rows.length)reason="source-changed";
          else assertSource(rows.map(r=>r.id));
        }catch{reason="source-changed";}
      }
      return {allowed:reason===null,reason,count,scope:"local-export-project"};
    }
    function snapshot(mode,options={}) {
      let selected;
      if(mode==="page")selected=view(options).rows;
      else if(mode==="filtered")selected=filter(options);
      else if(mode==="project") {
        const proof=project(options.group);
        if(!proof.allowed)fail("selection-"+proof.reason);
        // The explicit whole-project action ignores a title filter, not source identity.
        selected=rows.filter(r=>r.group===options.group);
      }else fail("selection-mode");
      assertSource(selected.map(r=>r.id));
      const ids=Object.freeze(selected.map(r=>r.id)),groups=new Map();
      for(const row of selected)groups.set(row.group,(groups.get(row.group)||0)+1);
      const result=Object.freeze({mode,ids,count:ids.length,generation,
        source:Object.freeze({kind:current.kind,scope:current.scope??null,digest:current.digest??null}),
        groups:Object.freeze([...groups].map(([id,count])=>Object.freeze({id,name:String(groupName(id)),count})))});
      snapshots.add(result);return result;
    }
    function apply(fixed,{selected=true}={}) {
      if(!fixed||!snapshots.has(fixed)||fixed.generation!==generation)fail("selection-stale");
      assertSource(fixed.ids);
      // Validate the whole frozen range before changing the shared Set.
      for(const id of fixed.ids)if(!index.has(id))fail("selection-stale");
      for(const id of fixed.ids)selected?chosen.add(id):chosen.delete(id);
      return summary();
    }
    function set(id,selected=true) {
      if(!index.has(id))fail("selection-unknown-id");
      assertSource([id]);selected?chosen.add(id):chosen.delete(id);return summary();
    }
    function remove(id) {chosen.delete(id);return summary();}
    function clear() {chosen.clear();return summary();}
    // New sources invalidate old confirmations, even if the new file reuses the same ids.
    function replaceSource(next) {install(next);return view();}
    install(source,true);
    return {view,summary,project,snapshot,apply,set,remove,clear,replaceSource,
      selected:options=>view({...options,group:"",query:"",selectedOnly:true})};
  }
  return {PAGE_SIZE,create};
})();
