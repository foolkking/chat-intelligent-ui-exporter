// One content-world presentation state. No page event bridge, Reader records,
// credentials or network access. Moving the existing control preserves tasks.
globalThis.ReaderSurfaceState=(()=>{
  let state={open:false,view:"outline",wide:false,slot:null,hasControl:false};
  const listeners=new Set(),views=new Set(["outline","library","import"]);
  const get=()=>({...state});
  function update(patch){
    const next={...state};
    for(const k of ["open","wide","hasControl"])if(typeof patch?.[k]==="boolean")next[k]=patch[k];
    if(views.has(patch?.view))next.view=patch.view;
    if(Object.hasOwn(patch||{},"slot")&&(patch.slot===null||patch.slot?.nodeType===1))next.slot=patch.slot;
    if(Object.keys(next).every(k=>next[k]===state[k]))return get();
    state=next;for(const notify of listeners)notify(get());return get();
  }
  function subscribe(notify){listeners.add(notify);notify(get());return ()=>listeners.delete(notify);}
  return {get,update,subscribe};
})();
