// Real local name-query/first-paint timing, not production-network performance.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process"),assert=require("node:assert/strict");
const temp=process.env.TEMP,origin=process.env.READER_TEST_ORIGIN,credential=process.env.READER_TEST_DEVICE_FILE;
if(!temp||!/^E:\\chat-reader-temp\\|^C:\\Users\\86182\\Desktop\\wkkk\\/i.test(temp)||!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin||""))throw Error("Disposable loopback and approved TEMP required.");
const dir=fs.mkdtempSync(path.join(temp,"catalog-browser-")),build=path.join(dir,"extension"),grant=JSON.parse(fs.readFileSync(credential,"utf8"));
const report={at:new Date().toISOString(),kind:"real Edge + local PostgreSQL/API, 10000 synthetic chats /100000 body-index rows",samples:[],checks:[],errors:[]};let browser;
(async()=>{
  const built=cp.spawnSync(process.execPath,[path.join(__dirname,"package-reader.cjs"),origin,build],{encoding:"utf8"});assert.equal(built.status,0,built.stderr);
  const {default:puppeteer}=await import("puppeteer-core");
  browser=await puppeteer.launch({executablePath:process.env.READER_BROWSER||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true,
    userDataDir:path.join(dir,"profile"),pipe:true,ignoreDefaultArgs:["--disable-extensions"],args:["--disable-extensions-except="+build,"--load-extension="+build,"--no-first-run","--disable-background-networking"]});
  report.browser=await browser.version();const target=await browser.waitForTarget(t=>t.type()==="service_worker"),worker=await target.worker();
  await worker.evaluate(async({origin,grant})=>{
    await ReaderClient.trust;await chrome.storage.local.set({device:{origin,id:grant.device_id,user:grant.user_id,name:"Synthetic account",refresh:grant.refresh_token},
      destination:{device:grant.device_id,project:null}});
    await chrome.storage.session.set({access:{origin,device:grant.device_id,token:grant.access_token,until:Date.now()+300000}});
  },{origin,grant});
  const page=await browser.newPage();page.on("pageerror",e=>report.errors.push(e.message));await page.setViewport({width:375,height:820});
  await page.goto(target.url().replace(/background\.js$/,"panel.html"));await page.waitForFunction(()=>!document.querySelector("#library").hidden&&!document.querySelector("#rows").hasAttribute("aria-busy"));
  const cases=[["title project",29],["abyssal",0],["benchmark 89-18",1]];
  for(let i=0;i<23;i++){
    const [query,count]=cases[i%cases.length];
    const duration=await page.evaluate(async({query,count})=>{
      const input=document.querySelector("#q"),rows=document.querySelector("#rows");const from=performance.now();let observed=false;
      return new Promise((resolve,reject)=>{
        const clock=setTimeout(()=>{observer.disconnect();reject(Error("Actual query did not settle"));},10000);
        const observer=new MutationObserver(()=>{
          if(rows.hasAttribute("aria-busy"))observed=true;
          if(observed&&!rows.hasAttribute("aria-busy")){
            if(rows.children.length!==count){clearTimeout(clock);observer.disconnect();reject(Error("Unexpected name-query result count"));return;}
            observer.disconnect();requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(clock);resolve(performance.now()-from);}));
          }
        });observer.observe(rows,{attributes:true,childList:true});
        input.value=query;input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:query}));
      });
    },{query,count});
    if(i>=3)report.samples.push({query,count,input_to_paint_ms:Math.round(duration*100)/100});
  }
  report.p95_ms=[...report.samples].map(s=>s.input_to_paint_ms).sort((a,b)=>a-b)[Math.ceil(report.samples.length*.95)-1];
  report.checks.push({name:"input-ended to visible results P95 <=400ms",pass:report.p95_ms<=400});
  assert(report.p95_ms<=400,"Input-to-paint P95 exceeded unchanged 400ms goal");
  await page.screenshot({path:path.join(dir,"name-query-375.png")});
  assert.equal(report.errors.length,0);
})().catch(e=>{report.fatal={message:e.message,stack:e.stack};process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();fs.writeFileSync(path.join(dir,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(dir,"report.json"),p95_ms:report.p95_ms,checks:report.checks,fatal:report.fatal},null,2));
});
