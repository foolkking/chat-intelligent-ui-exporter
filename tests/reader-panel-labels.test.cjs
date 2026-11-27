// Actual extension panel scripts, synthetic HTTP and DOM. Not a rendering test.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom");
const dir=path.join(__dirname,"../reader"),pid="00000000-0000-4000-8000-000000000001";
async function settle(check){for(let i=0;i<80;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.ok(check());}
async function fixture(){
  const dom=new JSDOM(fs.readFileSync(path.join(dir,"panel.html"),"utf8"),{url:"https://extension.example.test/panel.html",runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window;
  const device={id:"device",name:"Test",origin:"https://reader.example.test"};
  const saved={device,destination:{device:"device",project:null}};
  const items=[{id:"00000000-0000-4000-8000-000000000002",title:"Example",project_id:pid,project_name:pid}];
  const storage={async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,saved[k]]));},async set(p){Object.assign(saved,p);},async remove(k){delete saved[k];}};
  w.READER_ORIGIN=device.origin; w.setInterval=()=>0;
  const matches=w.Element.prototype.matches;
  w.Element.prototype.matches=function(s){return s===":popover-open"?false:matches.call(this,s);};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const requests=[];
  w.ReaderClient={trust:Promise.resolve(),request:async(d,p)=>{
    requests.push(p);
    return {json:async()=>p==="capabilities"?{capture:true,catalog_names:true,context_settings:true}:
      p==="projects"?[{id:pid,name:pid}]:p==="context/options"?{attachments:"include",continuation:"auto"}:{items,has_more:false}};
  }};
  w.chrome={runtime:{getURL:f=>"chrome-extension://test/"+f,sendMessage:async()=>({ok:true})},
    storage:{local:storage,onChanged:{addListener(){}}}};
  w.eval(["routes.js","glyphs.js","progress.js","progress-view.js","panel-export.js","panel-jobs.js","panel.js"]
    .map(n=>fs.readFileSync(path.join(dir,n),"utf8")).join("\n"));
  try{await settle(()=>w.document.querySelector("#rows").children.length===1);}
  catch(e){const message=w.document.querySelector("#boot-status").textContent+" "+w.document.querySelector("#status").textContent;w.close();throw Error(message,{cause:e});}
  return {w,items,saved,requests,close:()=>w.close()};
}
test("library and settings display a missing project name without treating it as unclassified or exposing its ID",async()=>{
  const f=await fixture();try{
    const d=f.w.document;
    assert.match(d.querySelector("#rows .project").textContent,/name unavailable/);
    for(const id of ["filter","target"]){
      const o=[...d.getElementById(id).options].find(x=>x.value===pid);
      assert.ok(o);assert.match(o.textContent,/Unnamed project/);assert.ok(!o.textContent.includes(pid));
    }
    d.querySelector("#settings-label").onclick();await settle(()=>!d.querySelector("#ai-options").hidden);
    assert.equal(d.querySelector("#ai-options").tagName,"DETAILS");assert.equal(d.querySelector("#ai-options").open,false);
    assert.equal(d.querySelector("#ai-heading").tagName,"SUMMARY");
    assert.ok(!d.querySelector("#settings").textContent.includes(pid));
  }finally{f.close();}
});
test("the explicit project filter removes repeated row metadata but retains unavailable-project warnings",async()=>{
  const f=await fixture();try{
    const d=f.w.document,filter=d.querySelector("#filter");filter.value=pid;filter.onchange();
    await settle(()=>d.querySelector("#rows li")&&!d.querySelector("#rows .project"));
    assert.ok(f.requests.some(p=>p.includes("project_id="+pid)));
    f.items[0].project_unavailable=true;filter.onchange();
    await settle(()=>d.querySelector("#rows .project")?.textContent==="Project unavailable");
    filter.value="";filter.onchange();
    await settle(()=>d.querySelector("#rows .project")?.textContent==="Project unavailable");
  }finally{f.close();}
});
