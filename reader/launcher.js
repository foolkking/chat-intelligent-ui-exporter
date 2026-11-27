// Both folded launchers share one preference. Only the button is a drag target.
globalThis.ReaderLauncher=(()=>{
  let position=null,readPath="",changed=false,write=Promise.resolve();
  const layouts=new Set(),refresh=()=>{for(const layout of layouts)layout();};
  const clamp=value=>Math.max(0,Math.min(1,value));
  async function restore(){
    const path=location.pathname;
    if(changed||position||document.hidden||path===readPath||!ReaderRoutes.eligible(path))return;
    readPath=path;
    try{
      const p=(await chrome.runtime.sendMessage({kind:"launcher-position",path}))?.position;
      if(!changed&&readPath===path&&location.pathname===path&&Number.isFinite(p?.x)&&Number.isFinite(p?.y)){
        position={x:clamp(p.x),y:clamp(p.y)};refresh();
      }
    }catch{/* A disconnected extension can still move its local control. */}
  }
  function commit(point){
    changed=true;position=point;refresh();
    const path=location.pathname;
    // Coalesce key repeats and serialize writes so an earlier drop cannot win a race.
    write=write.then(()=>{
      if(position===point&&location.pathname===path)return chrome.runtime.sendMessage({kind:"launcher-position",path,position:point});
    }).catch(()=>{});
  }
  function bounds(box){
    const v=globalThis.visualViewport,rect=box.getBoundingClientRect();
    const left=(v?.offsetLeft||0)+8,top=(v?.offsetTop||0)+8;
    const right=left+(v?.width||innerWidth)-16,bottom=top+(v?.height||innerHeight)-16;
    return {rect,left,top,right,bottom,dx:Math.max(0,right-left-rect.width),dy:Math.max(0,bottom-top-rect.height)};
  }
  const pointAt=(x,y,b)=>({x:b.dx?clamp((x-b.left)/b.dx):0,y:b.dy?clamp((y-b.top)/b.dy):0});
  addEventListener("resize",refresh);globalThis.visualViewport?.addEventListener("resize",refresh);
  globalThis.visualViewport?.addEventListener("scroll",refresh);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){readPath="";refresh();}});
  return (button,box)=>{
    let press=null,preview=null,suppress=false;
    const visible=()=>box.isConnected&&!button.hidden;
    function layout(){
      if(press&&(!visible()||press.path!==location.pathname)){
        const id=press.id;suppress=!!preview;press=preview=null;
        if(button.hasPointerCapture(id))button.releasePointerCapture(id);
      }
      if(!visible())return;
      void restore();const point=preview||position;
      box.toggleAttribute("data-launcher-position",!!point);
      if(!point){box.style.removeProperty("--launcher-x");box.style.removeProperty("--launcher-y");return;}
      const b=bounds(box);
      const x=Math.round(b.left+point.x*b.dx),y=Math.round(b.top+point.y*b.dy);
      box.style.setProperty("--launcher-x",x+"px");box.style.setProperty("--launcher-y",y+"px");
      if(box===button)return;
      // A menu on a relocated strip opens into the part of the viewport with room.
      const above=y-b.top-4,below=b.bottom-y-b.rect.height-4,left=x+b.rect.width-b.left,right=b.right-x;
      box.toggleAttribute("data-menu-below",below>above);box.toggleAttribute("data-menu-left",right>left);
      box.style.setProperty("--launcher-menu-height",Math.max(44,above,below)+"px");
      box.style.setProperty("--launcher-menu-width",Math.max(44,left,right)+"px");
    }
    layouts.add(layout);
    if(typeof ResizeObserver==="function")new ResizeObserver(layout).observe(box);
    button.title=button.getAttribute("aria-label")+" · "+(navigator.language.startsWith("zh")?"拖动或按方向键移动":"Drag or use arrow keys to move");
    button.setAttribute("aria-keyshortcuts","ArrowLeft ArrowRight ArrowUp ArrowDown");
    const activate=button.onclick;
    button.onclick=e=>{
      if(!e.isTrusted)return;
      if(suppress&&(e.detail!==0||e.pointerType)){suppress=false;e.preventDefault();e.stopPropagation();return;}
      activate.call(button,e);
    };
    button.onpointerdown=e=>{
      if(!e.isTrusted||!visible()||e.isPrimary===false||e.button!==0||press)return;
      const rect=box.getBoundingClientRect();
      press={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top,path:location.pathname};
      suppress=false;
      try{button.setPointerCapture(e.pointerId);}catch{press=null;}
    };
    function track(e){
      if(!visible()||press.path!==location.pathname)return;
      const dx=e.clientX-press.x,dy=e.clientY-press.y;
      if(!preview&&Math.hypot(dx,dy)<6)return;
      preview=pointAt(press.left+dx,press.top+dy,bounds(box));layout();e.preventDefault();
    }
    button.onpointermove=e=>{if(e.isTrusted&&press?.id===e.pointerId)track(e);};
    function end(e,drop){
      if(!e.isTrusted||press?.id!==e.pointerId)return;
      if(drop)track(e);
      const next=preview,save=drop&&visible()&&press.path===location.pathname;
      suppress=!!next;press=preview=null;
      if(button.hasPointerCapture(e.pointerId))button.releasePointerCapture(e.pointerId);
      if(next&&save)commit(next);else layout();
    }
    button.onpointerup=e=>end(e,true);button.onpointercancel=button.onlostpointercapture=e=>end(e,false);
    const arrows={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]};
    button.onkeydown=e=>{
      if(!e.isTrusted||!visible()||press||e.altKey||e.ctrlKey||e.metaKey||!Object.hasOwn(arrows,e.key))return;
      const b=bounds(box),[dx,dy]=arrows[e.key];e.preventDefault();e.stopPropagation();
      commit(pointAt(b.rect.left+dx,b.rect.top+dy,b));
    };
    return layout;
  };
})();
