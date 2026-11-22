// Only a static representation leaves the source tab. Do not use a DIL program or
// a raw code block as a fallback for a missing static representation.
globalThis.ReaderVisible = (row, parser) => {
  if (!row.dil) return {body:row.mdEscaped ?? row.md, missing:false};
  const fallback=row.dil.fallbackMarkdown;
  if (typeof fallback !== "string" || !fallback.trim()) return {body:"[Interactive content unavailable]",missing:true};
  return {body:parser.normalizeText(fallback,{escapeHtml:true}).md,missing:false};
};
