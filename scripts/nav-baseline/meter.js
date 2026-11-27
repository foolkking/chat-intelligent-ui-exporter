// Local test package only. The navigation workspace runs in the source tab's
// isolated world. This meter records numeric observations from that tab.
(() => {
  const build = __READER_NAV_MEASUREMENT_BUILD__;
  const names = [
    "responseBytes", "completedSourcePages", "scannerBytes", "decodedJsonBytes",
    "converterInputs", "visibleBodyCalls", "markdownHeadingParses", "sectionNodes",
    "messageDomScans", "revisionSamples", "revisionSampleElements", "domTextWalks"
  ];
  const stats = () => ({count:0, totalMs:0, maxMs:null});
  const rounded = n => Math.round(n * 10) / 10;
  function measure(s, ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    s.count++;
    s.totalMs = rounded(s.totalMs + ms);
    s.maxMs = rounded(Math.max(s.maxMs ?? 0, ms));
  }
  let run, control;
  function add(key, n=1) {
    if (run?.counts && Object.hasOwn(run.counts,key)) run.counts[key] += n;
  }
  function readStart() {
    if (!run) return null;
    run.openReads++;
    return {run, start:performance.now()};
  }
  function renderRead(read, turns, complete) {
    if (!read || read.run !== run) return;
    const name = complete ? "sourceOutline" : "mountedOutline";
    if (!run.report[name]) run.report[name] = {turns, msSinceLoadStarted:rounded(performance.now() - read.start)};
  }
  function readEnd(read) {
    if (read && read.run === run) run.openReads--;
  }
  function jumpStart(kind) {
    if (!run) return null;
    run.report.jumpAttempts++;
    return {run, start:performance.now(), kind, outcome:"unconfirmed"};
  }
  function jumpEnd(jump) {
    if (!jump || jump.run !== run) return;
    const r = run.report;
    r.jumpOutcomes[jump.outcome]++;
    if (r.jumps.length < 64) r.jumps.push({kind:jump.kind, outcome:jump.outcome, ms:rounded(performance.now()-jump.start)});
  }
  function sampleHeap(r) {
    const used = performance.memory?.usedJSHeapSize;
    if (!Number.isFinite(used)) return;
    const heap = r.report.tabHeapBytes ??= {start:used, sampledPeak:used, end:used};
    heap.sampledPeak = Math.max(heap.sampledPeak, used);
    heap.end = used;
  }
  function observe(r, type) {
    if (!globalThis.PerformanceObserver?.supportedEntryTypes?.includes(type)) return;
    const metric = stats();
    const collect = entries => {
      for (const e of entries) {
        if (e.startTime < r.start || e.startTime >= r.end) continue;
        if (type === "longtask") measure(metric, e.duration);
        else if (["pointerdown","click","keydown"].includes(e.name) && e.target !== control)
          measure(metric, e.processingStart - e.startTime);
      }
    };
    const obs = new PerformanceObserver(list => collect(list.getEntries()));
    try {
      obs.observe(type === "event" ? {type, durationThreshold:16} : {type});
      r.report[type === "event" ? "eventDelayMsOver16msDuration" : "longTasksMs"] = metric;
      r.cleanup.push(() => {collect(obs.takeRecords()); obs.disconnect();});
    } catch { obs.disconnect(); }
  }
  function start() {
    if (run) return;
    const report = {
      schema:1, ...build, startedAt:new Date().toISOString(), durationMs:null, pageChanged:false, tabWasHidden:document.hidden,
      counts:build.counted ? Object.fromEntries(names.map(n=>[n,0])) : null,
      mountedOutline:null, sourceOutline:null, longTasksMs:null, eventDelayMsOver16msDuration:null, tabHeapBytes:null,
      inputDispatchLagMs:stats(), inputDuringRead:build.counted ? stats() : null,
      wheelEvents:0, scrollEvents:0, wheelDuringRead:build.counted ? 0 : null,
      jumpAttempts:build.counted ? 0 : null, jumpOutcomes:build.counted ? {verified:0, fallback:0, unconfirmed:0, cancelled:0} : null,
      jumps:build.counted ? [] : null
    };
    const r = run = {start:performance.now(), end:Infinity, path:location.pathname, report, counts:report.counts, openReads:0, cleanup:[]};
    const input = e => {
      if (!e.isTrusted || e.composedPath().includes(control)) return;
      if (e.type === "wheel") {report.wheelEvents++; if(r.openReads) report.wheelDuringRead++; return;}
      if (e.type === "scroll") {report.scrollEvents++; return;}
      const lag = performance.now() - e.timeStamp;
      measure(report.inputDispatchLagMs, lag);
      if (r.openReads) measure(report.inputDuringRead, lag);
    };
    for (const type of ["pointerdown","keydown","wheel","scroll"]) {
      document.addEventListener(type,input,{capture:true,passive:true});
      r.cleanup.push(()=>document.removeEventListener(type,input,true));
    }
    function checkContext() {
      if (document.hidden) report.tabWasHidden = true;
      if (location.pathname !== r.path) report.pageChanged = true;
      sampleHeap(r);
    }
    document.addEventListener("visibilitychange",checkContext);
    addEventListener("popstate",checkContext);
    const timer = setInterval(checkContext,1000);
    r.cleanup.push(()=>{clearInterval(timer); document.removeEventListener("visibilitychange",checkContext); removeEventListener("popstate",checkContext);});
    checkContext(); observe(r,"longtask"); observe(r,"event");
  }
  function stop() {
    if (!run) return null;
    const r = run;
    r.end = performance.now();
    r.report.durationMs = rounded(r.end - r.start);
    r.report.pageChanged ||= location.pathname !== r.path;
    r.report.tabWasHidden ||= document.hidden;
    sampleHeap(r);
    for (const fn of r.cleanup) fn();
    run = null;
    return r.report;
  }
  globalThis.ReaderNavMeter = {add, readStart, renderRead, readEnd, jumpStart, jumpEnd};
  // Only a trusted local user action starts sampling or downloads a report.
  // No extension storage, tab messaging, performance trace or request URL.
  setTimeout(() => {
    if (!globalThis.ReaderRoutes?.chat(location.pathname) || !document.body) return;
    control = document.createElement("div");
    control.style.cssText = "all:initial;position:fixed;bottom:12px;left:12px;z-index:2147483647";
    const shadow = control.attachShadow({mode:"closed"}), button = document.createElement("button");
    const idle = `开始测量${build.counted ? "（含计数）" : "（对照）"}`;
    button.type = "button"; button.textContent = idle;
    button.style.cssText = "background:#fff;color:#15271f;border:1px solid #507263;border-radius:6px;padding:8px 12px;font:14px system-ui";
    button.onclick = event => {
      if (!event.isTrusted || !globalThis.ReaderRoutes.chat(location.pathname) && !run) return;
      if (!run) {start(); button.textContent = "结束并下载指标"; return;}
      const report = stop();
      const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:"application/json"}));
      const a = document.createElement("a");
      a.download = `reader-nav-${build.counted ? "counted" : "control"}-${Date.now()}.json`;
      a.href = url; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      button.textContent = idle;
    };
    shadow.append(button); document.body.append(control);
    addEventListener("pagehide",stop,{once:true});
  },0);
})();
