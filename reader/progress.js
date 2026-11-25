// Only measured counters cross the source/extension boundary. Titles, file names and URLs stay private.
globalThis.ReaderProgress = (() => {
  const stages = new Set(["source", "index", "messages", "asset", "package", "upload"]);
  const numeric = ["done", "total", "pages", "messages", "files"];
  function snapshot(value) {
    if (!value || !stages.has(value.stage)) return null;
    const step = {stage: value.stage};
    for (const key of numeric) {
      if (Number.isSafeInteger(value[key]) && value[key] >= 0) step[key] = value[key];
    }
    if (!step.total || step.done > step.total) delete step.total;
    return step;
  }
  function size(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / 1048576).toFixed(1)} MiB`;
  }
  function describe(value, zh) {
    const step = snapshot(value);
    if (!step) return "";
    const L = (c, e) => zh ? c : e;
    const labels = {
      source: L("读取对话", "Reading conversation"), index: L("核对来源", "Indexing source"),
      messages: L("整理消息", "Preparing messages"), asset: L("接收附件", "Receiving file"),
      package: L("生成导入包", "Preparing archive"), upload: L("上传到 Reader", "Uploading to Reader")
    };
    const parts = [labels[step.stage]];
    if (step.stage === "source" && step.pages) parts.push(L(`第 ${step.pages} 页`, `page ${step.pages}`));
    if (step.stage === "asset" && step.files) parts.push(L(`第 ${step.files} 个`, `file ${step.files}`));
    if (step.done !== undefined) {
      const format = ["index","messages"].includes(step.stage) ? String : size;
      parts.push(format(step.done) + (step.total ? " / " + format(step.total) : ""));
    }
    return parts.join(" · ");
  }
  // One trailing update, even if the transfer stalls just after a burst. A phase change is immediate.
  function throttle(publish, delay = 300) {
    let pending, timer, last = -Infinity, stage;
    const flush = () => {
      clearTimeout(timer); timer = null;
      if (!pending) return;
      const step = pending; pending = null; last = performance.now(); stage = step.stage;
      publish(step);
    };
    return {
      update(value) {
        const next = snapshot(value);
        if (!next) return;
        // A new phase cannot erase the previous phase's last measured bytes.
        // Receivers use that trailing value to distinguish finished reading
        // from a stalled or partial transfer.
        if (pending && pending.stage !== next.stage) flush();
        pending = next;
        const left = delay - (performance.now() - last);
        if (stage !== pending.stage || left <= 0) flush();
        else if (!timer) timer = setTimeout(flush, left);
      },
      flush, close() { clearTimeout(timer); pending = timer = null; }
    };
  }
  return {snapshot, describe, throttle};
})();
