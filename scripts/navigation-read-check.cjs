// Synthetic JSDOM diagnostic of a packaged Reader navigation path, NOT browser acceptance.
// Emits numbers only; does not contact ChatGPT, Reader or an authenticated browser.
const fs = require("node:fs"), path = require("node:path"), {JSDOM} = require("jsdom");
const [dir, output] = process.argv.slice(2);
if(!dir||!output||process.argv.length!==4)throw Error("Usage: node scripts/navigation-read-check.cjs PACKAGED_DIRECTORY NEW_RESULT_JSON");
const messages=256,mounted=8,mapping={};
const text=i=>`Synthetic question or answer ${i}\n\n## Part ${i}\n\n`+"Example words. ".repeat(15);
for(let i=0;i<messages;i++)mapping["n"+i]={parent:i?"n"+(i-1):null,children:i+1<messages?["n"+(i+1)]:[],
  message:{id:"m"+i,author:{role:i%2?"assistant":"user"},content:{content_type:"text",parts:[text(i)]}}};
const data=JSON.stringify({conversation_id:"synthetic",current_node:"n255",mapping});
const markup=Array.from({length:mounted},(_,i)=>`<article data-message-id="m${i}" data-message-author-role="${i%2?"assistant":"user"}"><p>${text(i)}</p></article>`).join("");
const dom=new JSDOM(`<main data-current-node-id="n255">${markup}</main>`,
  {url:"https://chatgpt.com/c/synthetic",pretendToBeVisual:true,runScripts:"outside-only"});
const w=dom.window,times=[],phases=[];
let samples=0,styleCalls=0,sourceBytes=0,requests=0,overlay;
const getStyle=w.getComputedStyle.bind(w);
w.getComputedStyle=(...args)=>{styleCalls++;return getStyle(...args);};
Object.assign(w,{TextEncoder,TextDecoder,Blob,Response,Headers,ReadableStream,TransformStream,AbortController,
  ReaderSourceControl(){},ReaderOverlay(options){overlay=options;},
  fetch:async(input)=>{
    requests++;
    if(input.pathname==="/api/auth/session")return Response.json({accessToken:"test-only"});
    if(input.pathname!=="/backend-api/conversation/synthetic")throw Error("Unexpected synthetic request");
    sourceBytes+=Buffer.byteLength(data);return new Response(data);
  }});
w.Element.prototype.getClientRects=()=>[{top:0,bottom:36,left:0,right:300,width:300,height:36}];
const manifest=JSON.parse(fs.readFileSync(path.join(dir,"manifest.json")));
for(const n of ["locales/en.js","i18n.js","fast-text.js","source-dom.js","progress.js","source-file.js","visible.js","page-index.js","capture.js"])
  w.eval(fs.readFileSync(path.join(dir,n),"utf8"));
const sample=w.ReaderPageIndex.sample;
w.ReaderPageIndex.sample=(...args)=>{samples++;return sample(...args);};
(async()=>{
  let last=performance.now();const start=last;
  function tick(){const now=performance.now();times.push(now-last);last=now;}
  const pulse=setInterval(tick,10);
  try{
    const result=await overlay.read(new AbortController(),step=>{
      if(phases.at(-1)?.stage!==step.stage)phases.push({stage:step.stage,atMs:Math.round(performance.now()-start)});
    });
    tick();
    if(!result.complete||result.rows.length!==messages||!result.rows.every((r,i)=>r.id==="m"+i))throw Error("Unverified fixture result");
    const info={type:"synthetic JSDOM, stored numbers only",version:manifest.version,start:new Date(performance.timeOrigin+start).toISOString(),
      questions:messages/2,mounted,messages,sourceBytes,requests,samples,styleCalls,elapsedMs:Math.round(performance.now()-start),
      maxTimerGapMs:Math.round(Math.max(...times)),phases,rows:result.rows.length,complete:result.complete};
    fs.writeFileSync(output,JSON.stringify(info,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(info));
  }finally{clearInterval(pulse);dom.window.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
