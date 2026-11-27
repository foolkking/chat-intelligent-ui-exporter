// Shared, read-only ChatGPT DOM adapter. Never derive a branch end from the last
// mounted message: virtual history is only a hint for the API's verified path.
globalThis.ChatExportSourceDOM = (() => {
  const identitySelector = "[data-message-id],[data-chatgpt-search-message-ids]";
  const legacyRoleSelector = '[data-message-author-role="user"],[data-message-author-role="assistant"]';
  const roleSelector = legacyRoleSelector + ',[data-conversation-role="user"],[data-conversation-role="assistant"]';
  const valid = value => typeof value === "string" && /^[\w-]{1,128}$/.test(value);
  const timelineSelector="[data-app-action-timeline-scroll]",conversationSelector="[data-thread-find-target=conversation],[data-chatgpt-conversation-selection-target]";
  const unitSelector="[data-chatgpt-search-unit-key],[data-content-search-unit-key]";
  let route = "", branch = null, known = new Map(), identityVersion=0,turnKeys=new Map();
  function resetRoute() {
    if (route !== location.pathname) { route = location.pathname; branch = null; known.clear();turnKeys.clear(); identityVersion++; }
  }
  function visible(el) {
    if (!el?.isConnected || el.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    for (let n = el; n; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" ||
          style.contentVisibility === "hidden" || style.opacity === "0") return false;
    }
    // checkVisibility also covers non-rendered ancestors. Layout-less fixtures
    // must supply their own geometry; this fallback does not certify a jump.
    return el.checkVisibility ? el.checkVisibility({visibilityProperty:true,opacityProperty:true}) : true;
  }
  const all = selector => [...document.querySelectorAll(selector)].filter(visible);
  function scopeInfo(){
    const regions=[...document.querySelectorAll(timelineSelector)],chat=/\/c\/([\w-]+)\/?$/.exec(location.pathname)?.[1];
    const roots=regions.length?regions.filter(el=>el.getAttribute("role")!=="presentation"&&visible(el)):[document];
    const possible=[];
    for(const root of roots){
      const markers=[...root.querySelectorAll(conversationSelector)].filter(n=>visible(n)&&!n.closest('[role=presentation][data-app-action-timeline-scroll]'));
      const explicit=markers.filter(n=>n.hasAttribute("data-chatgpt-conversation-selection-target"));
      const matches=explicit.length?explicit.filter(n=>n.getAttribute("data-chatgpt-conversation-selection-target")===chat):markers;
      const outer=matches.filter(n=>!matches.some(other=>n!==other&&other.contains(n)));
      if(!markers.length||outer.length===1)possible.push({root,scope:outer[0]||root,matched:!!explicit.length});
    }
    const named=possible.filter(p=>p.matched),result=named.length?named:possible;
    return result.length===1?result[0]:null;
  }
  const timeline=()=>scopeInfo()?.root||null;
  function allowedNode(n){
    if(n.closest('[data-app-action-timeline-scroll][role=presentation],[role=dialog]'))return false;
    const owner=n.closest("[data-chatgpt-conversation-selection-target]");
    return !owner||owner.getAttribute("data-chatgpt-conversation-selection-target")===/\/c\/([\w-]+)\/?$/.exec(location.pathname)?.[1];
  }
  function transcript(selector,info=scopeInfo()){
    if(!info)return [];
    return [...info.scope.querySelectorAll(selector)].filter(n=>allowedNode(n)&&visible(n));
  }
  function ownIDs(el) {
    const legacy = el?.getAttribute("data-message-id");
    if (valid(legacy)) return [legacy];
    return [...new Set((el?.getAttribute("data-chatgpt-search-message-ids") || "")
      .trim().split(/\s+/).filter(valid))];
  }
  function candidates(el) {
    const own = ownIDs(el); if (own.length) return own;
    const parent = el?.parentElement?.closest(identitySelector);
    if (parent && visible(parent)) return ownIDs(parent);
    return el?.matches(roleSelector) ? [...new Set([...el.querySelectorAll(identitySelector)].filter(visible).flatMap(ownIDs))] : [];
  }
  function rawRole(el) {
    if (!el) return undefined;
    const owner=el.closest(identitySelector),roles=new Set();
    // New role markers are screen-reader labels, not message bodies. Read
    // their explicit attribute, never their text or turn/token position.
    for (const node of [el,...el.querySelectorAll(roleSelector)]) {
      if (!visible(node) || (node!==el && owner && node.closest(identitySelector)!==owner)) continue;
      for (const attr of ["data-message-author-role","data-conversation-role"]) {
        const role=node.getAttribute(attr);if (role) roles.add(role);
      }
    }
    const unit=el.closest(unitSelector);
    if(unit&&(!owner||unit===owner||owner.contains(unit)||unit.contains(owner))){
      for(const key of ["data-chatgpt-search-unit-key","data-content-search-unit-key"]){
        const role=/:((?:user|assistant))$/.exec(unit.getAttribute(key)||"")?.[1];if(role)roles.add(role);
      }
    }
    return roles.size>1 ? "conflict" : [...roles][0];
  }
  const records = id => known.get(id) || [];
  function roleOf(el) {
    const role = rawRole(el); if (role) return ["user","assistant"].includes(role) ? role : undefined;
    const roles = [...new Set(candidates(el).flatMap(records).map(row => row.role))];
    return roles.length === 1 ? roles[0] : undefined;
  }
  function idOf(el) {
    resetRoute();
    const ids = candidates(el), role = rawRole(el);
    if (role && !["user","assistant"].includes(role)) return undefined;
    const matched = [...new Set(ids.flatMap(records).filter(row => !role || row.role === role).map(row => row.id))];
    if (matched.length === 1) return matched[0];
    if (ids.some(id => known.has(id))) return undefined;
    // One explicit identity is safe before metadata arrives. Multiple tokens
    // are NOT assigned to roles by DOM position or by "last means assistant".
    return ids.length === 1 ? ids[0] : undefined;
  }
  function messageNodes(info=scopeInfo()) {
    const roles = transcript(roleSelector,info).map(el =>
      el.hasAttribute("data-conversation-role") && !el.matches(legacyRoleSelector)
        ? el.closest(identitySelector) || el : el).filter(el => candidates(el).length);
    const bare = transcript(identitySelector,info).filter(el => !el.matches(legacyRoleSelector) &&
      !el.querySelector(legacyRoleSelector) && !el.closest(legacyRoleSelector));
    return [...new Set([...roles, ...bare])].sort((a,b) =>
      a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }
  function mounted() {
    const rows = messageNodes().filter(el => idOf(el) && ["user","assistant"].includes(roleOf(el)));
    const nodes = new Set(rows);
    // A nested role wrapper inheriting the same identity is not a second
    // message. Separate sibling copies remain ambiguous to the jump verifier.
    const unique=rows.filter(el => {
      for (let p=el.parentElement;p;p=p.parentElement)
        if (nodes.has(p) && idOf(p) === idOf(el) && roleOf(p) === roleOf(el)) return false;
      return true;
    });
    if(branch)for(const el of unique){
      const id=idOf(el),key=el.closest("[data-turn-key]")?.getAttribute("data-turn-key");
      if(typeof key==="string"&&key.length>0&&key.length<=256&&!/[\u0000-\u001f]/.test(key)&&!/^fallback-turn-/i.test(key)&&branch.has(id)){
        if(!turnKeys.has(id))turnKeys.set(id,key);else if(turnKeys.get(id)!==key)turnKeys.set(id,null);
      }
    }
    return unique;
  }
  function remember(row) {
    resetRoute();
    if (!valid(row?.id) || !["user","assistant"].includes(row.role)) return;
    const record = {id:row.id, role:row.role};
    for (const id of new Set([row.id,row.sourcePath?.at(-1)].filter(valid))) {
      const owners = records(id);
      if (!owners.some(owner => owner.id === row.id && owner.role === row.role)){known.set(id,[...owners,record]);identityVersion++;}
    }
  }
  function identities() {
    // The explicit per-message legacy ID wins for resolution, but must not
    // conceal other explicit identities from branch validation.
    return [...new Set(transcript(identitySelector).flatMap(el => [
      el.getAttribute("data-message-id"), ...(el.getAttribute("data-chatgpt-search-message-ids") || "").trim().split(/\s+/)
    ]).filter(valid))];
  }
  function conflictingRoles(){
    return messageNodes().some(el=>{const role=rawRole(el);if(!role)return false;
      const owners=candidates(el).flatMap(records);
      return role==="conflict"||owners.length>0&&!owners.some(owner=>owner.role===role);});
  }
  function verify(data) {
    resetRoute();
    const accepted = data.identities || data.ids;
    if (!accepted?.has || !scopeInfo() || identities().some(id => !accepted.has(id))) return false;
    if(conflictingRoles())return false;
    if(branch!==accepted){identityVersion++;turnKeys.clear();}
    branch = accepted; return true;
  }
  function outsideBranch() {
    resetRoute();if(!branch)return "";
    if(!scopeInfo())return "!";
    return identities().filter(id => !branch.has(id)).sort().join(" ") || (conflictingRoles()?"!":"");
  }
  const explicitLeaf = () => {
    const info=scopeInfo();if(!info)return;
    const keys=new Set([info.scope.closest?.("[data-current-node-id]"),...transcript("[data-current-node-id]",info)]
      .map(el=>el?.getAttribute("data-current-node-id")).filter(valid));
    return keys.size===1?[...keys][0]:undefined;
  };
  const lastMessage = () => ownIDs(transcript(identitySelector).at(-1)).at(-1);
  const branchHint = () => explicitLeaf() || lastMessage();
  const generating = () => all('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"],form[data-chatgpt-composer] button[aria-label="Stop"],[data-talvt-turn-state="in_progress"]').some(allowedNode);
  const composer = () => all('#prompt-textarea,[data-testid="composer-text-input"],[data-composer-markdown][contenteditable="true"],form [contenteditable="true"]').find(allowedNode);
  const surface = el => (el.matches("[data-response-body],[data-user-message-bubble]") && visible(el) ? el :
    [...el.querySelectorAll("[data-response-body],[data-user-message-bubble]")].find(visible)) ||
    [...el.querySelectorAll(".markdown,[data-message-content],.whitespace-pre-wrap")].find(visible) || el;
  function pending(el) {
    const responses=[...el.querySelectorAll("[data-response-body]")];
    if(el.closest(unitSelector)&&!el.matches(legacyRoleSelector)){
      const marker=roleOf(el)==="assistant"?"[data-response-body],.markdown,[data-message-content]":"[data-user-message-bubble],[data-message-content]";
      if(!el.matches(marker)&&![...el.querySelectorAll(marker)].some(visible))return true;
    }
    // A stable 1px accessibility role label is not a rendered answer. Do not
    // hash its label or certify a landing while the actual body is hidden.
    if(responses.length&&!responses.some(node=>visible(node)&&[...node.getClientRects()].some(r=>r.width>0&&r.height>0)))return true;
    return !!el.closest('[aria-busy="true"]') ||
      [...surface(el).querySelectorAll('[aria-busy="true"]')].some(n => !n.closest("button") && visible(n));
  }
  function bindNavigation(data,rows){
    resetRoute();const previous=known;known=new Map();
    try{
      for(const row of rows)remember({id:row.id,role:row.role,sourcePath:[row.alias]});
      if(verify(data))return true;
    }catch(e){known=previous;identityVersion++;throw e;}
    known=previous;identityVersion++;return false;
  }
  // Preparation only. Identity-bearing boxes may survive a skipped subtree,
  // including a hidden inner role wrapper which mounted() correctly excludes.
  function preparationShells(id,role,alias){
    if(!valid(id))return [];
    const ids=[...new Set([id,alias].filter(valid))];
    const selector=ids.flatMap(key=>[`[data-message-id="${key}"]`,`[data-chatgpt-search-message-ids~="${key}"]`]).join(",");
    const info=scopeInfo();if(!info)return [];
    const exact=[...info.scope.querySelectorAll(selector)].filter(el=>{
      if(!allowedNode(el))return false;
      if(!visible(el.parentElement)||el.closest('[inert],[hidden],[aria-hidden=true]')||idOf(el)!==id)return false;
      const style=getComputedStyle(el);
      if(style.display==="none"||style.opacity==="0"||["collapse","hidden"].includes(style.visibility))return false;
      // A hidden explicit role may contradict the source without contributing
      // to roleOf(). It cannot supply preparation authority in that case.
      const labels=[el,...el.querySelectorAll("[data-message-author-role],[data-conversation-role]")];
      if(labels.some(n=>n.closest(identitySelector)===el&&["data-message-author-role","data-conversation-role"]
        .some(attr=>n.hasAttribute(attr)&&n.getAttribute(attr)!==role)))return false;
      return roleOf(el)===role;
    });
    if(exact.length)return exact;
    const key=turnKeys.get(id);
    return key?transcript("[data-turn-key]",info).filter(el=>el.getAttribute("data-turn-key")===key):[];
  }
  return {identitySelector,roleSelector,timelineSelector,conversationSelector,unitSelector,timeline,scopeInfo,visible,all,candidates,idOf,roleOf,messageNodes,
    mounted, remember, identities, verify, bindNavigation,outsideBranch, explicitLeaf, lastMessage, branchHint, generating, composer, surface, pending,preparationShells,identityVersion:()=>identityVersion};
})();
