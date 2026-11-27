// Opt-in, isolated-world experiments. No transcript, project name, URL, ID
// or account information appears in the report. Nothing runs on page load.
globalThis.ReaderSiteCheck = (() => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function model() {
    const value = globalThis.ReaderNavigationDiagnostics?.model();
    if (!value?.complete) throw Error("Open Navigation and wait for a verified full outline.");
    return value;
  }
  function selected(n) {
    const state = model();
    if (!Number.isSafeInteger(n) || n < 1 || n > state.rows.length) throw RangeError("Choose a message number from the index.");
    return {state, row: state.rows[n - 1]};
  }
  async function seal(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
  }
  const branchSeal = (state, salt) => seal([salt, location.pathname, state.branch, state.rows.map(r => [r.id, r.role, r.alias])]);
  let experiment;
  async function route(n) {
    const {state, row} = selected(n);
    const url = new URL(location.href);
    url.searchParams.set("message", row.id);
    const salt = crypto.randomUUID(), branch = await branchSeal(state, salt), target = await seal([salt, row.id]);
    if (model() !== state) throw Error("Source changed.");
    // A separate noopener tab preserves the original draft, branch and capture.
    // The one-time comparisons concern this experiment only and can be discarded.
    window.open(url.href, "_blank", "noopener,noreferrer");
    return {salt,branch,target,n,tree:!!state.branch,expires:Date.now()+600000};
  }
  async function routeResult(ticket) {
    if (!(ticket?.expires > Date.now()) || !ticket.salt) throw Error("Experiment expired.");
    const state = model(), query = new URL(location.href).searchParams.get("message");
    const sameIndex = await branchSeal(state, ticket.salt) === ticket.branch;
    const sameBranch = ticket.tree && !!state.branch ? sameIndex : null;
    // Some builds strip ?message= after hydration. Prove identity from the new
    // verified model, not from the presence (or absence) of a query parameter.
    const candidate=state.rows[ticket.n-1],sameTarget=!!candidate&&await seal([ticket.salt,candidate.id])===ticket.target&&(!query||candidate.id===query);
    const row = sameTarget && candidate;
    let previous, stable = 0, last, version = ReaderPageIndex.sample();
    const observe=()=>{
      last=ReaderPageIndex.inspectLanding(row);
      stable = last?.visibleStart && previous?.node === last.node && Math.abs(previous.top - last.top) <= 1 ? stable + 1 : 0;
      previous = last;
    };
    for (let i = 0; i < 8 && sameIndex && row; i++) {
      observe();
      await delay(90);
    }
    const current = ReaderPageIndex.sample(true,row?.id) === version && ReaderNavigationDiagnostics.model() === state;
    if(current&&sameIndex&&row)observe();
    else{last=null;stable=0;}
    return {queryRetained:!!query,sameIndex,sameBranch, sameTarget, current, rendered: !!last, visibleStart: !!last?.visibleStart,
      stable: current && stable >= 3, readingLineErrorPx: last ? Math.round(last.error) : null};
  }
  const heap=()=>Number.isFinite(performance.memory?.usedJSHeapSize)?Math.round(performance.memory.usedJSHeapSize/1048576):null;
  function begin() {
    experiment?.observer?.disconnect();
    const stats = {longTasks: 0, maxLongTaskMs: 0, inputs: 0, maxInputDelayMs: 0};
    const observer = typeof PerformanceObserver === "function" && new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "longtask") {
          stats.longTasks++; stats.maxLongTaskMs = Math.max(stats.maxLongTaskMs, Math.round(entry.duration));
        } else {
          stats.inputs++; stats.maxInputDelayMs = Math.max(stats.maxInputDelayMs, Math.round(entry.processingStart - entry.startTime));
        }
      }
    });
    const supported = globalThis.PerformanceObserver?.supportedEntryTypes || [];
    if (observer && supported.includes("longtask")) observer.observe({type:"longtask"});
    if (observer && supported.includes("event")) observer.observe({type:"event", durationThreshold:16});
    const jumps=[];ReaderPageIndex.measure(row=>{if(jumps.length===128)jumps.shift();jumps.push({...row});});
    experiment = {stats,observer,jumps,heapStartMiB:heap(),supported:supported.filter(t => t === "longtask" || t === "event")};
    return {observed: experiment.supported};
  }
  function report() {
    const {stats, supported} = experiment || {};
    const jumps=experiment?.jumps.map(j=>({...j}))||[],summary={};
    for(const j of jumps){
      const w=summary[j.target]||={exact:0,answerOnly:0,wrong:0,failed:0,cancelled:0,unreviewed:0};
      w[j.verdict||"unreviewed"]++;
    }
    return {navigation:ReaderPageIndex.metrics(),timing:stats?{...stats,supported,heapStartMiB:experiment.heapStartMiB,heapNowMiB:heap()}:null,summary,jumps};
  }
  function mark(verdict,rebound=false){
    const j=experiment?.jumps.at(-1);
    if(!j||!["exact","answerOnly","wrong","failed","cancelled"].includes(verdict)||typeof rebound!=="boolean")throw Error("Mark the latest completed jump with a supported verdict.");
    j.verdict=verdict;j.observedRebound=rebound;
    return {count:experiment.jumps.length,target:j.target,verdict};
  }
  return {
    index() { const state=model();return {messages:state.rows.length,turns:state.rows.filter(r=>r.role==="user").length+Number(state.rows[0]?.role==="assistant")}; },
    targets(turn) {
      if(!Number.isSafeInteger(turn)||turn<1)throw RangeError("Choose a turn number.");
      const {rows}=model(),result=[];let at=0;
      for(let i=0;i<rows.length;i++){
        const row=rows[i];if(!at||row.role==="user")at++;
        if(at>turn)break;
        if(at===turn)result.push({n:i+1,role:row.role,...ReaderPageIndex.inspectTarget(row)});
      }
      return result;
    },
    route, routeResult,
    native(n) { const {row} = selected(n); return ReaderNavigationDiagnostics.trial(row.id); },
    projects() { return ReaderRoutes.projectReport(ReaderRoutes.projectCatalogue(document, location.pathname)); },
    begin,mark,report,end(){experiment?.observer?.disconnect();ReaderPageIndex.measure(null);return report();}
  };
})();
