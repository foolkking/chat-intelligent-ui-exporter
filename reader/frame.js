// The only web-accessible page is inert without a single-use top-document grant.
(async () => {
  if (window === top || !/^#[a-f0-9-]{36}$/.test(location.hash)) return;
  const allow = await chrome.runtime.sendMessage({kind:"frame-claim", ticket:location.hash.slice(1)});
  if (!allow?.ok) throw Error("Frame grant unavailable");
  const url = chrome.runtime.getURL("panel.html");
  const response = await fetch(url);
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  for (const style of doc.querySelectorAll('link[rel="stylesheet"]')) {
    const link=style.cloneNode();link.href=new URL(style.getAttribute("href"),url).href;document.head.append(link);
  }
  document.body.replaceChildren(...doc.body.childNodes);
  for (const item of doc.querySelectorAll("head script[src]")) {
    await new Promise((resolve, reject) => {
      const script=document.createElement("script");script.src=new URL(item.getAttribute("src"),url).href;script.onload=resolve;script.onerror=reject;
      document.head.append(script);
    });
  }
  addEventListener("keydown", e => {
    if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open],:popover-open"))
      chrome.runtime.sendMessage({kind:"frame-close"});
  });
})().catch(()=>{document.body.textContent=navigator.language.startsWith("zh")?"请重新打开 Reader 资料库。":"Reopen the Reader library.";});
