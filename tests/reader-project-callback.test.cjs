const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const reader="https://reader.example.test",callback="https://"+"a".repeat(32)+".chromiumapp.org/reader-project";
const project="00000000-0000-4000-8000-0000000000ab",state="00000000-0000-4000-8000-0000000000cd";
test("only the registered Reader opens for project confirmation; state, project identity and exact callback must match",async()=>{
  const store={setAccessLevel:async()=>{},get:async()=>({}),remove:async()=>{},clear:async()=>{}};
  const launch=[],device={origin:reader,id:project,user:state,refresh:"synthetic-refresh-never-in-url"};
  let result;
  const w=vm.createContext({READER_ORIGIN:reader,TextEncoder,URL,URLSearchParams,navigator:{locks:{request:(_k,fn)=>fn()}},
    crypto:{randomUUID:()=>state},chrome:{storage:{local:store,session:store},identity:{
      launchWebAuthFlow:async o=>{launch.push(o);return result;},getRedirectURL:p=>{assert.equal(p,"reader-project");return callback;}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../reader/client.js"),"utf8"),w);await w.ReaderClient.trust;
  const fields=`#state=${state}&project=${project}`;
  result=callback+fields;assert.equal(await w.ReaderClient.confirmProject(device," 海洋 / &? "),project);
  const opened=new URL(launch[0].url);assert.equal(opened.origin+opened.pathname,reader+"/extension/import-project");
  assert.equal(opened.search,"");assert.equal(launch[0].interactive,true);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(opened.hash.slice(1))),{state,owner:state,device:project,name:" 海洋 / &? "});
  assert.ok(!launch[0].url.includes(device.refresh));
  for(result of [callback+"/extra"+fields,"https://elsewhere.example/reader-project"+fields,callback+fields.replace(state,project),callback+fields.replace("project="+project,"project=missing")])
    await assert.rejects(w.ReaderClient.confirmProject(device,"Synthetic"),/not received/);
});
