// Both production parsers consume identical in-memory synthetic page bytes. No browser or network.
const test=require("node:test"),assert=require("node:assert/strict");
const api=require("../extension/fast-text.js");require("../reader/source-file.js");
const msg=(id,text)=>({id,author:{role:"user"},create_time:1,content:{content_type:"text",parts:[text]},metadata:{
  request_id:"synthetic-request-a",attachments:[{id:"file-synthetic",name:"sample.csv",size:9}]}});
async function parse(pages,range){
  let i=0;const request=async route=>{
    if(route==="/api/auth/session")return {ok:true,json:async()=>({accessToken:"fixture-only"})};
    if(route.endsWith("/synthetic"))return {ok:false,status:404};
    const data=pages[i++];assert.ok(data);const bytes=Buffer.from(JSON.stringify(data));
    return {ok:true,json:async()=>JSON.parse(bytes),readerFile:async()=>new Blob([bytes])};
  };
  const r=await api.loadConversation({id:"synthetic",fetch:request,...(range?{readerSource:ReaderSourceFile.conversation("synthetic",null,()=>{})}:{})});
  return range?Array.fromAsync(r.rows()):r.messages;
}
function pair(older,newer){
  return [{messages:[msg("x","X"),newer,msg("z","Z")],page_info:{has_previous_page:true,start_cursor:"earlier"}},
    {messages:[msg("a","A"),older,msg("b","B")],page_info:{has_previous_page:false}}];
}
test("tied/missing timestamps retain the older page's first occurrence, not fetch order",async()=>{
  for(const time of [1,null]){
    const overlap=msg("y","潮汐 🪐"),pages=pair(overlap,structuredClone(overlap));
    for(const page of pages)for(const m of page.messages)m.create_time=time;
    const reference=await parse(pages,false);assert.deepEqual(reference.map(r=>r.id),["a","y","b","x","z"]);
    assert.deepEqual(await parse(pages,true),reference);
  }
});
test("overlap ignores object key order, a request label and touch timestamp only",async()=>{
  const older=msg("y","潮汐 🪐"),newer={...Object.fromEntries(Object.entries(older).reverse()),update_time:20,
    metadata:{attachments:structuredClone(older.metadata.attachments),request_id:"synthetic-request-b"}};
  const pages=pair(older,newer),reference=await parse(pages,false);
  assert.deepEqual(await parse(pages,true),reference);
  assert.ok(reference[1].md.includes("潮汐 🪐"));assert.equal(reference[1].attachments[0].name,"sample.csv");
});
test("both providers reject semantic, resource, identity-context and unknown metadata drift",async()=>{
  for(const edit of [m=>m.content.parts.push("edited"),m=>m.metadata.attachments[0].name="other.csv",
    m=>m.metadata.is_visually_hidden_from_conversation=true,m=>m.recipient="tool",m=>m.channel="analysis",
    m=>m.parent_id="other",m=>m.author.role="assistant",m=>m.create_time=2,m=>m.metadata.extra={changed:true},
    m=>m.metadata.model_dil_v2={fallbackMarkdown:"## Changed"},m=>m.content.parts.reverse()]){
    const a=msg("y","A");a.content.parts.push("B");const b=structuredClone(a);edit(b);
    for(const range of [false,true])await assert.rejects(parse(pair(a,b),range),e=>e.code==="SOURCE_PAGE_CHANGED");
  }
});
test("visible message without identity is rejected by both tree parsers, not silently skipped",async()=>{
  const a=msg("a","A"),broken=msg("b","B");delete broken.id;
  const data={current_node:"n1",mapping:{n0:{parent:null,children:["n1"],message:a},n1:{parent:"n0",children:[],message:broken}}};
  assert.throws(()=>api.parseTree(data));
  const stream=await ReaderSourceFile.conversation("synthetic",null,()=>{}).tree({readerFile:async()=>new Blob([JSON.stringify(data)])});
  await assert.rejects(Array.fromAsync(stream.rows()));
});
test("a wrapped overlap must also agree on its declared parent",async()=>{
  const m=msg("y","same");for(const range of [false,true])await assert.rejects(parse(pair(
    {parent_id:"first",message:m},{parent_id:"second",message:m}),range),e=>e.code==="SOURCE_PAGE_CHANGED");
});
test("three overlapping history pages preserve 301 complete synthetic turns, static DIL and ordered resource references",async()=>{
  const messages=Array.from({length:602},(_,i)=>{
    const m=msg("m"+i,"Synthetic "+i+" 潮汐");m.author.role=i%2?"assistant":"user";
    if(i!==398)delete m.metadata.attachments;
    if(i===399){m.metadata.model_dil_v2={fallbackMarkdown:"## Results\n\n### By region\n\nSynthetic result",code:"not a chapter"};
      m.content.parts.push({content_type:"image_asset_pointer",asset_pointer:"file-service://file-synthetic-image"});}
    return m;
  });
  const pages=[[400,602],[200,401],[0,201]].map(([a,b],i)=>({messages:messages.slice(a,b).map(m=>({message:m})),
    page_info:{has_previous_page:i<2,start_cursor:"page-"+i}}));
  const reference=await parse(pages,false),stream=await parse(pages,true);
  assert.deepEqual(stream,reference);assert.deepEqual(stream.map(r=>r.id),messages.map(r=>r.id));
  assert.equal(stream[398].attachments[0].name,"sample.csv");assert.equal(stream[399].images[0].fileId,"file-synthetic-image");
  assert.equal(stream[399].dil.fallbackMarkdown,messages[399].metadata.model_dil_v2.fallbackMarkdown);
});
test("the stream accepts an exact UTF-8 BOM but not an isolated or permuted BOM byte",async()=>{
  for(const p of [[239],[187],[239,191,187],[32,239,187,191]])await assert.rejects(
    ReaderSourceFile.header(new Blob([Uint8Array.from(p),'{"title":"x"}']),()=>{}));
  assert.equal((await ReaderSourceFile.header(new Blob([Uint8Array.from([239,187,191]),'{"title":"x"}']),()=>{})).title,"x");
});
test("a displayed message alias repeated on two branches does not select whichever node was indexed last",async()=>{
  const m=msg("repeated","A"),data={current_node:"n1",mapping:{
    root:{parent:null,children:["n1","n2"]},n1:{parent:"root",children:[],message:m},n2:{parent:"root",children:[],message:{...m,channel:"commentary"}}}};
  await assert.rejects(ReaderSourceFile.conversation("synthetic","repeated",()=>{}).tree({readerFile:async()=>new Blob([JSON.stringify(data)])}),
    e=>e.code==="SOURCE_BRANCH_UNVERIFIED");
});
