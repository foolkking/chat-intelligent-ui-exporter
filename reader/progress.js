// Only measured counters cross the source/extension boundary. Titles, file names and URLs stay private.
globalThis.ReaderProgress = (() => {
  const stages = new Set(["source", "index", "messages", "asset", "package", "upload"]);
  const numeric = ["done", "total", "pages", "messages", "files"];
  const cumulative = ["sourceBytes", "sourcePages", "indexedNodes", "messageCount", "textBytes",
    "assetBytes", "filesStarted", "filesSucceeded", "filesFailed", "filesDiscovered", "filesTotal",
    "unresolvedResources", "packageBytes", "uploadBytes"];
  const count = n => Number.isSafeInteger(n) && n >= 0;
  function measurements(value) {
    const result = {};
    for (const key of cumulative) if (count(value?.[key])) result[key] = value[key];
    if (count(value?.serverProgress) && value.serverProgress <= 100) result.serverProgress = value.serverProgress;
    return result;
  }
  // These are explicit measurements, not deltas. Page/file-local done resets
  // cannot establish bytes read, successful files, or a final resource total.
  function accumulate(previous, next) {
    const result = measurements(previous), incoming = measurements(next);
    if (next?.stage === "index" && count(next.done))
      incoming.indexedNodes = Math.max(incoming.indexedNodes || 0, next.done);
    for (const [key, value] of Object.entries(incoming)) {
      result[key] = key === "uploadBytes" || key === "serverProgress" ? value : Math.max(result[key] || 0, value);
    }
    return result;
  }
  const categories = new Set(["network", "auth", "permission", "source", "cancelled", "local-storage",
    "server-storage", "limit", "conflict", "protocol", "unavailable", "server", "unknown"]);
  const failureCodes = new Set(["APPEND_REVIEW_CHANGED", "DOCUMENT_NOT_TRANSCRIPT", "IMPORT_MESSAGE_TOO_LARGE", "IMPORT_PLAN_INVALID",
    "IMPORT_RESOURCE_WAIT_EXPIRED", "IMPORT_STORAGE_FULL", "IMPORT_WORKSPACE_EXCEEDED", "MANIFEST_ASSET_MISSING",
    "MANIFEST_ASSET_PATH_INVALID", "MARKDOWN_EMPTY", "MARKDOWN_ENCODING_INVALID", "MARKDOWN_FENCE_UNCLOSED",
    "MARKDOWN_RESOURCE_MISSING", "NO_MESSAGE_STRUCTURE", "READER_PACKAGE_INVALID", "SMALL_IMPORT_BUDGET_EXCEEDED",
    "SOURCE_CHANGED", "SOURCE_MISSING", "SOURCE_PATH_INVALID", "TASK_FAILED", "UPLOAD_MEMORY_PRESSURE",
    "UPLOAD_QUEUE_FULL", "UPLOAD_QUEUE_TIMEOUT", "ZIP_COMPRESSION_UNSAFE", "ZIP_CRC_INVALID", "ZIP_ENTRY_LIMIT",
    "ZIP_EXPANDED_LIMIT", "ZIP_INVALID", "ZIP_MANIFEST_INVALID", "ZIP_MARKDOWN_REQUIRED", "ZIP_MEMBER_TOO_LARGE",
    "ZIP_MEMBER_UNSUPPORTED", "ZIP_METADATA_LIMIT", "ZIP_PATH_DEPTH_LIMIT", "ZIP_PATH_DUPLICATE",
    "ZIP_PATH_UNSAFE", "ZIP_SOURCE_CHANGED"]);
  const failureStages = new Set(["admission", "analysis", "archive", "commit", "file", "grouping",
    "mapping", "normalization", "validation"]);
  const codes = new Set([...failureCodes, "READER_TRANSFER_PENDING", "READER_TRANSFER_OFFSET",
    "IMPORT_UPLOAD_REQUEST_PENDING", "FILE_TOO_LARGE", "UPLOAD_RECEIPT_INVALID", "UPLOAD_OFFSET_INVALID",
    "UPLOAD_RECEIPT_UNCONFIRMED", "PACKAGE_MISSING", "CAPTURE_INTERRUPTED", "CAPTURE_CANCELLED",
    "LOCAL_STORAGE_FULL", "SOURCE_UNAVAILABLE", "NETWORK_UNAVAILABLE"]);
  const statuses = new Set([400, 401, 403, 404, 408, 409, 410, 413, 415, 422, 429, 500, 502, 503, 504, 507]);
  const recoveries = new Set(["retry_existing", "free_storage", "reconnect", "review_in_reader", "system_support"]);
  function diagnostic(value) {
    if (!value || !categories.has(value.category)) return null;
    const result = {category: value.category};
    if (stages.has(value.stage) || failureStages.has(value.stage) || value.stage === "server") result.stage = value.stage;
    if (statuses.has(value.status)) result.status = value.status;
    if (codes.has(value.code)) result.code = value.code;
    if (recoveries.has(value.recovery)) result.recovery = value.recovery;
    if (result.code === "READER_PACKAGE_INVALID") result.recovery = "system_support";
    return result;
  }
  function failure(value) {
    if (!value || typeof value !== "object") return null;
    const known = failureCodes.has(value.code) && failureStages.has(value.stage);
    return diagnostic({category: "server", code: known ? value.code : "TASK_FAILED",
      stage: known ? value.stage : "analysis",
      recovery: known && recoveries.has(value.recovery) ? value.recovery : "system_support"});
  }
  // The device only observes. In particular, a committed legacy receipt with
  // no measured outcome is not proof that every selected item was appended.
  function appendReceipt(value) {
    if(value?.mode!=="selective_append")return null;
    const out={phase:"check",active:false,diagnostic:null,appendResult:null},result=value.result;
    if(value.status==="committed"){
      out.phase="append-complete";
      if(count(result?.added)&&count(result.skipped)&&typeof result.partial==="boolean")
        out.appendResult={added:result.added,skipped:result.skipped,partial:result.partial};
    }else if(value.status==="failed"){
      out.phase="append-attention";
      out.diagnostic=failure(value.failure)||{category:"server",stage:"server"};
    }else if(["canceled","cancelled"].includes(value.status)){out.phase="cancelled";}
    else if(["analyzing","queued","processing"].includes(value.status)){
      const wait=value.wait;
      out.phase=value.phase==="waiting_resources"&&["UPLOAD_MEMORY_PRESSURE","UPLOAD_QUEUE_FULL","UPLOAD_QUEUE_TIMEOUT"].includes(wait?.reason)&&
        Number.isFinite(wait.remaining_seconds)&&wait.remaining_seconds>=0&&wait.remaining_seconds<=1800?"resource-wait":"processing";out.active=true;
      if(count(value.progress)&&value.progress<=100)out.percent=value.progress;
    }else if(["previewed","resolving","needs_grouping","paused","blocked"].includes(value.status)){
      out.phase="append-ready";
    }
    return out;
  }
  function snapshot(value) {
    if (!value || !stages.has(value.stage)) return null;
    const step = {stage: value.stage};
    for (const key of numeric) {
      if (count(value[key])) step[key] = value[key];
    }
    if (!step.total || step.done > step.total) delete step.total;
    return Object.assign(step, measurements(value));
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
    let pending, timer, last = -Infinity, stage, totals = {};
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
        // Aggregate explicit totals before coalescing; old callers retain their
        // original step shape and do not acquire guessed cumulative counters.
        totals = accumulate(totals, measurements(next));
        Object.assign(next, totals);
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
  return {snapshot, describe, throttle, accumulate, diagnostic, failure, appendReceipt};
})();
