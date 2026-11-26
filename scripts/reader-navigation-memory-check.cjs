// Actual Edge, actual source-file/Fork/visible/page-index code. Synthetic local
// source only; this is not authorization, live ChatGPT or deployment evidence.
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const repo=path.resolve(__dirname,".."),root=path.resolve(process.argv[2]||"");
if(!process.argv[2]||!["E:\\chat-reader-temp","C:\\Users\\86182\\Desktop\\wkkk"].some(p=>root.toLowerCase().startsWith(path.resolve(p).toLowerCase()+path.sep)))
  throw Error("Supply an authorized evidence directory.");
fs.mkdirSync(root,{recursive:true});const out=fs.mkdtempSync(path.join(root,"edge-navigation-memory-"));process.env.TEMP=process.env.TMP=out;
const file=path.join(out,"synthetic-source.json"),fd=fs.openSync(file,"wx"),rows=50001;
try{
  fs.writeSync(fd,'{"title":"Synthetic memory regression","conversation_id":"synthetic-memory","current_node":"n50000","mapping":{');
  for(let i=0;i<rows;i++){
    const body=i===0?"x".repeat(2*1024*1024+17)+"\n"+Array.from({length:111},(_,j)=>`long ${j} targetneedle`).join("\n"):
      `Synthetic ${i} targetneedle `+"x".repeat(2048);
    const m={id:`m${i}`,author:{role:i%2?"assistant":"user"},content:{content_type:"text",parts:[body]}};
    if(i===1)m.metadata={model_dil_v2:{fallbackMarkdown:"Safe static targetneedle",compiled:"never-retain-raw-program\n"+"z".repeat(1024*1024)}};
    fs.writeSync(fd,(i?",":"")+JSON.stringify("n"+i)+":"+JSON.stringify({parent:i?"n"+(i-1):null,children:i+1<rows?["n"+(i+1)]:[],message:m}));
  }
  fs.writeSync(fd,"}}");
}finally{fs.closeSync(fd);}
const files=["extension/locales/en.js","extension/i18n.js","extension/fast-text.js","extension/source-dom.js","reader/visible.js","reader/source-file.js","reader/page-index.js"];
const result={at:new Date().toISOString(),kind:"real Edge + synthetic local 50001-message Blob; not live ChatGPT",sourceBytes:fs.statSync(file).size,
  files:Object.fromEntries(files.map(n=>[n,crypto.createHash("sha256").update(fs.readFileSync(path.join(repo,n))).digest("hex")])),heaps:{},checks:[]};
const server=http.createServer((req,res)=>{
  if(req.url==="/source"){res.writeHead(200,{"Content-Type":"application/json","Content-Length":result.sourceBytes});fs.createReadStream(file).pipe(res);}
  else{res.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});res.end("<!doctype html><html><head><meta charset=utf-8></head><body><p>Synthetic local navigation memory regression</p></body></html>");}
});
let browser;
(async()=>{
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin="http://127.0.0.1:"+server.address().port;
  const {default:p}=await import(path.join(repo,"node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js").replace(/\\/g,"/").replace(/^([A-Z]:)/,"file:///$1"));
  browser=await p.launch({executablePath:process.env.EDGE_PATH||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless:true,pipe:true,userDataDir:path.join(out,"profile"),args:["--no-first-run","--disable-background-networking"]});
  result.browser=await browser.version();const page=await browser.newPage();page.setDefaultTimeout(240000);
  await page.setRequestInterception(true);page.on("request",r=>r.url().startsWith(origin+"/")?r.continue():r.abort());
  await page.goto(origin+"/c/synthetic-memory");
  for(const f of files)await page.addScriptTag({content:fs.readFileSync(path.join(repo,f),"utf8")});
  const cdp=await page.createCDPSession(),heap=async key=>{await cdp.send("HeapProfiler.collectGarbage");result.heaps[key]=await cdp.send("Runtime.getHeapUsage");};
  await heap("baseline");
  result.index=await page.evaluate(async()=>{
    const start=performance.now();window.__blob=await(await fetch("/source")).blob();
    window.__data=await ReaderSourceFile.tree(__blob,await ReaderSourceFile.header(__blob,()=>{}),undefined,()=>{},()=>{});
    return {ms:performance.now()-start,bytes:__blob.size,ids:__data.ids.size};
  });await heap("sourceIndex");
  result.metadata=await page.evaluate(async()=>{
    const start=performance.now();window.__rows=[];
    for await(const m of __data.rows())__rows.push(ReaderPageIndex.metadata(ReaderPageIndex.fromBranch({messages:[m]})[0]));
    const serialized=JSON.stringify(__rows);
    window.__loadCalls=0;window.__load=async(id,signal)=>{signal?.throwIfAborted();__loadCalls++;const m=await __data.row(id);signal?.throwIfAborted();return ReaderVisible(m,FastTextExporter).body;};
    return {ms:performance.now()-start,count:__rows.length,bodyKeys:__rows.filter(r=>"body"in r||"dil"in r).length,
      jsonBytes:new TextEncoder().encode(serialized).length,rawProgramPresent:serialized.includes("never-retain-raw-program")};
  });await heap("metadata");
  result.search=await page.evaluate(async()=>{
    const start=performance.now();window.__result=await ReaderPageIndex.search(__rows,__load,"targetneedle",{signal:new AbortController().signal});
    const before=__loadCalls,last=await ReaderPageIndex.search(__rows,__load,"targetneedle",{index:__result,page:__result.cursors.length-1});
    return {ms:performance.now()-start,total:__result.total,hits:__result.hits.length,cursors:__result.cursors.length,
      firstOffset:__result.hits[0].start,lastID:last.hits.at(-1).id,lastPageReads:__loadCalls-before,
      retainedResultBytes:new TextEncoder().encode(JSON.stringify(__result)).length};
  });await heap("search");
  assert.equal(result.index.ids,50001);assert.equal(result.metadata.count,50001);assert.equal(result.metadata.bodyKeys,0);
  assert.equal(result.metadata.rawProgramPresent,false);assert.ok(result.sourceBytes>100*1024*1024);
  assert.ok(result.metadata.jsonBytes<result.sourceBytes/3);
  assert.equal(result.search.total,50111);assert.equal(result.search.hits,64);assert.equal(result.search.lastID,"m50000");
  assert.ok(result.search.firstOffset>2*1024*1024);assert.ok(result.search.lastPageReads<=64);assert.ok(result.search.retainedResultBytes<60000);
  result.retainedJSDelta=result.heaps.search.usedSize-result.heaps.sourceIndex.usedSize;
  assert.ok(result.retainedJSDelta<result.sourceBytes*.65,"Metadata/search must not retain another full transcript string array.");
  result.checks.push("actual source Blob >100 MiB / 50001 messages","body >2 MiB and 111 later matches preserved",
    "metadata contains no body/DIL, source program never retained","50111 total matches, 64-hit current page, final message accessible",
    "last page reads <=64 source rows","retained JS delta <65% of raw bytes; raw Blob backing storage reported separately");
  await page.evaluate(()=>{__rows=__data=__result=__blob=__load=null;});await heap("released");
})().catch(e=>{result.failure=e.stack;process.exitCode=1;}).finally(async()=>{
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));
  if(browser)await browser.close();await new Promise(r=>server.close(r));
  console.log(JSON.stringify({evidence:out,...result},null,2));
});
