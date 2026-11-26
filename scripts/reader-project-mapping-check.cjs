// Dedicated loopback only: actual installation, Web consent and worker; no personal browser/profile.
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const dir=process.env.TEMP,install=process.argv[2],origin=process.env.MAPPING_TEST_ORIGIN;
assert.match(origin||"",/^http:\/\/127\.0\.0\.1:\d{4,5}$/);
assert.match(dir||"",/^(?:E:\\chat-reader-temp\\|C:\\Users\\86182\\Desktop\\wkkk\\).+/i);
assert.equal(path.resolve(os.tmpdir()),path.resolve(dir));assert.equal(fs.readFileSync(path.join(install,"config.js"),"utf8").trim(),`globalThis.READER_ORIGIN="${origin}";`);
const session=JSON.parse(process.env.MAPPING_SYNTHETIC_SESSION);delete process.env.MAPPING_SYNTHETIC_SESSION;
const names=["Mapping existing","Mapping 海洋"],ids=["mapping-one","mapping-two","mapping-three"];
const input=ids.map((id,i)=>({id,title:`Mapping conversation ${i+1}`,project_id:"source-"+i,...(names[i]?{project_name:names[i]}:{}),
  current_node:"a",mapping:{
    q:{parent:null,children:["a"],message:{id:"q"+i,author:{role:"user"},content:{content_type:"text",parts:["Mapping question "+i]}}},
    a:{parent:"q",children:[],message:{id:"a"+i,author:{role:"assistant"},content:{content_type:"text",parts:["Mapping answer "+i]}}}
  }}));
const checks=[],check=(name,v)=>{assert.ok(v,name);checks.push(name);},start=new Date().toISOString();
let browser,pendingStep="launch",version;
(async()=>{
  fs.writeFileSync(path.join(dir,"mapping.synthetic.json"),JSON.stringify(input),{flag:"wx"});
  const {default:puppeteer}=await import("puppeteer-core");
  browser=await puppeteer.launch({executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true,
    pipe:true,ignoreDefaultArgs:["--disable-extensions"],args:["--disable-extensions-except="+install,"--load-extension="+install,
      "--no-first-run","--no-default-browser-check","--disable-background-networking"]});
  version=await browser.version();
  pendingStep="synthetic-web-session";
  await browser.setCookie(...Object.entries(session.cookies).map(([name,value])=>({name,value,url:origin,domain:"127.0.0.1",path:"/",secure:false,sameSite:"Lax",httpOnly:name==="chat_reader_session"})));
  pendingStep="paired-device";
  const workerTarget=await browser.waitForTarget(t=>t.type()==="service_worker"&&t.url().endsWith("/background.js")),worker=await workerTarget.worker();
  await worker.evaluate(async({session,origin})=>{
    await ReaderClient.trust;
    await chrome.storage.local.set({device:{id:session.device,user:session.user,origin,name:"Synthetic reader"}});
    await chrome.storage.session.set({access:{device:session.device,origin,token:session.token,until:Date.now()+420000}});
  },{session:{device:session.device,user:session.user,token:session.token},origin});
  pendingStep="source-selection";const page=await browser.newPage(),errors=[];page.on("pageerror",()=>errors.push("runtime"));
  await page.setViewport({width:930,height:800});await page.goto(workerTarget.url().replace(/background\.js$/,"center.html"));
  await (await page.waitForSelector("#source-file")).uploadFile(path.join(dir,"mapping.synthetic.json"));
  await page.waitForFunction(()=>!document.querySelector("#selection-step").hidden);
  for(const id of ids)await page.click(`#source-rows li[data-id="${id}"] input`);
  pendingStep="destination-list";
  await page.click("#to-target");await page.waitForFunction(()=>!document.querySelector("#confirm-import").disabled);
  const row=i=>`.mapping-row[data-group="project:source-${i}"]`,button=i=>row(i)+" .mapping-target > button";
  await page.click(button(0));check("existing same-name choice bound to its Reader UUID",await page.$eval("#mapping-0",(e,id)=>e.value===id,session.existing));
  await page.click(button(2));check("ID-only group leaves name empty and shows a conversation for recognition",
    await page.$eval(row(2),e=>e.querySelector("input").value===""&&e.textContent.includes("Mapping conversation 3")));
  await page.click(row(2)+" .mapping-actions button[type=button]");
  await page.click(button(1));check("new same-name project prefills the verified source label",await page.$eval("#mapping-1-name",(e,n)=>e.value===n,names[1]));
  for(const width of [930,375,320]){
    await page.setViewport({width,height:800});
    check(`${width}px mapping fits and all destination controls stay reachable`,await page.evaluate(()=>{
      const controls=[...document.querySelectorAll("#target-mappings select,#target-mappings input,#target-mappings button")];
      return document.documentElement.scrollWidth<=innerWidth&&controls.every(e=>{
        const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.width>0&&r.height>=40;
      });
    }));
    await page.screenshot({path:path.join(dir,`mapping-${width}.png`)});
  }
  await page.setViewport({width:930,height:800});
  check("editing a name cannot start import before confirmation",await page.$eval("#confirm-import",e=>e.disabled));
  pendingStep="reader-confirmation-window";await page.click(row(1)+" button[type=submit]");
  const consentTarget=await browser.waitForTarget(t=>t.url().startsWith(origin+"/extension/import-project"),{timeout:18000});
  const consent=await consentTarget.page()||await consentTarget.asPage();assert.ok(consent,"Browser confirmation page");
  await consent.waitForFunction(()=>[...document.querySelectorAll("main button")].some(b=>/Confirm and return|确认并返回/.test(b.textContent)&&!b.disabled));
  check("Reader Web shows the proposed name before a write",await consent.$eval("main",(e,n)=>e.textContent.includes(n),names[1]));
  check("Reader has not created the proposed project on opening its window",
    await worker.evaluate(async({d,n})=>!(await (await ReaderClient.request(d,"projects")).json()).some(p=>p.name===n),{d:session.device,n:names[1]}));
  await consent.screenshot({path:path.join(dir,"reader-confirmation.png")});
  pendingStep="verified-return";await consent.evaluate(()=>[...document.querySelectorAll("main button")].find(b=>/Confirm and return|确认并返回/.test(b.textContent)).click());
  await page.waitForFunction(()=>!document.querySelector("#confirm-import").disabled&&!!document.querySelector("#mapping-1").value,{timeout:20000});
  const newId=await page.$eval("#mapping-1",e=>e.value);
  check("callback selects only its original row",newId!==session.existing&&await page.$eval("#mapping-2",e=>e.value==="")&&await page.$eval("#mapping-0",(e,id)=>e.value===id,session.existing));
  await page.select("#mapping-2",newId);pendingStep="worker";
  await page.click("#confirm-import");
  await page.waitForFunction(async()=>{const {batchPlan,jobs=[]}=await chrome.storage.local.get(["batchPlan","jobs"]);
    return batchPlan?.items.length===3&&batchPlan.items.every(i=>jobs.some(j=>j.key===i.key&&j.phase==="done"));},{timeout:180000,polling:350});
  const projectIds=await worker.evaluate(async()=>{
    const {device,batchPlan,jobs}=await chrome.storage.local.get(["device","batchPlan","jobs"]);
    return Promise.all(batchPlan.items.map(async item=>{
      const j=jobs.find(entry=>entry.key===item.key);
      const actual=await (await ReaderClient.request(device.id,"imports/"+j.iid)).json();
      if(actual.status!=="committed"||actual.result.completeness!=="complete"||item.project!==actual.result.saved_project.id||
        actual.result.saved_project.id!==actual.result.current_project.id)throw Error("Unexpected committed destination");
      return actual.result.current_project.id;
    }));
  });
  check("three real worker receipts retain the three confirmed targets",JSON.stringify(projectIds)===JSON.stringify([session.existing,newId,newId]));
  check("no runtime errors",errors.length===0);pendingStep="complete";
})().catch(e=>{
  // Don't persist request URLs, session cookies, grants, or project/group identifiers from browser traces.
  const kind=e.message.match(/No element found|not clickable|Execution context was destroyed|Invalid cookie fields|Protocol error|timeout|not supported/i)?.[0]||e.name;
  const lines=Array.from((e.stack||"").matchAll(/reader-project-mapping-check\.cjs:(\d+)/g),m=>m[1]);
  console.error("Mapping gate did not finish at "+pendingStep+": "+kind+" lines "+lines.join(",")+
    (e.code==="ERR_ASSERTION"?" ("+e.message.split("\n")[0]+")":""));process.exitCode=1;
}).finally(async()=>{
  if(browser)await browser.close();
  fs.writeFileSync(path.join(dir,"mapping-browser.json"),JSON.stringify({start,end:new Date().toISOString(),version,checks,step:pendingStep},null,2));
});
