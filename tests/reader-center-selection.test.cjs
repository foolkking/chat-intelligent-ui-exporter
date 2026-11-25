const test=require("node:test"),assert=require("node:assert/strict");
require("../reader/center-selection.js");
const {create,PAGE_SIZE}=globalThis.ReaderCenterSelection;
const digest="a".repeat(64);
const makeRows=(n=150)=>Array.from({length:n},(_,i)=>({
  id:"id-"+i,title:"Synthetic "+String(i).padStart(3,"0"),group:"project:p"+Math.floor(i/50)
}));
const archive=(rows=makeRows(),patch={})=>({kind:"archive",scope:digest,digest,complete:true,rows,...patch});
const ids=view=>view.rows.map(r=>r.id);

test("fixed pages cover every row exactly once without accumulated DOM ranges or a result cap",()=>{
  const model=create({source:archive(makeRows(10003))}),all=[];
  assert.equal(PAGE_SIZE,50);assert.equal(model.view().pages,201);
  for(let page=0;page<201;page++){
    const result=model.view({page});assert.ok(result.rows.length<=50);all.push(...ids(result));
    assert.equal(result.page,page);assert.equal(result.from,page*50+1);
  }
  assert.equal(new Set(all).size,10003);assert.equal(all.at(-1),"id-10002");
  assert.equal(model.view({page:100000}).page,200);
  assert.equal(model.view({page:NaN}).page,0);
  assert.equal(model.view({page:-1}).page,0);
  assert.equal(model.view({page:1.5}).page,0);
});
test("empty and filtered pages expose truthful ranges, not fake totals",()=>{
  const model=create({source:archive([])});
  assert.deepEqual({...model.view(),rows:undefined},{rows:undefined,page:0,pageSize:50,pages:0,total:0,from:0,to:0,
    hasPrevious:false,hasNext:false,selectedCount:0,selectedInFilter:0,hiddenSelected:0,pageSelected:0});
  assert.equal(model.project("project:missing").reason,"empty-project");
  assert.equal(model.snapshot("filtered").count,0);
});
test("page selection chooses 50; filtered selection chooses the actual 150-id snapshot",()=>{
  const chosen=new Set(),model=create({source:archive(),chosen});
  const page=model.snapshot("page",{page:1});assert.equal(page.count,50);
  model.apply(page);assert.equal(chosen.size,50);assert.ok(chosen.has("id-50"));assert.ok(!chosen.has("id-0"));
  const filtered=model.snapshot("filtered");assert.equal(filtered.count,150);
  model.apply(filtered);assert.equal(chosen.size,150);
  model.apply(filtered);assert.equal(chosen.size,150,"Repeated confirmation is idempotent.");
  model.apply(page,{selected:false});assert.equal(chosen.size,100);
});
test("cross-page/project filters retain the same Set; selected list removes hidden selections",()=>{
  const chosen=new Set(),model=create({source:archive(),chosen,groupName:g=>g==="project:p0"?"潮汐":"Other"});
  model.set("id-1");model.set("id-80");model.set("id-149");
  const page=model.view({group:"project:p1",query:"080"});
  assert.equal(page.selectedCount,3);assert.equal(page.hiddenSelected,2);assert.equal(page.pageSelected,1);
  assert.deepEqual(ids(model.selected()),["id-1","id-80","id-149"]);
  model.remove("id-1");assert.deepEqual([...chosen],["id-80","id-149"]);
  assert.equal(model.summary().selectedGroupCount,2);
  const group=model.summary().groups.find(g=>g.id==="project:p1");
  assert.equal(group.knownCount,50);assert.equal(group.selectedCount,1);
  assert.equal(model.clear().selectedCount,0);assert.equal(chosen.size,0);
});
test("selected list itself is fixed-page and adjusts after removing the final page",()=>{
  const model=create({source:archive(makeRows(101))});
  model.apply(model.snapshot("filtered"));assert.equal(model.selected().rows.length,50);
  assert.equal(model.selected({page:2}).rows.length,1);
  model.remove("id-100");assert.equal(model.selected({page:2}).page,1);
  assert.equal(model.selected({page:2}).rows.length,50);
});
test("title search supports Chinese and identifiers without reading body, filename or project names",()=>{
  const rows=[{id:"a",group:"project:p",title:"实验潮汐分析"},
    {id:"b",group:"project:p",title:"Parser loadBody_v2"},
    {id:"c",group:"unknown",title:"No match",body:"潮汐",filename:"潮汐.csv"}];
  const model=create({source:archive(rows),groupName:()=>"潮汐项目"});
  assert.deepEqual(ids(model.view({query:" 潮汐 "})),["a"]);
  assert.deepEqual(ids(model.view({query:"LOADbody_v2"})),["b"]);
  assert.deepEqual(ids(model.view({query:"潮汐项目"})),[]);
});
test("known metadata remains known; unknown attachment/time data is not invented as zero",()=>{
  const model=create({source:archive([{id:"a",title:"A",group:"unknown"},
    {id:"b",title:"B",group:"unclassified",update_time:1700000000,attachmentCount:2}])});
  const [a,b]=model.view().rows;
  assert.ok(!Object.hasOwn(a,"attachmentCount"));assert.ok(!Object.hasOwn(a,"update_time"));
  assert.equal(b.attachmentCount,2);assert.equal(b.update_time,1700000000);
});
test("local whole-project selection requires digest-bound completion and ignores only the title filter",()=>{
  const model=create({source:archive()});
  assert.deepEqual(model.project("project:p1"),{allowed:true,reason:null,count:50,scope:"local-export-project"});
  const fixed=model.snapshot("project",{group:"project:p1",query:"NOT FOUND"});
  assert.equal(fixed.count,50);assert.equal(fixed.ids[0],"id-50");assert.equal(fixed.groups.length,1);
  model.apply(fixed);assert.equal(model.summary().selectedCount,50);
});
test("web sources can never claim whole-project even with fabricated complete/digest flags",()=>{
  for(const patch of [{},{complete:true},{complete:true,digest,scope:digest}]){
    const model=create({source:{kind:"web",rows:makeRows(),...patch}});
    assert.equal(model.project("project:p0").reason,"web-partial");
    assert.throws(()=>model.snapshot("project",{group:"project:p0"}),/selection-web-partial/);
    model.apply(model.snapshot("filtered",{group:"project:p0"}));
    assert.equal(model.summary().selectedCount,50,"Discovered rows remain selectable, not blocked as a whole.");
  }
});
test("incomplete, unknown-membership, unclassified and digest-mismatched archives reject whole-project",()=>{
  for(const patch of [{complete:false},{complete:undefined},{scope:"other"},{digest:"not-a-digest"}]){
    const model=create({source:archive(makeRows(),patch)});
    assert.equal(model.project("project:p0").allowed,false);
    assert.throws(()=>model.snapshot("project",{group:"project:p0"}),/selection-archive-unproven/);
  }
  const unknown=create({source:archive([...makeRows(),{id:"unknown-one",title:"Unknown",group:"unknown"}])});
  assert.equal(unknown.project("project:p0").reason,"membership-unknown");
  for(const group of ["unknown","unclassified","","__proto__"]){
    assert.equal(unknown.project(group).allowed,false);
    assert.throws(()=>unknown.snapshot("project",{group}),/selection-not-project/);
  }
});
test("frozen range is immutable, belongs to this model and does not adopt later source additions",()=>{
  const source=archive(),chosen=new Set(),model=create({source,chosen});
  const fixed=model.snapshot("filtered",{group:"project:p0"});
  assert.ok(Object.isFrozen(fixed));assert.ok(Object.isFrozen(fixed.ids));assert.ok(Object.isFrozen(fixed.groups));
  assert.throws(()=>fixed.ids.push("extra"));
  source.rows.push({id:"late",title:"Late entry",group:"project:p0"});
  model.apply(fixed);assert.equal(chosen.size,50);assert.ok(!chosen.has("late"));
  assert.throws(()=>model.apply({...fixed,ids:["late"]}),/selection-stale/);
  const other=create({source});assert.throws(()=>other.apply(fixed),/selection-stale/);
});
test("a changed catalogue cannot mint a new whole-project claim, while old fixed selections stay frozen",()=>{
  const source=archive(),model=create({source}),fixed=model.snapshot("project",{group:"project:p0"});
  source.rows.push({id:"late",title:"Late membership",group:"unknown"});
  assert.equal(model.project("project:p0").reason,"source-changed");
  assert.throws(()=>model.snapshot("project",{group:"project:p0"}),/selection-source-changed/);
  model.apply(fixed);assert.equal(model.summary().selectedCount,50);
  assert.ok(!ids(model.selected()).includes("late"));
});
test("changed identity or missing/reassigned IDs fail atomically before shared choices change",()=>{
  for(const mutate of [
    s=>{s.scope="changed";},s=>{s.kind="web";},s=>{s.complete=false;},
    s=>{s.rows.splice(10,1);},s=>{s.rows[10].group="project:different";},
    s=>{s.rows.push({...s.rows[10]});}
  ]){
    const source=archive(),chosen=new Set(["id-149"]),model=create({source,chosen});
    const fixed=model.snapshot("filtered",{group:"project:p0"});mutate(source);
    assert.throws(()=>model.apply(fixed),/selection-stale/);
    assert.deepEqual([...chosen],["id-149"]);
  }
});
test("source replacement clears old selection and invalidates old confirmation even for identical IDs",()=>{
  const chosen=new Set(["id-1"]),model=create({source:archive(),chosen});
  const fixed=model.snapshot("page");model.replaceSource(archive(makeRows(),{digest:"b".repeat(64),scope:"b".repeat(64)}));
  assert.equal(chosen.size,0);assert.throws(()=>model.apply(fixed),/selection-stale/);
  assert.equal(model.view().selectedCount,0);
  const second=model.snapshot("page");model.apply(second);assert.equal(chosen.size,50);
});
test("duplicate/invalid IDs are rejected without destroying prior source or selection",()=>{
  const chosen=new Set(["id-1"]),model=create({source:archive(),chosen});
  assert.throws(()=>model.replaceSource(archive([{id:"x",group:"unknown"},{id:"x",group:"unclassified"}])),/selection-source/);
  assert.deepEqual([...chosen],["id-1"]);assert.equal(model.view().total,150);
  for(const id of ["../bad","",null,3])assert.throws(()=>create({source:archive([{id,group:"unknown"}])}),/selection-source/);
  assert.throws(()=>model.set("not-there"),/selection-unknown-id/);
});
test("same-name projects remain independent; unknown membership is not unclassified",()=>{
  const rows=[{id:"a",title:"Same",group:"project:a"},{id:"b",title:"Same",group:"project:b"},
    {id:"c",title:"Same",group:"unknown"},{id:"d",title:"Same",group:"unclassified"}];
  const model=create({source:archive(rows),groupName:()=>"Same project"});
  model.apply(model.snapshot("filtered",{group:"project:a"}));
  assert.deepEqual(ids(model.selected()),["a"]);assert.equal(model.summary().groups.length,4);
  assert.deepEqual(ids(model.view({group:"unknown"})),["c"]);
  assert.deepEqual(ids(model.view({group:"unclassified"})),["d"]);
});
test("already-discovered long project identifiers are not silently truncated or capped",()=>{
  const group="project:g-p-"+"a".repeat(175),model=create({source:{kind:"web",rows:[{id:"one",title:"One",group}]}});
  assert.equal(model.summary().groups[0].id,group);
  model.apply(model.snapshot("filtered",{group}));assert.equal(model.summary().selectedCount,1);
  assert.equal(model.project(group).reason,"web-partial");
});
test("selection reconciles external Set changes and never retains bodies or source credentials",()=>{
  const row={id:"a",title:"<img src=x onerror=alert(1)>",group:"project:p"};
  Object.defineProperty(row,"body",{get(){throw Error("must not read a body");}});
  Object.defineProperty(row,"mapping",{get(){throw Error("must not retain raw mapping");}});
  const chosen=new Set(["a","stale"]),model=create({source:archive([row]),chosen});
  assert.deepEqual([...chosen],["a"]);
  chosen.clear();assert.equal(model.summary().selectedCount,0);
  chosen.add("a");assert.equal(model.view().pageSelected,1);
  assert.equal(model.view().rows[0].title,row.title,"Renderer must use textContent; model does not turn source text into markup.");
  assert.ok(!Object.hasOwn(model.view().rows[0],"body"));
  assert.ok(!Object.hasOwn(model.view().rows[0],"mapping"));
});
