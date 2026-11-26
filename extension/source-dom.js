// Shared, read-only ChatGPT DOM adapter. Never derive a branch end from the last
// mounted message: virtual history is only a hint for the API's verified path.
globalThis.ChatExportSourceDOM = (() => {
  const identitySelector = "[data-message-id],[data-chatgpt-search-message-ids]";
  const legacyRoleSelector = '[data-message-author-role="user"],[data-message-author-role="assistant"]';
  const roleSelector = legacyRoleSelector + ',[data-conversation-role="user"],[data-conversation-role="assistant"]';
  const valid = value => typeof value === "string" && /^[\w-]{1,128}$/.test(value);
  let route = "", branch = null, known = new Map();
  function resetRoute() {
    if (route !== location.pathname) { route = location.pathname; branch = null; known.clear(); }
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
  function messageNodes() {
    const roles = all(roleSelector).map(el =>
      el.hasAttribute("data-conversation-role") && !el.matches(legacyRoleSelector)
        ? el.closest(identitySelector) || el : el).filter(el => candidates(el).length);
    const bare = all(identitySelector).filter(el => !el.matches(legacyRoleSelector) &&
      !el.querySelector(legacyRoleSelector) && !el.closest(legacyRoleSelector));
    return [...new Set([...roles, ...bare])].sort((a,b) =>
      a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }
  function mounted() {
    const rows = messageNodes().filter(el => idOf(el) && ["user","assistant"].includes(roleOf(el)));
    const nodes = new Set(rows);
    // A nested role wrapper inheriting the same identity is not a second
    // message. Separate sibling copies remain ambiguous to the jump verifier.
    return rows.filter(el => {
      for (let p=el.parentElement;p;p=p.parentElement)
        if (nodes.has(p) && idOf(p) === idOf(el) && roleOf(p) === roleOf(el)) return false;
      return true;
    });
  }
  function remember(row) {
    resetRoute();
    if (!valid(row?.id) || !["user","assistant"].includes(row.role)) return;
    const record = {id:row.id, role:row.role};
    for (const id of new Set([row.id,row.sourcePath?.at(-1)].filter(valid))) {
      const owners = records(id);
      if (!owners.some(owner => owner.id === row.id && owner.role === row.role)) known.set(id,[...owners,record]);
    }
  }
  function identities() {
    // The explicit per-message legacy ID wins for resolution, but must not
    // conceal other explicit identities from branch validation.
    return [...new Set(all(identitySelector).flatMap(el => [
      el.getAttribute("data-message-id"), ...(el.getAttribute("data-chatgpt-search-message-ids") || "").trim().split(/\s+/)
    ]).filter(valid))];
  }
  function verify(data) {
    resetRoute();
    const accepted = data.identities || data.ids;
    if (!accepted?.has || identities().some(id => !accepted.has(id))) return false;
    if (messageNodes().some(el => rawRole(el)==="conflict" || rawRole(el) && candidates(el).some(id => known.has(id)) &&
        !candidates(el).flatMap(records).some(owner => owner.role === rawRole(el)))) return false;
    branch = accepted; return true;
  }
  function outsideBranch() {
    resetRoute(); return branch ? identities().filter(id => !branch.has(id)).sort().join(" ") : "";
  }
  const explicitLeaf = () => all("[data-current-node-id]").map(el => el.getAttribute("data-current-node-id")).find(valid);
  const lastMessage = () => ownIDs(all(identitySelector).at(-1)).at(-1);
  const branchHint = () => explicitLeaf() || lastMessage();
  const generating = () => all('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"],form[data-chatgpt-composer] button[aria-label="Stop"],[data-talvt-turn-state="in_progress"]').length > 0;
  const composer = () => all('#prompt-textarea,[data-testid="composer-text-input"],[data-composer-markdown][contenteditable="true"],form [contenteditable="true"]')[0];
  const surface = el => (el.matches("[data-response-body]") && visible(el) ? el :
    [...el.querySelectorAll("[data-response-body]")].find(visible)) ||
    [...el.querySelectorAll(".markdown,[data-message-content],.whitespace-pre-wrap")].find(visible) || el;
  function pending(el) {
    const responses=[...el.querySelectorAll("[data-response-body]")];
    // A stable 1px accessibility role label is not a rendered answer. Do not
    // hash its label or certify a landing while the actual body is hidden.
    if(responses.length&&!responses.some(node=>visible(node)&&[...node.getClientRects()].some(r=>r.width>0&&r.height>0)))return true;
    return !!el.closest('[aria-busy="true"]') ||
      [...surface(el).querySelectorAll('[aria-busy="true"]')].some(n => !n.closest("button") && visible(n));
  }
  return {identitySelector, roleSelector, visible, all, candidates, idOf, roleOf, messageNodes,
    mounted, remember, identities, verify, outsideBranch, explicitLeaf, lastMessage, branchHint, generating, composer, surface, pending};
})();
