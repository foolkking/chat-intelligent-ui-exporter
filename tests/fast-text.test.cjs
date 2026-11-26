require('../scripts/i18n-env.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../extension/fast-text');
const message=(id,text,role='assistant')=>({id,author:{role},content:{content_type:'text',parts:[text]}});
function tree(count=3){const mapping={root:{parent:null,message:null,children:['m0']}};for(let i=0;i<count;i++)mapping['m'+i]={parent:i?'m'+(i-1):'root',children:i===count-1?[]:['m'+(i+1)],message:message('m'+i,`正文 ${i}`,i%2?'assistant':'user')};return {conversation_id:'chat',title:'标题',current_node:'m'+(count-1),mapping};}
function fetcher(routes,calls){return async(path,options)=>{calls.push({path,options});const value=routes(path);return {ok:value.status===undefined||value.status===200,status:value.status||200,json:async()=>value.body};};}
test('5000 messages are read with two requests, without DOM or scrolling',async()=>{
  const calls=[];const data=tree(5000);
  const result=await api.loadConversation({id:'chat',leafId:'m10',fetch:fetcher(path=>({body:path==='/api/auth/session'?{accessToken:'test'}:data}),calls)});
  assert.equal(result.messages.length,5000);assert.equal(calls.length,2);assert.equal(result.messages.at(-1).md,'正文 4999');
  assert.equal(calls[1].options.headers.Authorization,'Bearer test');assert.ok(!JSON.stringify(result).includes('Bearer'));
});
test('branch choice keeps selected alternative and never mixes regenerated answers',()=>{
 const data=tree();data.mapping.m1.children=['m2','alternative'];data.mapping.alternative={parent:'m1',children:[],message:message('alt-message','替代回答')};
 const result=api.parseTree(data,'alt-message');assert.deepEqual(result.messages.map(m=>m.id),['m0','m1','alt-message']);
 assert.equal(api.parseTree(data,'m1').branch,'m2');
 data.mapping.alternative.children=['x','y'];assert.throws(()=>api.parseTree(data,'alt-message'),/多个回答分支/);
});
test('text preserves Markdown, formulas, code and fallback, excluding hidden plumbing',()=>{
 const data=tree();data.mapping.m0.message.content.parts=['## 标题\n\n| a | b |\n| - | - |\n$\\alpha$'];data.mapping.m1.message.content={content_type:'code',text:'const s = "```";',language:'javascript'};
 data.mapping.m2.message.metadata={model_dil_v2:{fallbackMarkdown:'完整文字 fallback'}};
 const result=api.parseTree(data);const md=api.markdown(result,['m0','m1','m2'],'https://chatgpt.com/c/chat');
 assert.match(md,/\$\\alpha\$/);assert.match(md,/````javascript/);assert.match(md,/完整文字 fallback/);assert.doesNotMatch(md,/正文 2/);
 const hidden=message('hidden','secret');hidden.metadata={is_visually_hidden_from_conversation:true};assert.equal(api.records([hidden,message('a','ok')]).messages.length,1);
});
test('older pages prepend, overlap deduplicates, request failures never export partial history',async()=>{
 const calls=[];const routes=path=>path==='/api/auth/session'?{body:{accessToken:'test'}}:path==='/backend-api/conversation/chat'?{status:404}:path.includes('before=older')?{body:{messages:[message('a','first'),message('b','second')],page_info:{has_previous_page:false}}}:{body:{messages:[message('b','second'),message('c','third')],page_info:{has_previous_page:true,start_cursor:'older'}}};
 const result=await api.loadConversation({id:'chat',fetch:fetcher(routes,calls)});assert.deepEqual(result.messages.map(m=>m.id),['a','b','c']);assert.equal(result.pages,2);
 await assert.rejects(api.loadConversation({id:'chat',fetch:fetcher(path=>path.includes('before=older')?{status:429}:routes(path),[])}),/未生成不完整/);
 await assert.rejects(api.loadConversation({id:'chat',fetch:fetcher(path=>path.includes('before=older')?routes('/backend-api/conversations/chat'):routes(path),[])}),/读取历史消息时中断/);
});
test('missing parents, other conversation, invalid sessions and abort are explicit errors',async()=>{
 const data=tree();delete data.mapping.m1;assert.throws(()=>api.parseTree(data),/缺失父节点/);
 await assert.rejects(api.loadConversation({id:'chat',fetch:fetcher(()=>({body:{}}),[])}),/登录/);
 await assert.rejects(api.loadConversation({id:'chat',fetch:fetcher(path=>({body:path==='/api/auth/session'?{accessToken:'test'}:{...tree(),conversation_id:'other'}}),[])}),/不同对话/);
 const controller=new AbortController();controller.abort();await assert.rejects(api.loadConversation({id:'chat',signal:controller.signal,fetch:()=>assert.fail('request after abort')}),{name:'AbortError'});
});
test('image-only missing assets emit the fallback in both Markdown profiles, including whitespace-only text',()=>{
 const expected='> '+require('../extension/i18n.js').t('md.needsImages');
 for(const text of ['', ' \n\t'])for(const pointer of ['https://example.invalid/synthetic.png','unknown://synthetic',undefined]){
   const input=message('image',text,'user');
   input.content={content_type:'multimodal_text',parts:[text,{content_type:'image_asset_pointer',asset_pointer:pointer}]};
   const result=api.records([input]);
   assert.equal(result.messages.length,1);
   const row=result.messages[0];
   assert.equal(row.id,'image');assert.equal(row.md,expected);assert.equal(row.mdEscaped,expected);
   assert.equal(row.needsAssets,true);assert.deepEqual(row.images,[]);assert.equal(result.warnings.length,1);
 }
});
test('missing-media fallback never replaces real prose, escaped HTML, or a downloadable image',()=>{
 const input=message('image','<svg> is literal prose','assistant');
 input.content.parts.push({content_type:'image_asset_pointer',asset_pointer:'https://example.invalid/synthetic.png'});
 const row=api.records([input]).messages[0];
 assert.equal(row.md,'<svg> is literal prose');assert.equal(row.mdEscaped,'&lt;svg> is literal prose');
 assert.equal(row.needsAssets,true);
 input.content.parts=[{content_type:'image_asset_pointer',asset_pointer:'file-service://file-synthetic'}];
 const image=api.records([input]).messages[0];
 assert.match(image.md,/\]\(asset:file-synthetic\)/);assert.equal(image.mdEscaped,image.md);
 assert.equal(image.needsAssets,false);assert.equal(image.images[0].fileId,'file-synthetic');
});
test('empty non-asset messages and hidden or non-final plumbing still produce no visible rows',()=>{
 const hidden=message('hidden','','user');hidden.metadata={is_visually_hidden_from_conversation:true};
 hidden.content.parts=[{content_type:'image_asset_pointer',asset_pointer:'unknown://synthetic'}];
 const analysis={...hidden,id:'analysis',metadata:{},author:{role:'assistant'},channel:'analysis'};
 assert.deepEqual(api.records([message('empty',''),message('space',' \n\t'),hidden,analysis],{allowEmpty:true}),
   {messages:[],warnings:[]});
});
