const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom");
function fixture(){
  const dom=new JSDOM("<body></body>",{runScripts:"outside-only"}),w=dom.window;
  for(const f of ["progress.js","progress-view.js"])w.eval(fs.readFileSync(path.join(__dirname,"../reader",f),"utf8"));
  const view=w.ReaderProgressView({zh:true});w.document.body.append(view.root);return {w,view,close:()=>w.close()};
}
test("cumulative task rows survive phase changes without summing per-resource resets or inventing totals",()=>{
  const p=fixture();try{
    let stats=p.w.ReaderProgress.accumulate(null,{stage:"source",sourceBytes:2097152,sourcePages:2,done:1048576});
    stats=p.w.ReaderProgress.accumulate(stats,{stage:"asset",assetBytes:3145728,done:1024,filesStarted:2,filesSucceeded:1,filesDiscovered:2});
    p.view.update({stats,step:{stage:"asset",done:1024},startedAt:Date.now()-1500,state:"saving"});
    assert.match(p.view.root.querySelector(".progress-headline").textContent,/5.0 MiB/);
    assert.match(p.view.root.querySelector('[data-stage="source"] dd').textContent,/2.0 MiB.*2 页/);
    assert.match(p.view.root.querySelector('[data-stage="asset"] dd').textContent,/1 已读取.*已发现 2/);
    assert.doesNotMatch(p.view.root.textContent,/%|共 2 个/,"Discovery is not a known complete total.");
    p.view.update({stats,step:{stage:"upload",done:0},state:"saving"});
    assert.match(p.view.root.querySelector('[data-stage="source"] dd').textContent,/2.0 MiB/);
    assert.equal(p.view.root.querySelector('[data-stage="upload"] dd').textContent,"等待","Sent/step bytes cannot substitute for durable acknowledged bytes.");
  }finally{p.close();}
});
test("server 100 percent alone is not success; partial and stopped receipts remain explicit",()=>{
  const p=fixture();try{
    const stats={serverProgress:100,packageBytes:4096,uploadBytes:4096,messageCount:2,textBytes:512,filesTotal:1,filesFailed:1,filesSucceeded:0};
    p.view.update({stats,state:"saving"});assert.match(p.view.root.querySelector('[data-stage="server"] dd').textContent,/处理中/);
    assert.doesNotMatch(p.view.root.textContent,/已确认保存/);
    p.view.update({stats,state:"saving",taskPhase:"received",step:{stage:"upload",done:4096,total:4096}});
    assert.match(p.view.root.querySelector('[data-stage="server"] dd').textContent,/已接收.*等待处理/);
    assert.equal(p.view.root.querySelector('[data-active="true"]').dataset.stage,"server");
    p.view.update({stats,state:"partial"});assert.match(p.view.root.textContent,/部分内容已保存/);
    p.view.update({stats,state:"failed"});assert.match(p.view.root.textContent,/尚未完成/);
    assert.doesNotMatch(p.view.root.querySelector('[data-stage="server"] dd').textContent,/处理中|已确认/);
    p.view.update({stats,state:"review"});assert.match(p.view.root.querySelector('[data-stage="server"] dd').textContent,/等待核对/);
    assert.doesNotMatch(p.view.root.querySelector('[data-stage="server"] dd').textContent,/处理中/);
    p.view.update({stats,state:"cancelled",step:{stage:"upload",done:4096,total:4096}});
    assert.match(p.view.root.querySelector('[data-stage="server"] dd').textContent,/已取消/);
    assert.equal(p.view.root.querySelectorAll('[data-active="true"]').length,0,"stopped work cannot highlight an active phase");
  }finally{p.close();}
});
test("current attachment progress is local to that file, and disappears after the task stops",()=>{
  const p=fixture();try{
    p.view.update({stats:{assetBytes:9000,filesDiscovered:3,filesSucceeded:1},state:"saving",
      step:{stage:"asset",files:2,done:4000,total:8000}});
    const current=p.view.root.querySelector(".progress-current"),meter=current?.querySelector("progress");
    assert.ok(current&&!current.hidden);
    assert.match(current.textContent,/当前附件 2.*3.9 KiB.*7.8 KiB/);
    assert.equal(meter.max,8000);assert.equal(meter.value,4000);
    p.view.update({stats:{assetBytes:10000},state:"saving",step:{stage:"asset",files:3,done:1000}});
    assert.equal(meter.hidden,true,"an unknown individual file size cannot invent a percent");
    p.view.update({stats:{assetBytes:10000},state:"paused",step:{stage:"asset",files:3,done:1000}});
    assert.equal(current.hidden,true);assert.equal(p.view.root.querySelectorAll('[data-active="true"]').length,0);
  }finally{p.close();}
});
test("private job presentation preserves failure, append review and legacy uncertainty instead of inventing completion",()=>{
  const p=fixture();try{
    const status=p.w.ReaderProgressView.stateForJob;
    assert.equal(status({phase:"attention",active:false,diagnostic:{category:"server"}}),"failed");
    assert.equal(status({phase:"done",active:false}),"uncertain");
    assert.equal(status({phase:"done",result:{completeness:"complete"}}),"saved");
    assert.equal(status({phase:"done",result:{completeness:"partial"}}),"partial");
    assert.equal(status({phase:"append-ready",active:false}),"append-ready");
    p.view.update({state:"append-ready"});assert.match(p.view.root.textContent,/等待 Reader 确认/);
    assert.equal(status({phase:"append-attention",active:false}),"failed");
    assert.equal(status({phase:"upload-paused",active:false,packageReady:true}),"paused");
    assert.equal(status({phase:"cancelled",active:false}),"cancelled");
    assert.equal(status({phase:"received",active:true}),"saving");
  }finally{p.close();}
});
test("a stopped receipt shows the safe failure stage without needing counters, and unresolved hints are not successful files",()=>{
  const p=fixture();try{
    p.view.update({state:"system-hold",diagnostic:{category:"server",stage:"archive",code:"READER_PACKAGE_INVALID",message:"PRIVATE"}});
    const stage=p.view.root.querySelector(".progress-failure-stage");
    assert.equal(stage.hidden,false);assert.match(stage.textContent,/停止阶段：检查导入包/);assert.match(p.view.root.textContent,/重复提交同一个包不能解决问题/);
    p.view.update({state:"partial",diagnostic:{category:"source",stage:"PRIVATE"},stats:{filesSucceeded:0,filesTotal:0,unresolvedResources:2}});
    assert.equal(stage.hidden,true);assert.match(p.view.root.querySelector('[data-stage="asset"] dd').textContent,/2 个未解析资源提示/);
    assert.doesNotMatch(p.view.root.textContent,/PRIVATE/);
  }finally{p.close();}
});
test("diagnostic/stat presentation rejects private and malformed payloads instead of rendering them",()=>{
  const p=fixture();try{
    const stats={sourceBytes:2,title:"PRIVATE_TITLE",url:"https://secret.example/path",token:"PRIVATE_TOKEN",filesTotal:-1,assetBytes:Infinity,uploadBytes:NaN};
    p.view.update({stats,step:{stage:"<script>PRIVATE_STAGE</script>",done:0}});
    assert.doesNotMatch(p.view.root.textContent,/PRIVATE|secret.example|Infinity|NaN|-1/);
    assert.equal(p.view.root.querySelectorAll("script").length,0);
  }finally{p.close();}
});
