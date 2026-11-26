// Exercise the actual inert WAR bootstrap with synthetic extension replies/files.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {JSDOM}=require("jsdom"),base="chrome-extension://"+"a".repeat(32)+"/",ticket="00000000-0000-4000-8000-000000000001";
const read=name=>fs.readFileSync(path.join(__dirname,"../reader",name),"utf8");
async function fixture({view="import",claim={ok:true,view,tab:7},search="",hash="#"+ticket,top=false}={}){
  const dom=new JSDOM("<!doctype html><html><head></head><body></body></html>"),w=dom.window,messages=[],fetched=[],scripts=[],events={};
  const append=w.document.head.append.bind(w.document.head);
  w.document.head.append=node=>{append(node);if(node.tagName==="SCRIPT"){scripts.push(node.src);queueMicrotask(()=>node.onload());}};
  const window={},c=vm.createContext({window,top:top?window:{},document:w.document,DOMParser:w.DOMParser,URL,
    location:{search,hash},navigator:{language:"en"},addEventListener:(name,fn)=>{events[name]=fn;},
    chrome:{runtime:{getURL:n=>base+n,sendMessage:async m=>{messages.push(m);return claim;}}},
    fetch:async url=>{fetched.push(url);return {text:async()=>read(url.slice(base.length))};}});
  await vm.runInContext(read("frame.js"),c);
  return {c,w,messages,fetched,scripts,events,close:()=>w.close()};
}
test("a granted view alone selects fixed private content and freezes only the bound view/tab context",async()=>{
  for(const view of ["library","import"]){
    const f=await fixture({view,claim:{ok:true,view,tab:7,device:"must-not-project",title:"must-not-project"}});try{
      const page=view==="import"?"center.html":"panel.html";
      assert.deepEqual(f.fetched,[base+page]);
      assert.deepEqual(JSON.parse(JSON.stringify(f.c.ReaderFrameContext)),{view,tab:7});
      assert.equal(Object.isFrozen(f.c.ReaderFrameContext),true);
      const property=Object.getOwnPropertyDescriptor(f.c,"ReaderFrameContext");
      assert.equal(property.writable,false);assert.equal(property.configurable,false);
      assert.equal(f.w.document.documentElement.dataset.readerFrame,view);
      assert.equal(f.w.document.querySelector("#source-step")!==null,view==="import");
      const expected=[...read(page).matchAll(/<script defer src="([^"]+)"/g)].map(m=>base+m[1]);
      assert.deepEqual(f.scripts,expected,"load all packaged dependencies in their exact declared order");
      assert.equal(f.w.document.querySelector("link").href,base+"panel.css");
      f.events.keydown({key:"Escape",defaultPrevented:false});
      assert.equal(f.messages.at(-1).kind,"frame-close");
    }finally{f.close();}
  }
});
test("top-level and query-selected frame URLs are inert even with a valid-looking ticket",async()=>{
  for(const options of [{top:true},{search:"?view=import"},{search:"?page=host.html"},{hash:"#not-a-ticket"}]){
    const f=await fixture(options);try{assert.deepEqual(f.messages,[]);assert.deepEqual(f.fetched,[]);assert.deepEqual(f.scripts,[]);}finally{f.close();}
  }
});
test("unknown views, missing bindings and rejected claims never fetch private content",async()=>{
  for(const claim of [{ok:false},{ok:true},{ok:true,view:"host.html",tab:7},{ok:true,view:"__proto__",tab:7},
    {ok:true,view:"import",tab:null},{ok:true,view:"import",tab:-1},{ok:true,view:"import",tab:"7"},{ok:true,view:"library",tab:Infinity}]){
    const f=await fixture({claim});try{
      assert.deepEqual(f.fetched,[]);assert.deepEqual(f.scripts,[]);
      assert.equal(f.c.ReaderFrameContext,undefined);assert.match(f.w.document.body.textContent,/Reopen/);
    }finally{f.close();}
  }
});
