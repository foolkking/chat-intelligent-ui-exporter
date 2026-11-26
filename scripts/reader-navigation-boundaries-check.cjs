const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const repo=path.resolve(__dirname,".."),base=process.env.TEMP;
if(!base||!/^E:\\chat-reader-temp\\|^C:\\Users\\86182\\Desktop\\wkkk\\/i.test(base))throw Error("Use an approved per-task TEMP.");
const out=fs.mkdtempSync(path.join(base,"nav-bound-entry-"));
const names=["source-dom.js","glyphs.js","progress.js","progress-view.js","routes.js","surface-state.js","page-index.js","outline-tree.js","overlay.js","source-control.js"],scripts=Object.fromEntries(names.map(n=>[n,fs.readFileSync(path.join(repo,n==="source-dom.js"?"extension":"reader",n),"utf8")]));
const hashes=()=>Object.fromEntries(names.map(n=>[n,crypto.createHash("sha256").update(scripts[n]).digest("hex")]));
const report={at:new Date().toISOString(),kind:"Actual isolated Edge, real navigation/control scripts with synthetic page and chrome.runtime stub. Not live ChatGPT or Reader E2E.",before:hashes(),scenarios:[]};
let browser,server;
const html=`<!doctype html><html><head><meta charset=utf-8><style>html,body{margin:0;font:16px/1.6 system-ui;background:#faf9f6;color:#27332e}main{width:min(700px,calc(100% - 32px));margin:auto}article{height:1800px}form{position:fixed;bottom:8px;left:50%;transform:translateX(-50%);width:min(680px,calc(100% - 24px));height:52px;border:1px solid #d6dad3;background:#faf9f6;border-radius:8px}#prompt-textarea{padding:8px}@media(prefers-color-scheme:dark){html,body,form{background:#222420;color:#f0f0e9}}</style></head><body data-current-node-id=synthetic-leaf><main><article data-message-id=m0 data-message-author-role=user><div class=markdown>合成正文 · Synthetic article, unchanged by Reader tools.</div></article></main><form><div contenteditable=true id=prompt-textarea>合成输入框 · Synthetic composer</div></form></body></html>`;
async function click(page,root,selector){
  const pos=await page.evaluate(({root,selector})=>{const n=window[root].querySelector(selector);if(!n)throw Error("missing "+selector);const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},{root,selector});await page.mouse.click(pos.x,pos.y);
}
async function next(page,word){
  const pos=await page.evaluate(word=>{const list=__nav.querySelector(".list"),n=[...list.querySelectorAll("button")].find(n=>n.textContent===word);if(!n)throw Error("missing "+word);list.scrollTop=word.includes("Previous")||word.includes("上一")?0:list.scrollHeight;const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},word);await page.mouse.click(pos.x,pos.y);
}
(async()=>{
  server=http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});res.end(html);});await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin="http://127.0.0.1:"+server.address().port;
  const {default:puppeteer}=await import("puppeteer-core");
  browser=await puppeteer.launch({executablePath:process.env.READER_BROWSER||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true,userDataDir:path.join(out,"profile"),pipe:true,args:["--no-first-run","--disable-background-networking"]});report.browser=await browser.version();
  for(const spec of [{width:1440,height:900,locale:"en-US",dark:false},{width:375,height:800,locale:"zh-CN",dark:false},{width:320,height:568,locale:"en-US",dark:true}]){
    const page=await browser.newPage(),rec={...spec,checks:[],errors:[],screens:[]};report.scenarios.push(rec);
    const ok=(name,value)=>{assert.ok(value,name);rec.checks.push(name);};
    page.on("pageerror",e=>rec.errors.push(e.message));await page.setViewport(spec);await page.emulateMediaFeatures([{name:"prefers-color-scheme",value:spec.dark?"dark":"light"}]);
    await page.evaluateOnNewDocument(locale=>Object.defineProperty(navigator,"language",{get:()=>locale}),spec.locale);
    await page.setRequestInterception(true);page.on("request",r=>r.url().startsWith(origin+"/")?r.continue():r.abort());await page.goto(origin+"/c/synthetic-boundary");
    await page.evaluate(()=>{
      const attach=Element.prototype.attachShadow;window.__roots=[];Element.prototype.attachShadow=function(o){const root=attach.call(this,o);__roots.push(root);return root;};
      window.__sent=[];window.__reads=[];window.__captures=0;
      const listeners={addListener(){}};window.chrome={runtime:{id:"synthetic-extension",sendMessage:async m=>{__sent.push(m);return m.kind==="surface-tab"?{view:"outline"}:m.kind==="source-state"?{state:"save"}:{ok:true};},onMessage:listeners,connect:()=>({onMessage:listeners,onDisconnect:listeners,disconnect(){}})}};
      window.ReaderVisible=m=>({body:m.body});window.FastTextExporter={};
    });
    for(const n of names)await page.addScriptTag({content:scripts[n]});
    await page.evaluate(()=>{
      window.__body="完整长提问 · Full synthetic question\n"+Array.from({length:60},(_,i)=>`问题第 ${i+1} 行 · question context ${i+1}.`).join("\n")+"\nUNIQUE QUESTION END";
      const raw=Array.from({length:150},(_,i)=>({id:"m"+i,role:i%2?"assistant":"user",body:i===0?__body:"Message "+i,headings:[],files:[{name:"asset-"+i+".pdf",id:"file-"+i,type:"file"}]}));
      window.__rows=raw.map(ReaderPageIndex.metadata);
      ReaderOverlay({busy:()=>false,read:async()=>({rows:__rows,complete:true,loadBody:async(id,signal)=>{__reads.push({id,signal});return raw.find(r=>r.id===id).body;}})});
      ReaderSourceControl({pathId:()=>ReaderRoutes.chat(location.pathname),capture:async()=>{__captures++;},cancel(){}});
      window.__nav=__roots[0];window.__save=__roots[1];window.__width=document.querySelector("main").getBoundingClientRect().width;
    });
    await click(page,"__save",".open-workspace");await page.waitForFunction(()=>__nav.querySelector(".entry")&&!__nav.querySelector(".status").textContent.includes("Reading"));
    ok("no eager body preload",await page.evaluate(()=>__reads.length===0));
    const pos=await page.evaluate(()=>{const r=__nav.querySelector(".entry").getBoundingClientRect();return{x:r.x+60,y:r.y+10};});await page.mouse.move(pos.x,pos.y);
    await page.waitForFunction(()=>__nav.querySelector(".question-preview .body")?.textContent===__body);
    ok("hover reveals exact full question with tail",await page.evaluate(()=>__nav.querySelector(".question-preview .body").textContent===__body&&__reads.length===1));
    await page.evaluate(()=>{const p=__nav.querySelector(".question-preview .body");p.focus();p.scrollTop=p.scrollHeight;});
    const stem=`${spec.width}-${spec.locale}-${spec.dark?"dark":"light"}`,preview=stem+"-full-question.png";await page.screenshot({path:path.join(out,preview)});rec.screens.push(preview);
    await page.keyboard.press("Escape");
    ok("Escape releases full body and restores question focus without reloading",await page.evaluate(()=>!__nav.querySelector(".question-preview")&&__nav.activeElement===__nav.querySelector(".entry")&&__reads.length===1&&__reads[0].signal.aborted));
    await click(page,"__nav","nav button:nth-child(2)");let all=await page.evaluate(()=>[...__nav.querySelectorAll(".result")].map(n=>n.dataset.mid));ok("files page one is bounded at 64",all.length===64);
    const later=spec.locale.startsWith("zh")?"下一页附件":"Next files",earlier=spec.locale.startsWith("zh")?"上一页附件":"Previous files";
    await next(page,later);const second=await page.evaluate(()=>[...__nav.querySelectorAll(".result")].map(n=>n.dataset.mid));ok("files page two replaces page one",second.length===64&&second[0]==="m64");all.push(...second);
    await next(page,later);const last=await page.evaluate(()=>[...__nav.querySelectorAll(".result")].map(n=>n.dataset.mid));all.push(...last);ok("final file page reaches all 150 exactly once",last.length===22&&new Set(all).size===150&&last.at(-1)==="m149");
    await next(page,earlier);ok("previous file page is reachable",await page.evaluate(()=>__nav.querySelector(".result").dataset.mid==="m64"));
    const file=stem+"-files-fixed-page.png";await page.screenshot({path:path.join(out,file)});rec.screens.push(file);
    ok("open preview/files never change article width",await page.evaluate(()=>document.querySelector("main").getBoundingClientRect().width===__width));
    ok("frame is within viewport and above composer",await page.evaluate(()=>{const a=__nav.querySelector(".frame").getBoundingClientRect(),b=document.querySelector("form").getBoundingClientRect();return a.left>=0&&a.right<=innerWidth&&a.bottom<=b.top+1&&document.documentElement.scrollWidth<=innerWidth;}));
    await page.evaluate(()=>{history.pushState({},"","/g/g-p-synthetic/project");dispatchEvent(new PopStateEvent("popstate"));});
    await page.waitForFunction(()=>__save.querySelector(".bar").dataset.project==="true");ok("project homepage exposes one import action",await page.evaluate(()=>__save.querySelector(".toggle").hidden&&!__save.querySelector(".main").disabled));
    await page.evaluate(()=>__sent.length=0);await click(page,"__save",".main");await page.waitForFunction(()=>__sent.some(m=>m.kind==="open-center"));
    ok("project action only requests center; no capture or discovery",await page.evaluate(()=>__captures===0&&__sent.every(m=>m.kind==="open-center")&&__sent[0].path==="/g/g-p-synthetic/project"));
    const entry=stem+"-project-entry.png";await page.screenshot({path:path.join(out,entry)});rec.screens.push(entry);
    await page.evaluate(()=>{history.pushState({},"","/g/g-p-synthetic/c/synthetic-chat");dispatchEvent(new PopStateEvent("popstate"));});
    await page.waitForFunction(()=>!__save.querySelector(".toggle").hidden);
    ok("project chat retains exact URL hint without claiming a complete directory",await page.evaluate(()=>ReaderRoutes.project(location.pathname)==="g-p-synthetic"&&!ReaderRoutes.projectHome(location.pathname)));
    await page.evaluate(()=>{history.pushState({},"","/share/not-private");dispatchEvent(new PopStateEvent("popstate"));});
    ok("shared/noneligible route removes both tools",await page.evaluate(()=>!__nav.host.isConnected&&!__save.host.isConnected));ok("no runtime errors",rec.errors.length===0);
    await page.close();
  }
  report.after=hashes();assert.deepEqual(report.after,report.before);report.pass=report.scenarios.reduce((n,s)=>n+s.checks.length,0);
})().catch(e=>{report.failure={message:e.message,stack:e.stack};process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(out,"report.json"),pass:report.pass,scenarios:report.scenarios,failure:report.failure},null,2));});
