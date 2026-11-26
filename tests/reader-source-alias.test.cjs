// Selected-branch identity proof only. Synthetic source/DOM, no live account or network.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("jsdom");
globalThis.FastTextExporter=require("../extension/fast-text.js");
require("../reader/source-file.js");
function source(){
  const message=(id,role,text)=>({id,author:{role},content:{content_type:"text",parts:[text]}});
  return {conversation_id:"synthetic-alias",title:"Synthetic aliases",current_node:"node-answer",mapping:{
    root:{parent:null,children:["node-user"],message:null},
    "node-user":{parent:"root",children:["node-hidden"],message:message("message-user","user","潮汐 🪐")},
    "node-hidden":{parent:"node-user",children:["node-answer","node-alternative"],message:message("message-hidden","system","Hidden plumbing")},
    "node-answer":{parent:"node-hidden",children:[],message:message("message-answer","assistant","Current answer")},
    "node-alternative":{parent:"node-hidden",children:[],message:message("message-alternative","assistant","Alternative answer")}
  }};
}
async function parse(input,leaf){
  const file=new Blob([JSON.stringify(input)]),head=await ReaderSourceFile.header(file,()=>{});
  return ReaderSourceFile.tree(file,head,leaf,()=>{},()=>{});
}
test("identities add selected tree-node aliases without broadening raw message ids or serialised source paths",async()=>{
  for(const leaf of [undefined,"node-user","message-user"]){
    const result=await parse(source(),leaf),rows=[];
    for await(const row of result.rows())rows.push(row);
    assert.deepEqual(result.ids,new Set(["message-user","message-hidden","message-answer"]));
    assert.deepEqual(result.identities,new Set(["root","node-user","node-hidden","node-answer",
      "message-user","message-hidden","message-answer"]));
    assert.deepEqual(rows.map(row=>[row.id,row.sourcePath]),[
      ["message-user",["root","node-user"]],["message-answer",["node-hidden","node-answer"]]
    ]);
    assert.equal((await result.row("message-answer")).md,"Current answer");
    assert.equal(await result.row("node-answer"),null,"row lookup remains message-ID-only");
    assert.equal(result.identities.has("node-alternative"),false);
    assert.equal(result.identities.has("message-alternative"),false);
  }
});
test("alternate branch identities exclude current-node siblings and never union all mapping nodes",async()=>{
  const result=await parse(source(),"message-alternative");
  assert.equal(result.branch,"node-alternative");
  assert.deepEqual(result.ids,new Set(["message-user","message-hidden","message-alternative"]));
  assert.deepEqual(result.identities,new Set(["root","node-user","node-hidden","node-alternative",
    "message-user","message-hidden","message-alternative"]));
});
test("actual shared adapter verifies node aliases and resolves them to canonical message IDs only after remember",async()=>{
  const data=await parse(source());
  const dom=new JSDOM('<main><div data-message-id="node-user" data-message-author-role="user">Question</div>'+
    '<div data-message-id="node-answer" data-message-author-role="assistant">Answer</div></main>',
    {url:"https://chatgpt.com/c/synthetic-alias",runScripts:"outside-only"});
  try{
    dom.window.Element.prototype.checkVisibility=()=>true;
    dom.window.eval(fs.readFileSync(path.join(__dirname,"../extension/source-dom.js"),"utf8"));
    const adapter=dom.window.ChatExportSourceDOM;
    assert.equal(adapter.verify(data),true);
    assert.deepEqual(Array.from(adapter.mounted(),el=>adapter.idOf(el)),["node-user","node-answer"]);
    for await(const row of data.rows())adapter.remember(row);
    assert.deepEqual(Array.from(adapter.mounted(),el=>adapter.idOf(el)),["message-user","message-answer"]);
    assert.equal(adapter.outsideBranch(),"");
    const answer=dom.window.document.querySelector('[data-message-id="node-answer"]');
    for(const other of ["node-alternative","message-alternative","unknown"]){
      answer.setAttribute("data-message-id",other);
      assert.equal(adapter.verify(data),false);
      assert.notEqual(adapter.outsideBranch(),"");
    }
  }finally{dom.window.close();}
});
test("adding aliases does not relax duplicate IDs, invalid keys, missing ancestors or branch-cycle rejection",async()=>{
  const cases=[
    d=>{d.mapping["node-answer"].message.id="message-user";},
    d=>{d.mapping["node-answer"].parent="absent";},
    d=>{d.mapping.root.parent="node-answer";},
    d=>{d.mapping["bad/key"]={parent:null,children:[],message:null};}
  ];
  for(const change of cases){const data=source();change(data);await assert.rejects(()=>parse(data));}
  await assert.rejects(()=>parse(source(),"unknown-visible-node"),/branch/);
});
function chunkedFile(text,width){
  const wrap=blob=>({size:blob.size,arrayBuffer:()=>blob.arrayBuffer(),slice:(a,b)=>wrap(blob.slice(a,b)),
    stream(){let at=0;return new ReadableStream({async pull(out){
      if(at===blob.size)return out.close();
      const end=Math.min(blob.size,at+width);out.enqueue(new Uint8Array(await blob.slice(at,end).arrayBuffer()));at=end;
    }});}});
  return wrap(new Blob([text]));
}
test("byte-range indexing retains original parser rows across UTF-8, escaped delimiters, BOM and one-byte streams",async()=>{
  for(const width of [1,2,3,7,65536])for(const pretty of [false,true]){
    const data=source();
    data.title="Unicode 潮汐 🪐";
    data.mapping["node-user"].message.content.parts=['潮汐 🪐 \\\" } ],\n literal \\u0000'];
    data.ignored={nested:[null,true,false,0,-1.25e-10,{key:'\\" }, [ 🪐'}]};
    const file=chunkedFile("\ufeff \n"+JSON.stringify(data,null,pretty?2:undefined)+"\r\n",width);
    const head=await ReaderSourceFile.header(file,()=>{});
    for(const leaf of ["message-user","node-alternative"]){
      const result=await ReaderSourceFile.tree(file,head,leaf,()=>{},()=>{}),rows=[];
      for await(const row of result.rows())rows.push(row);
      const original=FastTextExporter.parseTree(data,leaf,{sourcePaths:true});
      assert.equal(result.branch,original.branch);assert.equal(result.title,original.title);
      assert.deepEqual(rows,original.messages);
      for(const row of rows)assert.equal((await result.row(row.id)).md,row.md);
    }
  }
});
test("flat and wrapped pagination keep overlap ordering, byte slices and changed-page rejection unchanged",async()=>{
  const row=(id,text,time)=>({id,create_time:time,author:{role:"assistant"},content:{content_type:"text",parts:[text]}});
  for(const timed of [true,false])for(const wrapped of [true,false]){
    const first=row("a","first 潮汐",timed?1:undefined),overlap=row("b",'middle \\" }',timed?2:undefined),last=row("c","last 🪐",timed?3:undefined);
    const adapt=m=>wrapped?{message:m}:m;
    const pages=[
      {messages:[overlap,last].map(adapt),page_info:{has_previous_page:true,start_cursor:"older"}},
      {messages:[first,overlap].map(adapt),page_info:{has_previous_page:false}}
    ].map(p=>({...p,conversation_id:"synthetic-alias",title:"Synthetic pages"}));
    const response=data=>({ok:true,status:200,json:async()=>data,readerFile:async()=>chunkedFile(JSON.stringify(data,null,2),3)});
    const request=async route=>{
      if(route==="/api/auth/session")return response({accessToken:"synthetic-only"});
      if(route==="/backend-api/conversation/synthetic-alias")return {ok:false,status:404};
      return response(pages[route.includes("before=")?1:0]);
    };
    const original=await FastTextExporter.loadConversation({id:"synthetic-alias",fetch:request});
    const result=await FastTextExporter.loadConversation({id:"synthetic-alias",fetch:request,
      readerSource:ReaderSourceFile.conversation("synthetic-alias",undefined,()=>{})}),rows=[];
    for await(const entry of result.rows())rows.push(entry);
    assert.deepEqual(rows,original.messages);assert.deepEqual(rows.map(m=>m.id),["a","b","c"]);
    assert.deepEqual(result.ids,new Set(["a","b","c"]));
    assert.equal((await result.row("a")).md,first.content.parts[0]);
    const changed=ReaderSourceFile.conversation("synthetic-alias",undefined,()=>{});
    await changed.page(response(pages[0]),1);
    const copy=structuredClone(pages[1]),duplicate=wrapped?copy.messages[1].message:copy.messages[1];
    duplicate.content.parts=["changed"];
    await assert.rejects(()=>changed.page(response(copy),2),/changed between pages/);
  }
});
test("wrong conversation IDs and unsupported 200 response envelopes do not silently downgrade to partial history",async()=>{
  for(const payload of [{...source(),conversation_id:"other"}, {data:source()}, {messages:[],page_info:{has_previous_page:false}}]){
    let calls=0;
    const request=async route=>{
      calls++;
      if(route==="/api/auth/session")return {ok:true,json:async()=>({accessToken:"synthetic-only"})};
      return {ok:true,status:200,readerFile:async()=>new Blob([JSON.stringify(payload)])};
    };
    await assert.rejects(()=>FastTextExporter.loadConversation({id:"synthetic-alias",fetch:request,
      readerSource:ReaderSourceFile.conversation("synthetic-alias",undefined,()=>{})}));
    assert.equal(calls,2,"do not reinterpret an unrecognized successful response by trying another endpoint");
  }
});
