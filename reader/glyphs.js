// Local monochrome glyphs. Accessible names live on the associated control, never in a tooltip alone.
globalThis.ReaderGlyph = name => {
  const paths = {
    book:"M12 5.5C8.5 3.4 5.3 3.4 2.5 4.5v14c2.8-1.1 6-1.1 9.5 1 3.5-2.1 6.7-2.1 9.5-1v-14c-2.8-1.1-6-1.1-9.5 1Zm0 0v14",
    settings:"m9.5 3 .7-1h3.6l.7 2.1 2 .9 2.1-.5 1.8 3.1-1.4 1.6.2 2.4 1.4 1.6-1.8 3.1-2.1-.4-2 1-.7 2h-3.6l-.7-2-2-1-2.1.4-1.8-3.1 1.4-1.6.2-2.4L2.4 7.6l1.8-3.1 2.1.5 2-.9.4-1.1ZM15.2 10.8a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 1 1 6.4 0",
    search:"M16 16l4.5 4.5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0",
    chat:"M20.5 11.5a8.5 8.5 0 0 1-8.8 8 11 11 0 0 1-4.2-.9L3 20l1.1-4.2a8 8 0 0 1-1.1-4.3 8.8 8.8 0 0 1 17.5 0Z",
    more:"M4 12h.1m7.8 0h.1m7.8 0h.1", chevron:"m7.5 9.5 4.5 4.5 4.5-4.5",
    file:"m8.2 13.4 5.9-5.9a2.1 2.1 0 0 1 3 3l-7.6 7.6a4.1 4.1 0 0 1-5.8-5.8l8.5-8.5a5.4 5.4 0 0 1 7.6 7.6l-8.3 8.3",
    pin:"m15.8 3.5 4.7 4.7-3.3 1.3-3.4 3.4-.3 3.5-6-6 3.5-.3 3.4-3.4 1.4-3.2ZM9.8 14.2 4 20",
    folder:"M3 8V5a1 1 0 0 1 1-1h5l2.5 3H20a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z",
    download:"M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4",
    upload:"M8 17H6a4 4 0 0 1-.4-8 6.6 6.6 0 0 1 12.5-1.1A4.6 4.6 0 0 1 18 17h-2m-4 4V10m-3.5 3.5L12 10l3.5 3.5",
    external:"M13 4h7v7m0-7L10 14M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5",
    ok:"M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0Zm-13 0 2.8 2.8 5.5-5.6",
    warning:"m10.4 4.2-8 13.9A1.8 1.8 0 0 0 4 21h16a1.8 1.8 0 0 0 1.6-2.9l-8-13.9a1.8 1.8 0 0 0-3.2 0ZM12 9v5m0 3h.01",
    clock:"M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0ZM12 7v5l3 2", spin:"M21 12a9 9 0 1 1-9-9",
    close:"m6 6 12 12M18 6 6 18", back:"m14 6-6 6 6 6",
  };
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg"),p=document.createElementNS(ns,"path");
  svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");svg.setAttribute("focusable","false");
  svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");svg.setAttribute("stroke-width",name==="more"?"3.6":"1.65");
  svg.setAttribute("stroke-linejoin","round");svg.setAttribute("stroke-linecap","round");p.setAttribute("d",paths[name]||"");svg.append(p);return svg;
};
