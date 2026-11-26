// Isolated real-browser product test. All accounts, conversations, assets and API responses are synthetic.
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict"),cp=require("node:child_process");
const root=process.env.TEMP,real=process.env.READER_TEST_ORIGIN;
if(!root||!/^E:\\chat-reader-temp\\|^C:\\Users\\86182\\Desktop\\wkkk\\/i.test(root))throw Error("Use the approved per-task TEMP.");
const run=fs.mkdtempSync(path.join(root,"center-browser-")),build=path.join(run,"extension"),report={kind:"real Edge; synthetic API and export, not a real ChatGPT account",at:new Date().toISOString(),checks:[],errors:[],screens:[]};
const fflate=require("../reader/vendor/fflate-0.8.3.js"),received=new Map(),records=new Map(),project="00000000-0000-4000-8000-000000000010";
const device="00000000-0000-4000-8000-000000000011",originToken="synthetic-device-access-not-a-credential";
if(real&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(real))throw Error("Real API tests must use disposable loopback only.");
const grant=real?JSON.parse(fs.readFileSync(process.env.READER_TEST_DEVICE_FILE,"utf8")):null;
let n=20,browser,server;
function conversation(id,group){
  return {id,title:"Tidal source "+id,...(group===undefined?{}:{project_id:group}),current_node:"n1",mapping:{
    n0:{parent:null,children:["n1"],message:{id:"m0",author:{role:"user"},content:{content_type:"text",parts:["Synthetic question"]}}},
    n1:{parent:"n0",children:[],message:{id:"m1",author:{role:"assistant"},content:{content_type:"text",parts:["Synthetic answer"]}}}
  }};
}
async function body(req){const chunks=[];for await(const b of req)chunks.push(b);return Buffer.concat(chunks);}
function json(res,data,status=200){res.statusCode=status;res.setHeader("Content-Type","application/json");res.end(JSON.stringify(data));}
async function route(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Headers","*");
  if(req.method==="OPTIONS"){res.end();return;}
  const u=new URL(req.url,"http://localhost"),p=u.pathname.replace("/api/extension/v1/","");
  if(p==="capabilities")return json(res,{protocol:1,import_profile:"reader-chat-v1",capture:true,resumable_capture:true});
  if(p==="projects")return json(res,[{id:project,name:"Target Ocean",default:false}]);
  if(p.startsWith("requests/"))return json(res,{id:received.get(p.split("/")[1])?.id||null});
  if(p.startsWith("transfers/")){
    const [,key,action]=p.split("/");
    if(!action){const b=JSON.parse(await body(req));received.set(key,{...b,offset:0});return json(res,{...b,offset:0,chunk_bytes:4194304});}
    const item=received.get(key);assert(item);
    if(action==="chunks"){
      const bytes=await body(req);assert(bytes.includes(Buffer.from("reader/source.jsonl")));item.offset=item.size;return json(res,{size:item.size,offset:item.offset});
    }
    if(action==="finish"){item.id="00000000-0000-4000-8000-"+String(n++).padStart(12,"0");records.set(item.id,item);return json(res,{id:item.id});}
  }
  if(p.startsWith("imports/")){
    const [,iid,action]=p.split("/"),r=records.get(iid);assert(r);
    if(action==="commit"){r.committed=true;return json(res,{id:iid,status:"queued"},202);}
    if(r.committed)return json(res,{status:"committed",state:"COMMITTED",conversation_id:iid,title:"Imported synthetic source",
      result:{version:1,action:"created",completeness:"complete",current_project:{state:"project",id:project,name:"Target Ocean"}}});
    return json(res,{status:"previewed",state:"READY",review:{receipt:"a".repeat(64),action:"new",partial:false,live_share:false}});
  }
  json(res,{},404);
}
const check=(name,pass)=>{report.checks.push({name,pass:!!pass});assert(pass,name);};
(async()=>{
  if(!real){server=http.createServer((q,s)=>route(q,s).catch(e=>{report.errors.push(e.message);json(s,{},500);}));
    await new Promise(r=>server.listen(0,"127.0.0.1",r));}
  const origin=real||"http://127.0.0.1:"+server.address().port;
  if(real)report.kind="real Edge + real FastAPI/PostgreSQL/worker, synthetic account/export and synthetic ChatGPT page";
  const built=cp.spawnSync(process.execPath,[path.join(__dirname,"package-reader.cjs"),origin,build],{encoding:"utf8"});assert.equal(built.status,0,built.stderr);
  const file=path.join(run,"synthetic-official.zip");
  const localA=conversation("source-a-assets","project-a"),localB=conversation("source-b-assets","project-b");
  localA.mapping.n0.message.metadata={attachments:[{id:"file-tidal-data",name:"tides.csv",mime_type:"text/csv"}]};
  fs.writeFileSync(file,fflate.zipSync({"conversations.json":fflate.strToU8(JSON.stringify([
    localA,localB,conversation("source-unknown"),conversation("source-outside",null)])),"file-tidal-data-tides.csv":fflate.strToU8("height,time\n2,12:00\n")}));
  const {default:puppeteer}=await import("puppeteer-core");
  browser=await puppeteer.launch({executablePath:process.env.READER_BROWSER||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true,
    userDataDir:path.join(run,"profile"),pipe:true,ignoreDefaultArgs:["--disable-extensions"],
    args:["--disable-extensions-except="+build,"--load-extension="+build,"--no-first-run","--no-default-browser-check","--disable-background-networking"]});
  report.browser=await browser.version();
  const target=await browser.waitForTarget(t=>t.type()==="service_worker"),worker=await target.worker(),base=target.url().replace(/background\.js$/,"");
  const page=await browser.newPage();await page.setViewport({width:1280,height:900});page.on("pageerror",e=>report.errors.push(e.message));
  await page.goto(base+"center.html");await page.waitForSelector("#source-file");
  check("standalone center exists before Reader connection",await page.$eval("#source-heading",n=>!!n.textContent));
  await page.screenshot({path:path.join(run,"01-source.png")});report.screens.push("01-source.png");
  await (await page.$("#source-file")).uploadFile(file);await page.waitForFunction(()=>!document.querySelector("#selection-step").hidden);
  check("initial catalogue has zero checked rows",await page.$$eval("#source-rows input:checked",n=>n.length===0));
  await page.click('#project-groups button[data-group="project:project-a"]');await page.click("#source-rows input");
  await page.click('#project-groups button[data-group="project:project-b"]');await page.click("#source-rows input");
  check("cross-project selection is retained",await page.$eval("#selected-count",n=>n.textContent.includes("2")));
  await page.click('#project-groups button[data-group="unknown"]');check("unknown project is separate from unclassified",await page.$$eval("#source-rows li",n=>n.length===1));
  await page.screenshot({path:path.join(run,"02-selection.png")});report.screens.push("02-selection.png");
  await worker.evaluate(async({origin,device,token,refresh,user})=>{
    await ReaderClient.trust;
    await chrome.storage.local.set({device:{id:device,user,name:"Synthetic test account",origin,refresh},
      destination:{device,project:"00000000-0000-4000-8000-000000000010",textOnly:false}});
    await chrome.storage.session.set({access:{origin,device,token,until:Date.now()+300000}});
  },{origin,device:grant?.device_id||device,token:grant?.access_token||originToken,refresh:grant?.refresh_token||"synthetic-refresh",user:grant?.user_id||"synthetic-owner"});
  await page.click("#to-target");await page.waitForFunction(()=>!document.querySelector("#targets").hidden&&!document.querySelector("#confirm-import").disabled);
  check("files on; mapping persistence opt-in off",await page.evaluate(()=>document.querySelector("#include-files").checked&&!document.querySelector("#remember-mapping").checked));
  await page.select("#target-mode","groups");check("separate target mapping per selected source project",await page.$$eval("#target-mappings select",n=>n.length===2));
  await page.screenshot({path:path.join(run,"03-target.png")});report.screens.push("03-target.png");
  await page.click("#confirm-import");
  await page.waitForFunction(()=>document.querySelector("#task-rows")?.children.length===2);
  await page.waitForFunction(()=>[...document.querySelectorAll("#task-rows a")].length===2,{timeout:real?180000:45000});
  if(!real){
    check("both selected chats reach authoritative committed receipts",received.size===2&&[...records.values()].every(r=>r.committed));
    check("selected destinations are frozen in each transfer", [...records.values()].every(r=>r.project===project));
  }else{
    const saved=await worker.evaluate(async()=>{const {device,jobs=[],batchPlan}=await chrome.storage.local.get(["device","jobs","batchPlan"]);
      return Promise.all(jobs.filter(j=>j.batch===batchPlan.id).map(async j=>{const r=await (await ReaderClient.request(device.id,"imports/"+j.iid)).json();
        return {status:r.status,action:r.result?.action,complete:r.result?.completeness,project:r.result?.current_project?.id};}));});
    report.actualReceipts=saved;
    check("real PostgreSQL/worker commits both selected conversations",saved.length===2&&saved.every(r=>r.status==="committed"&&r.complete==="complete"));
    check("real receipts report the fixed destination",saved.every(r=>r.project===project));
  }
  const state=await worker.evaluate(async()=>{const {batchPlan,jobs,batchMappings}=await chrome.storage.local.get(["batchPlan","jobs","batchMappings"]);
    return {items:batchPlan.items.length,jobs:jobs.map(j=>({phase:j.phase,packageReady:j.packageReady})),mappings:batchMappings||[]};});
  check("no implicit project mapping persisted",state.mappings.length===0);
  await page.screenshot({path:path.join(run,"04-results.png")});report.screens.push("04-results.png");
  await page.reload();await page.waitForFunction(()=>!document.querySelector("#resume-box").hidden);await page.click("#resume-plan");
  check("reload restores both receipts without a new upload",await page.$$eval("#task-rows a",n=>n.length===2)&&(real||received.size===2));
  for(const width of [375,320]){
    await page.setViewport({width,height:800});await page.emulateMediaFeatures([{name:"prefers-color-scheme",value:width===320?"dark":"light"}]);
    check(`${width}px has no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const screenshot=`05-results-${width}.png`;await page.screenshot({path:path.join(run,screenshot)});report.screens.push(screenshot);
  }
  await page.setViewport({width:1280,height:900});await page.emulateMediaFeatures([{name:"prefers-color-scheme",value:"light"}]);
  const sourcePage=await browser.newPage();sourcePage.on("pageerror",e=>report.errors.push(e.message));
  await sourcePage.setRequestInterception(true);
  const sourceSession={user:{id:"synthetic-source-user"},account:{id:"synthetic-workspace"},accessToken:"synthetic-source-token-never-send-to-reader"};
  sourcePage.on("request",r=>{
    const u=new URL(r.url());
    if(u.origin!=="https://chatgpt.com")return r.url().startsWith("chrome-extension://")?r.continue():r.abort();
    if(r.isNavigationRequest())return r.respond({status:200,contentType:"text/html",body:'<!doctype html><title>Synthetic Project · ChatGPT</title><nav><a href="/g/g-p-alpha/project">Alpha</a><a href="/g/g-p-alpha/c/web-alpha">Web Alpha</a><a href="/g/g-p-beta/c/web-beta">Web Beta</a></nav><main><h1>Project</h1></main>'});
    if(u.pathname==="/api/auth/session")return r.respond({status:200,contentType:"application/json",body:JSON.stringify(sourceSession)});
    if(/^\/backend-api\/conversation\/web-(alpha|beta)$/.test(u.pathname)){
      const data=JSON.stringify(conversation(u.pathname.split("/").at(-1)));
      return r.respond({status:200,contentType:"application/json",headers:{"Content-Length":String(Buffer.byteLength(data))},body:data});
    }
    return r.respond({status:404,contentType:"application/json",body:"{}"});
  });
  await sourcePage.goto("https://chatgpt.com/g/g-p-alpha/project");await page.bringToFront();
  await page.click("#new-import");await page.click("#web-source");await page.waitForSelector("#web-tabs button");await page.click("#web-tabs button");
  await page.waitForFunction(()=>!document.querySelector("#selection-step").hidden);
  check("web directory initially empty selection and marked partial",await page.evaluate(()=>document.querySelectorAll("#source-rows input:checked").length===0&&/部分|partial/.test(document.querySelector("#source-status").textContent)));
  await page.click('#project-groups button[data-group=""]');await page.click("#select-visible");await page.click("#to-target");
  await page.waitForFunction(()=>!document.querySelector("#confirm-import").disabled);await page.click("#confirm-import");
  await page.waitForFunction(()=>!document.querySelector("#tasks-step").hidden&&document.querySelector("#task-rows").textContent.includes("Web Alpha"));
  await page.waitForFunction(()=>document.querySelectorAll("#task-rows a").length===2,{timeout:real?180000:45000});
  if(!real)check("web-discovered selection reaches both committed receipts through actual isolated content scripts",received.size===4&&[...records.values()].every(r=>r.committed));
  else check("synthetic web source delivered through real API and worker",await worker.evaluate(async()=>{
    const {batchPlan,jobs}=await chrome.storage.local.get(["batchPlan","jobs"]);
    return batchPlan.items.every(i=>jobs.some(j=>j.key===i.key&&j.phase==="done"&&j.result?.completeness==="complete"));
  }));
  check("account credential never leaves the source adapter",![...received.values()].some(v=>JSON.stringify(v).includes(sourceSession.accessToken)));
  await page.screenshot({path:path.join(run,"06-web-results.png")});report.screens.push("06-web-results.png");
  check("no browser or API runtime errors",report.errors.length===0);
})().catch(e=>{report.fatal={message:e.message,stack:e.stack};process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
  fs.writeFileSync(path.join(run,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(run,"report.json"),checks:report.checks,fatal:report.fatal},null,2));
});
