globalThis.ReaderRoutes = (() => {
  const chat = path => /^\/(?:g\/[\w-]+\/)?c\/([\w-]{1,128})\/?$/.exec(path)?.[1] || "";
  const projectHome = path => /^\/g\/(g-p-[\w-]{1,180})\/(?:project\/?)?$/.exec(path)?.[1] || "";
  // A project chat carries a useful source hint, not proof of a complete directory.
  // Custom GPT URLs without the g-p- project prefix must not acquire membership.
  const project = path => projectHome(path) || (chat(path) && /^\/g\/(g-p-[\w-]{1,180})\/c\//.exec(path)?.[1]) || "";
  const eligible = path => !!(chat(path) || projectHome(path) || path === "/" || /^\/w\/[\w-]+\/?$/.test(path));
  return {chat, project, projectHome, eligible};
})();
