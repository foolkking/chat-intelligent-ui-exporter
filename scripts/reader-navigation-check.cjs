// Actual Edge + actual navigation/control modules, synthetic virtual transcript.
// This does NOT certify a logged-in ChatGPT DOM/API or Reader account.
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const repo=path.resolve(__dirname,".."),root=path.resolve(process.argv[2]||"");
if(!process.argv[2]||!["E:\\chat-reader-temp","C:\\Users\\86182\\Desktop\\wkkk"].some(p=>root.toLowerCase().startsWith(path.resolve(p).toLowerCase()+path.sep)))
  throw Error("Supply an authorized task evidence directory.");
fs.mkdirSync(root,{recursive:true});const out=fs.mkdtempSync(path.join(root,"edge-navigation-"));process.env.TEMP=process.env.TMP=out;
const results={at:new Date().toISOString(),kind:"real Edge, synthetic source and runtime; not private ChatGPT E2E",files:{},scenarios:[],failures:[]};
const names=["glyphs.js","progress.js","routes.js","page-index.js","overlay.js","source-control.js"];
const scripts=Object.fromEntries(names.map(n=>[n,fs.readFileSync(path.join(repo,"reader",n),"utf8")]));
for(const [n,s] of Object.entries(scripts))results.files[n]=crypto.createHash("sha256").update(s).digest("hex");
const html=`<!doctype html><html><head><meta charset=utf-8><style>
*{box-sizing:border-box}html,body{margin:0;background:#faf9f6;color:#27332e;font:15px/1.6 system-ui}
#scroll{height:calc(100vh - 96px);overflow:auto;overflow-anchor:none}#column{width:min(700px,calc(100% - 32px));margin:auto}
.message{padding:12px 4px;overflow:hidden}h2{font-size:18px;margin:0 0 16px}p{margin:0 0 16px}
form{position:fixed;left:50%;transform:translateX(-50%);bottom:12px;width:min(680px,calc(100% - 24px));height:54px;border:1px solid #d6dad3;background:#faf9f6;border-radius:12px;padding:8px}
#prompt-textarea{height:100%;outline:none}a{color:#086b5b}
@media(prefers-color-scheme:dark){html,body,form{background:#222420;color:#f0f0e9}form{border-color:#40443d}a{color:#94d9c4}}
</style></head><body><div id=scroll><main id=column><div id=top></div><div id=window></div><div id=bottom></div></main></div>
<form><div id=prompt-textarea contenteditable=true>合成输入框 · Synthetic composer</div></form></body></html>`;
const server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});res.end(html);});
let browser;
async function click(page,rootName,selector,index=0){
  const box=await page.evaluate(({rootName,selector,index})=>{const n=window[rootName].querySelectorAll(selector)[index];if(!n)throw Error("Control missing: "+selector);const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},{rootName,selector,index});
  await page.mouse.click(box.x,box.y);
}
async function snapshot(page){
  return page.evaluate(()=>{
    const bounds=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    return {column:bounds(document.querySelector("#column")),frame:bounds(__nav.querySelector(".frame")),composer:bounds(document.querySelector("form")),
      save:bounds(__save.host),navHidden:__nav.querySelector(".frame").hidden,menuHidden:__save.querySelector(".menu").hidden,
      status:__nav.querySelector(".status").textContent,overflow:document.documentElement.scrollWidth>innerWidth,
      rows:__nav.querySelectorAll(".list .result").length,active:__nav.activeElement?.className||"",scroll:document.querySelector("#scroll").scrollTop};
  });
}
async function scenario(origin,spec){
  const page=await browser.newPage(),rec={...spec,checks:[],shots:[],errors:[]};results.scenarios.push(rec);
  await page.setViewport({width:spec.width,height:900,deviceScaleFactor:1});
  await page.emulateMediaFeatures([{name:"prefers-color-scheme",value:spec.dark?"dark":"light"}]);
  page.on("pageerror",e=>rec.errors.push(e.message));await page.setRequestInterception(true);
  page.on("request",r=>r.url().startsWith(origin+"/")?r.continue():r.abort());
  await page.evaluateOnNewDocument(locale=>Object.defineProperty(navigator,"language",{get:()=>locale}),spec.locale);
  await page.goto(origin+"/c/synthetic-navigation");
  await page.evaluate(()=>{
    const attach=Element.prototype.attachShadow;window.__roots=[];
    Element.prototype.attachShadow=function(o){const r=attach.call(this,o);__roots.push(r);return r;};
    const scroll=document.querySelector("#scroll"),win=document.querySelector("#window"),top=document.querySelector("#top"),bottom=document.querySelector("#bottom");
    window.__source=Array.from({length:240},(_,i)=>({
      id:"m"+i,role:i%2?"assistant":"user",height:i===1?11000:1000+(i*97)%900,
      body:i===1?"## Repeated heading\n\n"+Array.from({length:111},(_,k)=>`Part ${k+1}: needle 潮汐 detail ${k+1}.`).join("\n\n")+
        "\n\n## Repeated heading\n\nFinal chapter.":
        i%2?`## Answer ${i}\n\nSynthetic answer ${i}.`:`Question ${i}: synthetic turn ${Math.floor(i/2)+1}.`,
      headings:[],files:i===0?[{name:"same.pdf",id:"file-one",type:"file"},{name:"same.pdf",id:"file-two",type:"file"}]:[]
    }));
    window.__offsets=[0];for(const m of __source)__offsets.push(__offsets.at(-1)+m.height);
    window.__render=()=>{
      const pos=scroll.scrollTop,index=Math.max(0,__offsets.findIndex((n,k)=>k<240&&__offsets[k+1]>pos));
      const a=Math.max(0,index-2),b=Math.min(240,index+5);
      if(win.dataset.window===a+":"+b)return;win.dataset.window=a+":"+b;
      top.style.height=__offsets[a]+"px";bottom.style.height=(__offsets.at(-1)-__offsets[b])+"px";
      win.replaceChildren(...__source.slice(a,b).map(m=>{
        const i=Number(m.id.slice(1)),turn=document.createElement("section");turn.dataset.testid="conversation-turn-"+Math.floor(i/2);
        const n=document.createElement("div");n.className="message";n.dataset.messageId=m.id;n.dataset.messageAuthorRole=m.role;n.style.height=m.height+"px";
        if(i===0)for(const f of m.files){const a=document.createElement("a");a.download=f.name;a.dataset.fileId=f.id;a.textContent=f.name;a.style.display="block";n.append(a);}
        const body=document.createElement("div");body.className="markdown";
        for(const text of m.body.split("\n\n")){const node=document.createElement(text.startsWith("## ")?"h2":"p");node.textContent=text.replace(/^## /,"");body.append(node);}
        n.append(body);turn.append(n);return turn;
      }));
    };
    scroll.addEventListener("scroll",()=>setTimeout(__render,window.__renderDelay||40));
    __render();scroll.scrollTop=__offsets.at(-1)-800;__render();
    const event={addListener(){}};
    window.chrome={runtime:{id:"synthetic-extension",getURL:n=>"http://invalid.test/"+n,
      onMessage:event,connect:()=>({onMessage:event,onDisconnect:event,disconnect(){}}),
      sendMessage:async m=>m.kind==="source-state"?{state:"save",canSave:true}:m.kind==="surface-tab"?{view:"outline"}:{ok:true}}};
    window.ReaderVisible=m=>({body:m.body});window.FastTextExporter={};window.__saving=false;window.__readSteps=[];
    document.body.dataset.currentNodeId="synthetic-leaf-one";
  });
  for(const name of names)await page.addScriptTag({content:scripts[name]});
  await page.evaluate(()=>{
    window.__rows=__source.map(m=>({...ReaderPageIndex.fromBranch({messages:[m]})[0],files:m.files}));
    ReaderOverlay({busy:()=>__saving,read:async(controller,report)=>{
      for(const s of [{stage:"source",done:4096},{stage:"index",done:240},{stage:"messages",done:240}]){
        controller.signal.throwIfAborted();report(s);__readSteps.push(s);await new Promise(r=>setTimeout(r,window.__slowRead?600:160));
      }
      return {rows:__rows.map(ReaderPageIndex.metadata),complete:true,loadBody:async(id,signal)=>{
        signal?.throwIfAborted();return __rows.find(r=>r.id===id).body;
      }};
    }});
    ReaderSourceControl({pathId:()=>location.pathname.includes("/c/")?"synthetic-navigation":"",capture:async()=>{},cancel(){}});
    window.__nav=__roots.find(r=>r.querySelector(".handle"));window.__save=__roots.find(r=>r.querySelector(".bar"));
  });
  await new Promise(r=>setTimeout(r,150));
  const before=await snapshot(page);rec.before=before;
  const shot=async name=>{const f=path.join(out,spec.name+"-"+name+".png");await page.screenshot({path:f});rec.shots.push(f);};
  try{
    await shot("00-collapsed");await click(page,"__nav",".handle");await new Promise(r=>setTimeout(r,80));rec.reading=await snapshot(page);await shot("01-reading");
    assert.match(rec.reading.status,/Reading|读取|核对|Indexing/);
    assert.doesNotMatch(rec.reading.status,/%/,"No total is known; no fabricated percentage is permitted.");
    await page.waitForFunction(()=>__nav.querySelector(".feedback button").hidden);
    rec.open=await snapshot(page);assert.equal(rec.open.column.width,before.column.width);assert.ok(rec.open.frame.bottom<=rec.open.composer.y-10);
    assert.ok(await page.evaluate(()=>{
      const list=__nav.querySelector(".list"),active=list.querySelector(".active");if(!active)return false;
      const a=active.getBoundingClientRect(),b=list.getBoundingClientRect();return a.bottom>b.top&&a.top<b.bottom;
    }),"First open must show the actual current reading turn without mounting the whole outline.");
    assert.ok(await page.evaluate(()=>__nav.querySelectorAll(".list [data-mid]").length<=64));
    assert.ok(!rec.open.overflow);await shot("02-outline");
    // Real ID-driven virtual jumps; every destination is absent at least once.
    rec.jumps=[];
    for(const id of ["m0","m137","m239","m54"]){
      const result=await page.evaluate(async id=>{const started=performance.now(),r=await ReaderPageIndex.jump(__rows,{id},new AbortController().signal);
        const n=ReaderPageIndex.mounted().find(n=>n.dataset.messageId===id);return {id,result:r,ms:performance.now()-started,top:n?.getBoundingClientRect().top,mounted:ReaderPageIndex.mounted().length};},id);
      rec.jumps.push(result);assert.equal(result.result.ok,true,JSON.stringify(result));assert.ok(result.mounted<20);
    }
    rec.checks.push("120 turns: first/last/random real virtual IDs, no mass mount");
    await click(page,"__nav","nav .icon");await page.evaluate(()=>{const q=__nav.querySelector("input");q.value="needle";q.dispatchEvent(new Event("input",{bubbles:true}));});
    await page.waitForFunction(()=>__nav.querySelector(".feedback button").hidden&&/111/.test(__nav.querySelector(".status").textContent));
    let search=await snapshot(page);assert.equal(search.rows,64);assert.match(search.status,/111/);
    const firstHits=await page.evaluate(()=>[...__nav.querySelectorAll(".list .result")].map(n=>n.dataset.mid+":"+n.dataset.occurrence));
    await page.evaluate(()=>{const n=__nav.querySelector(".list");n.scrollTop=n.scrollHeight;});
    const more=await page.evaluate(()=>{const n=[...__nav.querySelectorAll(".list button")].at(-1),r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
    await page.mouse.click(more.x,more.y);
    await page.waitForFunction(()=>__nav.querySelector(".feedback button").hidden&&__nav.querySelectorAll(".list .result").length===47);
    search=await snapshot(page);assert.equal(search.rows,47);assert.match(search.status,/111/);
    const secondHits=await page.evaluate(()=>[...__nav.querySelectorAll(".list .result")].map(n=>n.dataset.mid+":"+n.dataset.occurrence));
    assert.equal(new Set([...firstHits,...secondHits]).size,111);assert.equal(secondHits.at(-1),"m1:110");
    rec.checks.push("all 111 matches across 64+47 bounded pages: no omission, duplicate or result cap");
    await page.evaluate(()=>{__nav.querySelector(".list").scrollTop=0;});await shot("03-search");
    rec.range=await page.evaluate(async()=>{
      const target={id:"m1",query:"needle",occurrence:100},result=await ReaderPageIndex.jump(__rows,target,new AbortController().signal);
      const msg=ReaderPageIndex.mounted().find(n=>n.dataset.messageId==="m1"),found=ReaderPageIndex.textTarget(msg,__rows[1],target);
      return {result,text:found?.range.toString(),context:found?.range.startContainer.parentElement.textContent,top:found?.range.getBoundingClientRect().top};
    });
    assert.equal(rec.range.result.ok,true);assert.equal(rec.range.text,"needle");assert.match(rec.range.context,/Part 101:/);
    assert.ok(rec.range.top>=0&&rec.range.top<700);rec.checks.push("101st match resolves a visible real DOM Range, not message top");
    rec.heading=await page.evaluate(()=>ReaderPageIndex.jump(__rows,{id:"m1",heading:1},new AbortController().signal));
    assert.equal(rec.heading.ok,true);
    rec.file=await page.evaluate(async()=>{
      const r=await ReaderPageIndex.jump(__rows,{id:"m0",file:1},new AbortController().signal);
      const msg=ReaderPageIndex.mounted().find(n=>n.dataset.messageId==="m0");
      return {result:r,id:ReaderPageIndex.destination(msg,__rows[0],{file:1}).node.dataset.fileId};
    });assert.equal(rec.file.result.ok,true);assert.equal(rec.file.id,"file-two");
    rec.checks.push("duplicate heading occurrence and same-name attachment use exact identity");
    await click(page,"__save",".toggle");assert.equal((await snapshot(page)).navHidden,true);
    await click(page,"__nav",".handle");assert.equal((await snapshot(page)).menuHidden,true);await shot("04-mutual-exclusion");
    await page.evaluate(()=>{document.querySelector("form").style.height="220px";});await new Promise(r=>setTimeout(r,180));
    rec.expandedComposer=await snapshot(page);assert.ok(rec.expandedComposer.frame.bottom<=rec.expandedComposer.composer.y-10);
    assert.ok(rec.expandedComposer.save.bottom<=rec.expandedComposer.composer.y-10);assert.equal(rec.expandedComposer.column.width,before.column.width);
    await shot("05-tall-composer");rec.checks.push("ResizeObserver composer avoidance, both surfaces; zero column-width delta");
    // Escape stops work/search first, then collapses. It must return focus to the handle.
    await page.evaluate(()=>__nav.querySelector("header .icon").focus());await page.keyboard.press("Escape");
    if(!(await snapshot(page)).navHidden)await page.keyboard.press("Escape");
    const closed=await snapshot(page);assert.equal(closed.navHidden,true);assert.equal(closed.active,"handle");
    rec.checks.push("keyboard collapse returns focus without moving the transcript");
    // Cancel an actual in-flight read using the visible button. A late response
    // must not overwrite the partial/stopped status or the retained outline.
    await click(page,"__nav",".handle");
    await page.evaluate(()=>{__slowRead=true;document.body.dataset.currentNodeId="synthetic-leaf-two";});
    await page.waitForFunction(()=>!__nav.querySelectorAll(".feedback button")[1].hidden);
    await click(page,"__nav",".feedback button",1);
    await page.waitForFunction(()=>!__nav.querySelectorAll(".feedback button")[0].hidden);
    await click(page,"__nav",".feedback button");
    rec.stopped=await snapshot(page);assert.match(rec.stopped.status,/Stopped|已停止/);
    assert.match(rec.stopped.status,/Partial outline|部分目录/);
    assert.ok(await page.evaluate(()=>__nav.querySelectorAll(".list .row").length>0));
    assert.ok(await page.evaluate(()=>__nav.activeElement===__nav.querySelectorAll(".feedback button")[1]));
    await shot("06-read-cancelled");await new Promise(r=>setTimeout(r,650));
    assert.equal((await snapshot(page)).status,rec.stopped.status);
    await page.evaluate(()=>{__slowRead=false;});await click(page,"__nav",".feedback button",1);
    await page.waitForFunction(()=>__nav.querySelectorAll(".feedback button")[0].hidden);
    rec.checks.push("actual read cancellation retains partial outline; stale callback cannot overwrite status");
    // A user wheel gesture cancels an actual result click while the virtual
    // window is still loading. Subsequent animation frames must not resume it.
    await click(page,"__nav","nav .icon");
    await page.evaluate(async()=>{
      await ReaderPageIndex.jump(__rows,{id:"m0"},new AbortController().signal);
      __renderDelay=250;const q=__nav.querySelector("input");q.value="Question 238:";q.dispatchEvent(new Event("input",{bubbles:true}));
    });
    await page.waitForFunction(()=>__nav.querySelector(".feedback button").hidden&&__nav.querySelectorAll(".list .result").length===1);
    const wheelBefore=await snapshot(page);assert.equal(wheelBefore.rows,1);
    await click(page,"__nav",".list .result");
    await page.waitForFunction(()=>!!__nav.querySelector("[aria-busy=true]"));
    await page.mouse.move(Math.max(4,spec.width/2-20),95);await page.mouse.wheel({deltaY:-24});
    await page.waitForFunction(()=>/Jump stopped|已停止定位/.test(__nav.querySelector(".status").textContent));
    const manual=await snapshot(page);await new Promise(r=>setTimeout(r,400));
    assert.equal((await snapshot(page)).scroll,manual.scroll);
    assert.ok(!await page.evaluate(()=>!!__nav.querySelector("[aria-busy=true]")));
    rec.checks.push("wheel cancels actual result navigation; no late scroll restoration");
    await page.evaluate(()=>{__renderDelay=40;__saving=true;});
    const busyTop=(await snapshot(page)).scroll;
    await click(page,"__nav",".list .result");const busyState=await snapshot(page);
    assert.equal(busyState.scroll,busyTop);assert.match(busyState.status,/current save|当前保存/);
    await page.evaluate(()=>{__saving=false;});
    rec.checks.push("an active capture blocks navigation without moving content");
    // An actual successful click, not only the lower-level navigator, collapses
    // on compact layouts and preserves the user's search state when reopened.
    await click(page,"__nav",".list .result");
    await page.waitForFunction(()=>!__nav.querySelector("[aria-busy=true]"));
    const located=await snapshot(page);
    assert.equal(located.navHidden,spec.width<760);
    if(located.navHidden){assert.equal(located.active,"handle");await click(page,"__nav",".handle");}
    assert.equal(await page.evaluate(()=>__nav.querySelector("input").value),"Question 238:");
    assert.equal((await snapshot(page)).rows,1);
    rec.checks.push("actual result click + compact collapse + focus return retain search state");
    assert.deepEqual(rec.errors,[]);
  }catch(e){rec.failure=e.stack;results.failures.push({scenario:spec.name,error:e.message});await shot("failure");}
  finally{await page.close();}
}
(async()=>{
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin="http://127.0.0.1:"+server.address().port;
  const {default:p}=await import(path.join(repo,"node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js").replace(/\\/g,"/").replace(/^([A-Z]:)/,"file:///$1"));
  browser=await p.launch({executablePath:process.env.EDGE_PATH||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true,pipe:true,
    userDataDir:path.join(out,"profile"),args:["--no-first-run","--disable-background-networking"]});results.browser=await browser.version();
  for(const s of [{name:"wide-en-light",width:1440,locale:"en-US"},{name:"narrow-zh-light",width:375,locale:"zh-CN"},
    {name:"compact-en-light",width:320,locale:"en-US"},{name:"narrow-zh-dark",width:375,locale:"zh-CN",dark:true}])await scenario(origin,s);
})().catch(e=>results.failures.push({error:e.stack})).finally(async()=>{
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(results,null,2));if(browser)await browser.close();await new Promise(r=>server.close(r));
  console.log(JSON.stringify({evidence:out,failures:results.failures,scenarios:results.scenarios.map(s=>({name:s.name,checks:s.checks}))},null,2));
  if(results.failures.length)process.exitCode=1;
});
