// Isolated real Edge rendering of this checkout's source-control/progress scripts.
// All source/runtime/task responses below are synthetic; this is NOT a logged-in
// ChatGPT capture, extension-permission, real Reader or network end-to-end test.
// TEMP/TMP and the argument must point at the explicitly authorized task directory.
//   node scripts/reader-progress-check.cjs E:\chat-reader-temp\...\agent-extension
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const repo = path.resolve(__dirname, "..");
const outRoot = path.resolve(process.argv[2] || process.env.READER_PROGRESS_TEST_ROOT || "");
const approved = ["E:\\chat-reader-temp", "C:\\Users\\86182\\Desktop\\wkkk"].map(p => path.resolve(p));
if (process.platform === "win32" && !approved.some(root =>
    outRoot.toLowerCase().startsWith(root.toLowerCase() + path.sep)))
  throw Error("Browser evidence and profile must stay in a task subdirectory under an authorized temporary root.");
if (!process.argv[2] && !process.env.READER_PROGRESS_TEST_ROOT) throw Error("An explicit evidence directory is required.");
fs.mkdirSync(outRoot, {recursive: true});
const out = fs.mkdtempSync(path.join(outRoot, "edge-progress-"));
process.env.TEMP = process.env.TMP = out;
const executablePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const scripts = Object.fromEntries(["glyphs.js", "progress.js", "page-index.js", "source-control.js"].map(name =>
  [name, fs.readFileSync(path.join(repo, "reader", name), "utf8")]));
const results = {at: new Date().toISOString(), kind: "real Edge, synthetic source/runtime only", files: {}, scenarios: [], errors: []};
for (const [name, content] of Object.entries(scripts))
  results.files[name] = crypto.createHash("sha256").update(content).digest("hex");
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Synthetic Reader progress acceptance</title>
<style>
html{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:#faf9f6;color:#27332e;font:15px/1.7 system-ui,sans-serif}
main{width:min(760px,100%);margin:auto;padding:40px 24px 140px}h1{font-size:20px;margin:0 0 24px;font-weight:600}
article{width:100%;min-height:500px}p{margin:0 0 20px}.question{max-width:80%;margin-left:auto;padding:12px 16px;background:#e9f2ed;border-radius:12px}
footer{position:fixed;left:50%;transform:translateX(-50%);bottom:12px;width:min(712px,calc(100% - 24px));height:52px;border:1px solid #d6dad3;border-radius:16px;background:#faf9f6;padding:12px 16px;color:#52635b}
footer button{float:right;width:32px;height:32px;margin-top:-3px;border:1px solid #d6dad3;background:transparent;color:inherit;border-radius:50%}
@media(prefers-color-scheme:dark){body,footer{background:#21251f;color:#ecede7}.question{background:#34443a}footer{color:#b4c0b5}}
</style></head><body><main data-current-node-id="synthetic-branch"><h1>合成验收对话 · 非真实用户数据</h1><article id="reading-column">
<section data-testid="conversation-turn-1"><p class="question" data-message-id="synthetic-q" data-message-author-role="user">请保留长对话、附件与上下文，读取时告诉我正在进行哪一步。</p>
<div data-message-id="synthetic-a" data-message-author-role="assistant"><p>这是一段固定宽度的阅读正文。测试必须确认显示进度、打开菜单和收起按钮都不改变它的宽度。</p>
<p>只显示已经测量的消息数量、文件字节和上传回执。没有总量时，不展示估算百分比。</p>
<p>读取 → 核对来源 → 整理消息 → 接收附件 → 生成导入包 → 上传。中断后由资料库中的原任务继续。</p></div></section>
</article></main><footer id="composer">输入框（合成）<button aria-label="发送">↑</button></footer></body></html>`;
const server = http.createServer((req, res) => {
  const file = new URL(req.url, "http://127.0.0.1").pathname.slice(1);
  if (scripts[file]) {res.writeHead(200, {"Content-Type": "text/javascript; charset=utf-8"}); res.end(scripts[file]);}
  else if (file === "c/synthetic-progress") {res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"}); res.end(html);}
  else {res.writeHead(404); res.end();}
});
const saveReport = () => fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));

async function rootState(page) {
  return page.evaluate(() => {
    const root = __control, text = root.querySelector(".read-progress p"), meter = root.querySelector("progress");
    const bounds = node => {const r = node.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom};};
    return {
      main: root.querySelector(".main").textContent, text: text.textContent,
      progressHidden: root.querySelector(".read-progress").hidden,
      meterHidden: meter.hidden, meterValue: meter.value, meterMax: meter.max,
      described: root.querySelector(".main").getAttribute("aria-describedby"),
      disabled: root.querySelector(".main").disabled,
      line: bounds(document.getElementById("reading-column")), host: bounds(root.host),
      composer: bounds(document.getElementById("composer")),
      menu: [...root.querySelectorAll(".menu button")].map(b => b.textContent),
      active: root.activeElement?.textContent || "", note: [...root.querySelectorAll('[role="status"]')].map(n => n.textContent),
      viewport: {width: innerWidth, height: innerHeight}, bodyWidth: document.body.getBoundingClientRect().width
    };
  });
}
async function click(page, selector, text) {
  const box = await page.evaluate((s, label) => {
    const elements = [...__control.querySelectorAll(s)], node = label ? elements.find(n => n.textContent === label) : elements[0];
    if (!node) throw Error("Missing synthetic test target: " + s + " " + label);
    const r = node.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2};
  }, selector, text);
  await page.mouse.click(box.x, box.y); // Trusted browser click; not dispatchEvent().
}
async function scenario(browser, origin, spec) {
  const page = await browser.newPage(), record = {name: spec.name, stages: [], widths: [], screenshots: []};
  results.scenarios.push(record);
  await page.setViewport({width: spec.width, height: spec.height, deviceScaleFactor: 1});
  await page.emulateMediaFeatures([{name: "prefers-color-scheme", value: spec.dark ? "dark" : "light"}]);
  page.on("pageerror", error => results.errors.push({scenario: spec.name, error: error.message}));
  await page.setRequestInterception(true);
  page.on("request", request => request.url().startsWith(origin + "/") ? request.continue() : request.abort());
  await page.evaluateOnNewDocument(locale => Object.defineProperty(navigator, "language", {get: () => locale}), spec.locale);
  const screenshot = async name => {
    const filename = path.join(out, `${spec.name}-${name}.png`);
    await page.screenshot({path: filename}); record.screenshots.push(filename);
  };
  try {
    await page.goto(origin + "/c/synthetic-progress", {waitUntil: "domcontentloaded"});
    const before = await page.$eval("#reading-column", node => node.getBoundingClientRect().width);
    record.beforeWidth = before;
    await screenshot("00-baseline");
    await page.evaluate(() => {
      globalThis.__roots = [];
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) {const root = attach.call(this, options); __roots.push(root); return root;};
      globalThis.__fixture = {backend: {state: "save"}, watchers: [], opened: 0, cancelled: 0, attempts: []};
      globalThis.chrome = {runtime: {
        id: "synthetic-test-runtime", onMessage: {addListener() {}},
        async sendMessage(message) {
          if (message.kind === "source-state") {
            __fixture.attempts.push(message.attempt);
            return __fixture.backend?.matchAttempt ? {state: message.attempt === "synthetic-attempt" ? "saved" : "previous"} : __fixture.backend;
          }
          return {ok: true};
        },
        connect() {return {onMessage: {addListener(fn) {__fixture.watchers.push(fn);}},
          onDisconnect: {addListener() {}}, disconnect() {}};}
      }};
      globalThis.ReaderOpenLibrary = () => {__fixture.opened++;};
    });
    for (const name of Object.keys(scripts)) await page.addScriptTag({url: origin + "/" + name});
    await page.evaluate(() => {
      ReaderSourceControl({
        pathId: () => "synthetic-progress",
        capture(onStart, excerpt, batch, onProgress) {
          __fixture.sourceVersion = ReaderPageIndex.sample(); onStart("synthetic-attempt");
          __fixture.backend = {state: "saving"};
          __fixture.report = ReaderProgress.throttle(onProgress, 300);
          return new Promise((resolve, reject) => {__fixture.resolve = resolve; __fixture.reject = reject;});
        },
        cancel() {
          if (!__fixture.reject) return;
          __fixture.cancelled++; __fixture.backend = {state: "failed"};
          __fixture.reject(new DOMException("读取已取消，尚未发送。", "AbortError"));
          __fixture.reject = null;
        }
      });
      globalThis.__control = __roots[0]; // Closed root stays closed in product; this test retains its handle.
    });
    await page.waitForFunction(() => !__control.querySelector(".main").disabled);
    await click(page, ".main");
    const steps = [
      {stage: "source", pages: 2, done: 512 * 1024},
      {stage: "index", done: 50001},
      {stage: "messages", done: 50000, total: 50001},
      {stage: "asset", files: 1, done: 17 * 1024 * 1024},
      {stage: "package", done: 110 * 1024 * 1024},
      {stage: "upload", done: 4 * 1024 * 1024, total: 125 * 1024 * 1024}
    ];
    for (const [index, step] of steps.entries()) {
      await page.evaluate(value => {__fixture.report.update(value); __fixture.report.flush();}, step);
      const state = await rootState(page);
      record.stages.push({step, ...state}); record.widths.push(state.line.width);
      assert.equal(state.progressHidden, false);
      assert.equal(state.described, "reader-transfer-description");
      assert.equal(state.meterHidden, !step.total, "unknown total must not create a percent bar");
      assert.doesNotMatch(state.text, /%/);
      if (step.total) {assert.equal(state.meterValue, step.done); assert.equal(state.meterMax, step.total);}
      assert.equal(state.line.width, before, "progress must not shrink or widen reading text");
      assert.ok(state.host.x >= 0 && state.host.right <= spec.width, "progress stays within viewport");
      assert.ok(state.host.bottom <= state.composer.y, "progress must not cover the input");
      await screenshot(`${String(index + 1).padStart(2, "0")}-${step.stage}`);
      if (index === 0) {
        const observation = await page.evaluate(async () => {
          const before = ReaderPageIndex.sample(), article = document.getElementById("reading-column");
          const history = document.createElement("section"); history.dataset.testid = "conversation-turn-0";
          history.innerHTML = '<p data-message-id="synthetic-history" data-message-author-role="user">Earlier mounted synthetic message.</p>';
          const changed = () => new Promise(resolve => setTimeout(resolve, 0));
          article.prepend(history); await changed();
          const answer = document.querySelector('[data-message-id="synthetic-a"]'), parent = answer.parentNode;
          answer.remove(); await changed(); parent.append(answer); await changed();
          history.remove(); await changed(); article.prepend(history); await changed();
          const after = ReaderPageIndex.sample();
          __fixture.report.update({stage: "source", done: 768 * 1024}); __fixture.report.flush();
          return {before, after};
        });
        assert.equal(observation.before, observation.after, "actual PageIndex must classify virtualization as unchanged");
        const after = await rootState(page); record.afterVirtualization = {sample: observation, state: after};
        await screenshot("01b-after-virtualization");
        assert.match(after.text, /768.0 KiB/, "virtual history mounting must not drop the active capture progress callback");
      }
      if (step.stage === "package") {
        await click(page, ".toggle");
        const menu = await rootState(page);
        assert.ok(menu.menu.some(text => /取消未发送|Cancel capture/.test(text)));
        assert.match(menu.active, /取消未发送|Cancel capture/);
      }
    }
    let state = await rootState(page);
    assert.ok(!state.menu.some(text => /取消未发送|Cancel capture/.test(text)),
      "after delivery, cancellation must not falsely promise an unsent request");
    assert.match(state.active, /在资料库查看|Open Reader library/,
      "when upload removes the focused capture-cancel action, focus moves to the surviving adjacent action");
    assert.equal(state.line.width, before);
    await screenshot("07-upload-menu");
    await page.keyboard.press("Escape");
    assert.equal((await rootState(page)).active, ""); // The icon-only toggle regains focus.
    assert.equal(await page.evaluate(() => __control.activeElement === __control.querySelector(".toggle")), true);

    await page.evaluate(() => {
      __fixture.report.close(); __fixture.backend = {state: "paused"};
      __fixture.reject(Error("Synthetic lost upload response")); __fixture.reject = null;
    });
    await page.waitForFunction(() => /继续上传|Resume upload/.test(__control.querySelector(".main").textContent));
    state = await rootState(page); record.interrupted = state;
    assert.equal(state.progressHidden, true); assert.equal(state.disabled, false);
    assert.doesNotMatch(state.main, /已存入|Saved to/);
    await screenshot("08-paused");
    await click(page, ".main");
    assert.equal(await page.evaluate(() => __fixture.opened), 1, "paused task opens existing library recovery, not a second capture");

    await page.evaluate(() => {
      __fixture.backend = {state: "saving", step: {stage: "upload", done: 9 * 1024 * 1024, total: 125 * 1024 * 1024}};
      __fixture.watchers.forEach(fn => fn({}));
    });
    await page.waitForFunction(() => !__control.querySelector(".read-progress").hidden);
    state = await rootState(page); record.resumed = state;
    assert.equal(state.meterValue, 9 * 1024 * 1024); assert.equal(state.line.width, before);
    await screenshot("09-resumed-from-background");
    await page.evaluate(() => {__fixture.backend = {matchAttempt: true}; __fixture.watchers.forEach(fn => fn({}));});
    await page.waitForFunction(() => /已存入|Saved to/.test(__control.querySelector(".main").textContent));
    assert.equal((await rootState(page)).progressHidden, true);
    record.receiptAttemptAfterVirtualization = await page.evaluate(() => __fixture.attempts.at(-1));
    assert.equal(record.receiptAttemptAfterVirtualization, "synthetic-attempt", "virtualization preserves this capture's receipt identity");
    await screenshot("10-saved");
    await page.evaluate(() => document.querySelector("[data-current-node-id]").setAttribute("data-current-node-id", "synthetic-other-branch"));
    await page.waitForFunction(() => /打开已存版本|Open saved version/.test(__control.querySelector(".main").textContent));
    record.afterRealBranchChange = await rootState(page);
    await screenshot("10b-branch-changed");

    // Startup denial previously left a permanent "Reading · 0 B" strip even
    // though no capture started; preserve this regression instead of hiding it.
    await page.evaluate(() => {__fixture.backend = {state: "save"}; __fixture.watchers.forEach(fn => fn({}));});
    await page.waitForFunction(() => /保存到 Reader|Save to Reader/.test(__control.querySelector(".main").textContent));
    await click(page, ".main");
    await page.evaluate(() => {
      __fixture.report.close();
      __fixture.reject(Object.assign(Error("Synthetic authorization expired before capture"), {displayState: "reconnect"}));
      __fixture.reject = null;
    });
    await page.waitForFunction(() => /重新连接|Reconnect/.test(__control.querySelector(".main").textContent));
    state = await rootState(page); record.deniedBeforeReading = state;
    await screenshot("11-denied-before-reading");
    assert.equal(state.progressHidden, true, "a capture that did not start cannot keep displaying reading progress");
    assert.equal(state.line.width, before);
    await page.evaluate(() => {__fixture.backend = {state: "save"}; __fixture.watchers.forEach(fn => fn({}));});
    await page.waitForFunction(() => /保存到 Reader|Save to Reader/.test(__control.querySelector(".main").textContent));
    await click(page, ".main");
    await page.evaluate(async () => {
      __fixture.report.update({stage: "source", done: 1024}); __fixture.report.flush();
      document.querySelector('[data-message-id="synthetic-a"] p').textContent = "A real edit to the same synthetic message.";
      await new Promise(resolve => setTimeout(resolve, 0));
      __fixture.report.update({stage: "source", done: 2048}); __fixture.report.flush();
    });
    state = await rootState(page); record.afterRealContentEdit = state;
    assert.equal(state.progressHidden, true, "real source edits invalidate stale capture progress");
    assert.doesNotMatch(state.text, /2.0 KiB/);
    await page.evaluate(() => {
      __fixture.report.close(); __fixture.backend = {state: "failed"};
      __fixture.reject(Error("Source changed; synthetic capture stopped.")); __fixture.reject = null;
    });
    await page.waitForFunction(() => /查看保存问题|Review save issue/.test(__control.querySelector(".main").textContent));
    await screenshot("12-source-changed");
    record.maxWidthChange = Math.max(...record.widths.map(width => Math.abs(width - before)));
    record.pass = true;
  } catch (error) {
    record.pass = false; record.failure = error.message;
    await screenshot("FAIL").catch(() => {}); saveReport(); throw error;
  } finally {await page.close();}
}

(async () => {
  let browser;
  const {default: puppeteer} = await import("puppeteer-core");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    browser = await puppeteer.launch({executablePath, headless: true, pipe: true,
      userDataDir: path.join(out, "profile"), args: [
        "--no-first-run", "--disable-sync", "--disable-background-networking",
        "--disable-component-update", "--metrics-recording-only", "--lang=zh-CN"
      ]});
    results.browser = await browser.version();
    for (const spec of [
      {name: "desktop-zh", width: 1440, height: 900, locale: "zh-CN"},
      {name: "narrow-zh", width: 375, height: 812, locale: "zh-CN"},
      {name: "compact-en", width: 320, height: 720, locale: "en-US"},
      {name: "narrow-dark", width: 375, height: 812, locale: "zh-CN", dark: true}
    ]) await scenario(browser, origin, spec);
    assert.deepEqual(results.errors, []);
    results.pass = true;
    console.log(JSON.stringify({pass: true, evidence: out, browser: results.browser,
      scenarios: results.scenarios.map(s => ({name: s.name, maxWidthChange: s.maxWidthChange}))}));
  } catch (error) {
    results.pass = false; results.failure = error.message;
    console.error(error.stack); console.error("Retained evidence: " + out); process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve)); saveReport();
  }
})();
