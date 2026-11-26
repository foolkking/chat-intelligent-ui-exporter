// Actual packaged extension, synthetic local directory and receipts only.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const repo=path.resolve(__dirname,".."),temp=process.env.TEMP;
if(!temp||!/^E:\\chat-reader-temp\\|^C:\\Users\\86182\\Desktop\\wkkk\\/i.test(temp))throw Error("Approved task TEMP required.");
const run=fs.mkdtempSync(path.join(temp,"center-layout-")),build=path.join(run,"extension"),origin="https://reader.example.test";
const report={at:new Date().toISOString(),kind:"real Edge unpacked extension; synthetic directory and journal, not real accounts",checks:[],errors:[]};
const sources=["center.js","center.html","center.css","center-selection.js","batch-model.js"];
const hashes=()=>Object.fromEntries(sources.map(n=>[n,crypto.createHash("sha256").update(fs.readFileSync(path.join(repo,"reader",n))).digest("hex")]));
report.inputHashes=hashes();let browser;
const check=(name,value)=>{report.checks.push({name,pass:!!value});assert(value,name);};
(async()=>{
  const pack=cp.spawnSync(process.execPath,[path.join(__dirname,"package-reader.cjs"),origin,build],{encoding:"utf8"});assert.equal(pack.status,0,pack.stderr);
  const rows=Array.from({length:150},(_,i)=>({id:"synthetic-"+i,title:"Synthetic source "+String(i).padStart(3,"0"),
    project_id:"project-"+Math.floor(i/50),update_time:1700000000+i,current_node:"a",mapping:{
      q:{parent:null,children:["a"],message:{id:"q"+i,author:{role:"user"},content:{content_type:"text",parts:["Question "+i]}}},
      a:{parent:"q",children:[],message:{id:"a"+i,author:{role:"assistant"},content:{content_type:"text",parts:["Answer "+i]}}}
    }}));
  const source=path.join(run,"conversations.json");fs.writeFileSync(source,JSON.stringify(rows));
  const {default:puppeteer}=await import("puppeteer-core");
  browser=await puppeteer.launch({executablePath:process.env.READER_BROWSER||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless:true,pipe:true,userDataDir:path.join(run,"profile"),ignoreDefaultArgs:["--disable-extensions"],
    args:["--disable-extensions-except="+build,"--load-extension="+build,"--no-first-run","--disable-background-networking"]});
  report.browser=await browser.version();
  const target=await browser.waitForTarget(t=>t.type()==="service_worker"),worker=await target.worker();
  const page=await browser.newPage();page.on("pageerror",e=>report.errors.push(e.message));await page.setViewport({width:1280,height:900});
  await page.goto(target.url().replace(/background\.js$/,"center.html?tab=999999"));
  await (await page.$("#source-file")).uploadFile(source);await page.waitForFunction(()=>!document.querySelector("#selection-step").hidden);
  check("source reads show zero initial selection",await page.$$eval("#source-rows input:checked",x=>x.length===0));
  await page.click("#selection-more summary");
  await page.click("#select-page");check("page select fixes exactly 50",await page.$eval("#selected-count",e=>e.textContent.includes("50")));
  await page.click("#source-more");check("next page keeps exactly 50 DOM rows",await page.$$eval("#source-rows li",x=>x.length===50));
  await page.click("#select-page");check("cross-page selection retains 100",await page.$eval("#selected-count",e=>e.textContent.includes("100")));
  await page.select("#selection-view","selected");await page.click("#source-rows input");
  check("selected view removes one selected reference",await page.$eval("#selected-count",e=>e.textContent.includes("99")));
  await page.select("#selection-view","all");await page.click('#project-groups button[data-group="project:project-2"]');
  check("only proven local project permits whole-export project action",await page.$eval("#select-project",e=>!e.disabled&&!e.hidden));
  await page.click("#select-project");check("whole-export project preserves prior selections and fixes 149 IDs",await page.$eval("#selected-count",e=>e.textContent.includes("149")));
  await page.click("#selection-more summary");
  for(const width of [1280,375,320]){
    await page.setViewport({width,height:width===1280?900:800});
    const g=await page.evaluate(()=>{const r=document.querySelector("#to-target").getBoundingClientRect(),list=document.querySelector("#source-rows");
      return {footer:r.bottom<=innerHeight&&r.top>=0,overflow:document.documentElement.scrollWidth<=innerWidth,
        bounded:list.children.length<=50&&list.scrollHeight>list.clientHeight&&getComputedStyle(list).overflowY==="auto"};});
    check(`${width}px bounded list, visible main action and no horizontal overflow`,g.footer&&g.overflow&&g.bounded);
    await page.screenshot({path:path.join(run,`selection-${width}.png`)});
  }
  const device="00000000-0000-4000-8000-000000000011",uid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
  await worker.evaluate(async({origin,device,items,jobs})=>{
    await ReaderClient.trust;await chrome.storage.local.set({device:{id:device,user:"synthetic",origin,name:"Synthetic"},
      batchPlan:{version:1,id:"synthetic-review",device,user:"synthetic",origin,source:{kind:"archive",scope:"synthetic"},
        items,attachments:true,paused:true},jobs});
  },{origin,device,items:rows.map((r,i)=>({id:r.id,title:r.title,group:"unknown",project:null,key:uid(i+10),cancelled:false})),
    jobs:rows.map((r,i)=>({key:uid(i+10),device,batch:"synthetic-review",iid:uid(i+1000),phase:i?"done":"review",active:false,
      cid:i?uid(i+2000):null,result:i?{completeness:"complete",action:"created"}:null,
      review:i?null:{receipt:"a".repeat(64),action:"conflict",conversation_id:uid(9999),partial:false,live_share:false}}))});
  await page.setViewport({width:1280,height:900});await page.reload();await page.waitForFunction(()=>!document.querySelector("#resume-box").hidden);
  await page.click("#resume-plan");await page.waitForFunction(()=>document.querySelector("#task-rows").children.length===50);
  check("150 receipt rows render one bounded page",await page.$$eval("#task-rows li",x=>x.length===50));
  await page.select("#task-filter","review");await page.waitForFunction(()=>document.querySelector("#task-rows").children.length===1);
  check("review filter isolates the real conflict",await page.$eval("#task-rows",e=>e.textContent.includes("Synthetic source 000")));
  await page.screenshot({path:path.join(run,"conflict-review.png")});
  const skip=await page.$$("#task-rows button");await skip.at(-1).click();
  await page.waitForFunction(()=>document.querySelector("#task-rows").children.length===0);
  check("skip records no canonical cancellation and leaves the original receipt",await worker.evaluate(async()=>{
    const {batchPlan,jobs}=await chrome.storage.local.get(["batchPlan","jobs"]);return batchPlan.items[0].skipped&&jobs[0].phase==="review"&&!!jobs[0].iid;}));
  await page.click("#new-import");await page.waitForFunction(()=>!document.querySelector("#source-step").hidden);
  check("a skipped conflict no longer traps the import center",true);
  check("no browser runtime errors",report.errors.length===0);
  report.outputHashes=hashes();check("tested product snapshot unchanged during browser run",JSON.stringify(report.inputHashes)===JSON.stringify(report.outputHashes));
})().catch(e=>{report.fatal={message:e.message,stack:e.stack};process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();fs.writeFileSync(path.join(run,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:path.join(run,"report.json"),checks:report.checks,fatal:report.fatal},null,2));
});
