globalThis.ReaderRoutes = (() => {
  function projectId(segment=""){
    // Project-home URLs can append a localized slug to the stable hex identifier.
    let decoded;try{decoded=decodeURIComponent(segment);}catch{return "";}
    const stable=/^(g-p-(?:[\da-f]{32}|[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}))(?:-[\p{L}\p{N}\p{M}_-]+)?$/iu.exec(decoded);
    return stable?.[1].toLowerCase() || (/^g-p-[\w-]{1,180}$/.test(segment)?segment:"");
  }
  const chat = path => {
    const match=/^\/(?:g\/([^/]+)\/)?c\/([\w-]{1,128})\/?$/.exec(path);
    return match&&(!match[1]||/^[\w-]+$/.test(match[1])||projectId(match[1]))?match[2]:"";
  };
  const projectHome = path => projectId(/^\/g\/([^/]+)(?:\/project)?\/?$/.exec(path)?.[1]);
  // A project chat carries a useful source hint, not proof of a complete directory.
  // Custom GPT URLs without the g-p- project prefix must not acquire membership.
  const project = path => projectHome(path) || (chat(path) && projectId(/^\/g\/([^/]+)\/c\//.exec(path)?.[1])) || "";
  const eligible = path => !!(chat(path) || projectHome(path) || path === "/" || /^\/w\/[\w-]+\/?$/.test(path));
  return {chat, project, projectHome, projectId, eligible};
})();
