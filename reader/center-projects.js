// One source group's destination. Draft names never enter the import plan.
globalThis.ReaderProjectRow = function({id,label,name,sample,projects,value,draft,webCreate,L,selectValue,edit,cancel,submit}){
  const node=(tag,copy,cls)=>{
    const element=document.createElement(tag);
    if(copy)element.textContent=copy;
    if(cls)element.className=cls;
    return element;
  };
  const button=(copy,click)=>{const b=node("button",copy);b.type="button";b.onclick=click;return b;};
  const line=node("div",null,"mapping-row"),from=node("div"),title=node("label",label);
  title.htmlFor=id;from.append(title);
  if(sample)from.append(node("small",L(`含「${sample}」`,`Includes “${sample}”`),"meta"));
  line.setAttribute("role","group");line.setAttribute("aria-label",label);
  const to=node("div",null,"mapping-target"),select=node("select");select.id=id;
  const same=name&&projects.find(p=>p.name===name);
  select.add(new Option(L("Reader · 未分类","Reader · Unclassified"),""));
  const add=p=>select.add(new Option("Reader · "+(p.label||p.name)+(p===same?L("（同名）"," (same name)"):""),p.id));
  if(same)add(same);
  for(const p of projects)if(p!==same)add(p);
  const available=!value||projects.some(p=>p.id===value);
  if(!available){
    const option=new Option(L("项目不可用，请重新选择","Project unavailable — choose again"),"unavailable");
    option.disabled=true;select.add(option);
  }
  select.value=available?value:"unavailable";
  select.onchange=()=>selectValue(select.value);
  to.append(select);line.dataset.ready=String(available&&!draft);
  if(!draft){
    if(same&&value!==same.id)to.append(button(L("选用同名项目","Use same-name project"),()=>selectValue(same.id)));
    if(!same)to.append(button(name?L("新建同名项目…","Create same-name project…"):L("新建 Reader 项目…","Create Reader project…"),edit));
  }else{
    const form=node("form",null,"mapping-editor"),field=node("input"),fieldLabel=node("label",L("Reader 项目名称","Reader project name"));
    form.setAttribute("aria-busy",String(!!draft.busy));
    field.type="text";field.autocomplete="off";field.id=id+"-name";field.value=draft.name;fieldLabel.htmlFor=field.id;
    field.placeholder=L("输入项目名称","Enter project name");
    const action=node("button"),dismiss=button(L("取消","Cancel"),cancel),status=node("p",null,"meta");
    action.type="submit";status.setAttribute("role","status");
    function update(){
      const wanted=field.value.trim(),valid=wanted&&Array.from(wanted).length<=120;
      const exists=projects.some(p=>p.name===wanted);
      field.disabled=!!draft.busy;
      action.disabled=!!draft.busy||!valid;
      action.textContent=exists?L("选用已有项目","Use existing project"):
        draft.legacy?L("刷新项目","Refresh projects"):webCreate?L("在 Reader 确认","Confirm in Reader"):L("打开 Reader 新建","Open Reader to create");
      status.textContent=draft.busy?L("正在等待 Reader 确认…","Waiting for Reader confirmation…"):
        wanted&&!valid?L("项目名称最多 120 个字符。","Use a project name of up to 120 characters."):draft.note||"";
      status.hidden=!status.textContent;
    }
    field.oninput=()=>{draft.name=field.value;draft.note="";draft.legacy=false;draft.result=null;update();};
    form.onsubmit=event=>{event.preventDefault();if(!action.disabled)return submit();};
    const actions=node("div",null,"mapping-actions");actions.append(action,dismiss);
    update();form.append(fieldLabel,field,actions,status);to.append(form);
  }
  const arrow=node("span","→");arrow.setAttribute("aria-hidden","true");line.append(from,arrow,to);return line;
};
