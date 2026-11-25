const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const cp=require("node:child_process"),path=require("node:path");
test("file reader never caches a large record and paginated readers share a bounded window",async()=>{
  const env=vm.createContext({TextDecoder,Uint8Array,Blob});
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../reader/source-file.js"),"utf8"),env);
  const a=new Blob([JSON.stringify("A".repeat(3*1024*1024))]),b=new Blob([JSON.stringify("B".repeat(20))]);
  const cache={start:-1,window:new Uint8Array()};
  const one=env.ReaderSourceFile.fileReader(a,cache),two=env.ReaderSourceFile.fileReader(b,cache);
  assert.equal((await one(0,a.size)).length,3*1024*1024);assert.equal(cache.window.byteLength,0);
  assert.equal(await two(0,b.size),"B".repeat(20));assert.equal(cache.file,b);assert.ok(cache.window.byteLength<=262144);
});
test("twelve 3MiB pages do not retain twelve decoded parser buffers after GC",()=>{
  const result=cp.spawnSync(process.execPath,["--expose-gc","-e",`
    const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict");
    const refs=[],env=vm.createContext({TextDecoder,Uint8Array,Blob});
    vm.runInContext(fs.readFileSync(process.argv[1],"utf8"),env);
    const turn=()=>new Promise(r=>setImmediate(r));
    function track(blob){return {size:blob.size,stream:()=>blob.stream(),slice:(a,b)=>{
      const c=blob.slice(a,b);return {size:c.size,stream:()=>c.stream(),arrayBuffer:async()=>{
        const buf=await c.arrayBuffer();if(buf.byteLength>3*1024*1024)refs.push(new WeakRef(buf));return buf;}};}};}
    (async()=>{
      const adapter=env.ReaderSourceFile.conversation("chat",null,()=>{});let result;
      for(let p=0;p<12;p++){const blob=new Blob([JSON.stringify({conversation_id:"chat",messages:[{
        id:"m"+p,create_time:p,author:{role:"assistant"},content:{content_type:"text",parts:["X".repeat(3*1024*1024)]}}],
        page_info:{has_previous_page:p!==11,start_cursor:"cursor-"+p}})]);
        result=await adapter.page({readerFile:async()=>track(blob)},p+1);}
      await turn();for(let i=0;i<4;i++){global.gc();await turn();}
      assert.equal(result.result.ids.size,12);
      const retained=refs.filter(r=>r.deref()).length;assert.equal(retained,0);
      console.log(JSON.stringify({pages:12,retainedLargeParserBuffers:retained}));
    })().catch(e=>{console.error(e);process.exitCode=1;});
  `,path.join(__dirname,"../reader/source-file.js")],{encoding:"utf8",timeout:60000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.equal(JSON.parse(result.stdout.trim()).retainedLargeParserBuffers,0);
});
