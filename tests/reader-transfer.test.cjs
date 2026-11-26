// Synthetic bytes only. The archive uses the real writer and disk-backed File API
// handles; the upload tests use an explicit in-process protocol model, not Reader.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), fsp = fs.promises, path = require("node:path");
const crypto = require("node:crypto"), readline = require("node:readline");
globalThis.fflate = require("../reader/vendor/fflate-0.8.3.js");
require("../reader/sha256.js");
require("../reader/package.js");
require("../reader/upload.js");
require("../reader/progress.js");
const MiB = 1024 * 1024, sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function tempRoot() {
  const configured = process.env.READER_TRANSFER_TEST_ROOT || process.env.TEMP || process.env.TMP || process.env.RUNNER_TEMP;
  if (!configured) throw Error("Explicit test temporary directory required (TEMP/TMP or CI RUNNER_TEMP).");
  const root = path.resolve(configured);
  const allowed = ["E:\\chat-reader-temp", "C:\\Users\\86182\\Desktop\\wkkk"].map(p => path.resolve(p));
  if (process.platform === "win32" && !allowed.some(p => root.toLowerCase().startsWith(p.toLowerCase() + path.sep)))
    throw Error("Set TEMP/TMP to a task subdirectory under an approved temporary root.");
  fs.mkdirSync(root, {recursive: true});
  return fs.mkdtempSync(path.join(root, "reader-transfer-"));
}

function directory(root, writes) {
  return {
    async getFileHandle(name) {
      assert.match(name, /^[\w.-]+$/);
      const filename = path.join(root, name);
      return {
        getFile: () => fs.openAsBlob(filename),
        async createWritable() {
          const handle = await fsp.open(filename, "w");
          let closed = false;
          return {
            async write(value) {
              const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value;
              writes[name] = Math.max(writes[name] || 0, bytes.byteLength);
              let offset = 0;
              while (offset < bytes.byteLength) offset += (await handle.write(bytes, offset, bytes.byteLength - offset)).bytesWritten;
            },
            async close() {if (!closed) {closed = true; await handle.close();}},
            async abort() {if (!closed) {closed = true; await handle.close();}}
          };
        }
      };
    }
  };
}

async function hashFile(filename) {
  const digest = crypto.createHash("sha256");
  for await (const part of fs.createReadStream(filename)) digest.update(part);
  return digest.digest("hex");
}

test("real archive writer: >100 MiB, >16 MiB attachment, >2 MiB Unicode body and 50,001 messages retain every byte", {timeout: 180000}, async t => {
  const root = tempRoot(), writes = {}, dir = directory(root, writes), assetName = "assets/synthetic.bin";
  const pattern = Buffer.alloc(65536);
  for (let i = 0; i < pattern.length; i++) pattern[i] = (i * 13 + (i >>> 8)) & 255;
  const assetBytes = 101 * MiB + 19, asset = await dir.getFileHandle("source.bin"), assetWriter = await asset.createWritable();
  const assetHash = crypto.createHash("sha256");
  for (let offset = 0; offset < assetBytes; offset += pattern.length) {
    const part = pattern.subarray(0, Math.min(pattern.length, assetBytes - offset));
    await assetWriter.write(part); assetHash.update(part);
  }
  await assetWriter.close();
  const expectedAssetHash = assetHash.digest("hex");
  const meta = {id: "synthetic-large-thread", title: "Synthetic 潮汐 notebook", lineage: "tree", images: []};
  const archive = await ReaderArchive.writer(dir, meta);
  const longPart = "潮汐 🪐 — ordinary Unicode, delimiters: ] } \\\".\n".repeat(1000);
  const resourceLink = `\n[resource](${assetName})`;
  const longHash = crypto.createHash("sha256");
  let longBytes = 0;
  for (let i = 0; i < 50001; i++) {
    await archive.begin({id: "m" + i, role: i % 2 ? "assistant" : "user", sourcePath: ["n" + i],
      assets: i === 0 ? [assetName] : []});
    if (i === 0) {
      for (let j = 0; j < 64; j++) {
        await archive.text(longPart); longHash.update(longPart); longBytes += Buffer.byteLength(longPart);
      }
      await archive.text(resourceLink); longHash.update(resourceLink); longBytes += Buffer.byteLength(resourceLink);
    } else await archive.text("Message " + i + " · 潮汐");
    await archive.end();
  }
  assert.ok(longBytes > 2 * MiB);
  const progress = [];
  const result = await archive.finish(new Map([[assetName, asset]]), step => progress.push(step));
  assert.ok(result.size > 100 * MiB);
  assert.equal(meta.zipDigest, await hashFile(path.join(root, "import.zip")));
  assert.ok(progress.length > 100 && progress.every(p => p.stage === "package" && !("total" in p)));
  assert.equal(progress.at(-1).done, result.size);
  assert.ok(progress.every((p, i) => !i || p.done >= progress[i - 1].done));
  // This is bounded streaming, not a test adapter accumulating a giant archive in RAM.
  assert.ok(writes["import.zip"] <= ReaderArchive.CHUNK, JSON.stringify(writes));
  assert.ok(writes["body.tmp"] < ReaderArchive.CHUNK + Buffer.byteLength(longPart));

  const found = new Set(), outputs = new Map(), sizes = new Map(), observedAsset = crypto.createHash("sha256");
  let observedAssetBytes = 0;
  const unzip = new fflate.Unzip(file => {
    assert.ok(!found.has(file.name), "duplicate ZIP member " + file.name); found.add(file.name);
    assert.ok([assetName, "conversation.md", "reader/source.jsonl", "manifest.json"].includes(file.name));
    const output = file.name === assetName ? null : fs.openSync(path.join(root, file.name.replaceAll("/", "-")), "w");
    if (output !== null) outputs.set(file.name, output);
    file.ondata = (error, bytes, final) => {
      if (error) throw error;
      sizes.set(file.name, (sizes.get(file.name) || 0) + bytes.length);
      if (file.name === assetName) {
        observedAsset.update(bytes);
        let local = 0;
        while (local < bytes.length) {
          const offset = observedAssetBytes % pattern.length, n = Math.min(bytes.length - local, pattern.length - offset);
          assert.ok(Buffer.from(bytes.buffer, bytes.byteOffset + local, n).equals(pattern.subarray(offset, offset + n)),
            "attachment byte mismatch at " + observedAssetBytes);
          observedAssetBytes += n; local += n;
        }
      } else fs.writeSync(output, bytes);
      if (final && output !== null) {fs.closeSync(output); outputs.delete(file.name);}
    };
    file.start();
  });
  try {
    for await (const part of fs.createReadStream(path.join(root, "import.zip"), {highWaterMark: 65536})) unzip.push(part, false);
    unzip.push(new Uint8Array(), true);
  } finally {for (const handle of outputs.values()) fs.closeSync(handle);}
  assert.equal(found.size, 4); assert.equal(observedAssetBytes, assetBytes);
  assert.equal(observedAsset.digest("hex"), expectedAssetHash);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  let assetRoot = Buffer.alloc(32);
  for await (const part of fs.createReadStream(path.join(root, "source.bin"), {highWaterMark: ReaderArchive.CHUNK}))
    assetRoot = crypto.createHash("sha256").update(assetRoot).update(part).digest();
  assert.equal(manifest.assets[0].root, assetRoot.toString("hex"));
  assert.deepEqual(manifest.assets.map(a => a.path), [assetName]);
  assert.equal(manifest.partial, false);
  const md = await fsp.open(path.join(root, "conversation.md"), "r"), expectedLong = longHash.digest("hex");
  let count = 0;
  try {
    const lines = readline.createInterface({input: fs.createReadStream(path.join(root, "reader-source.jsonl")), crlfDelay: Infinity});
    for await (const line of lines) {
      const row = JSON.parse(line);
      assert.equal(row.id, "m" + count); assert.equal(row.parent, count ? "m" + (count - 1) : null);
      assert.deepEqual(row.source_path, ["n" + count]);
      assert.deepEqual(row.assets, count === 0 ? [assetName] : []);
      const body = Buffer.alloc(row.bytes), read = await md.read(body, 0, body.length, row.offset);
      assert.equal(read.bytesRead, row.bytes); assert.equal(sha(body), row.sha256);
      if (count === 0) {
        assert.equal(row.bytes, longBytes); assert.equal(row.sha256, expectedLong);
        assert.ok(body.subarray(-Buffer.byteLength(resourceLink)).equals(Buffer.from(resourceLink)),
          "declared attachment must have an actual exact resource link in its owning message");
      }
      else assert.equal(body.toString("utf8"), "Message " + count + " · 潮汐");
      count++;
    }
  } finally {await md.close();}
  assert.equal(count, 50001);
  t.diagnostic(JSON.stringify({evidence: root, archiveBytes: result.size, assetBytes, bodyBytes: longBytes,
    messages: count, sha256: meta.zipDigest, maximumWrites: writes}));
});

function uploadModel({loseChunk, loseFinish = false, rejectBinding = false, corruptChunk = false, badPackageDigest = false} = {}) {
  const bytes = Buffer.alloc(2 * 4 * MiB + 37);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const file = new Blob([bytes]), key = "same-authorized-key", binding = {
    size: file.size, sha256: badPackageDigest ? "0".repeat(64) : sha(bytes), project: null, excerpt: false
  };
  const authorizedBinding = JSON.stringify(binding);
  const calls = [], sent = [], acknowledged = [], steps = [], id = "synthetic-import-id";
  let offset = 0, accepted = false, finishCount = 0, lost = false;
  const response = value => ({json: async () => value});
  const request = async (route, options = {}) => {
    calls.push(route);
    if (route === "requests/" + key) return response({id: accepted ? id : null});
    if (route === "transfers/" + key) {
      const input = JSON.parse(options.body);
      if (rejectBinding || JSON.stringify(input) !== authorizedBinding)
        throw Object.assign(Error("READER_TRANSFER_BINDING_CHANGED"), {status: 409});
      return response({size: file.size, offset, chunk_bytes: 4 * MiB});
    }
    if (route === "transfers/" + key + "/chunks") {
      const start = Number(options.body.get("offset")), chunk = Buffer.from(await options.body.get("chunk").arrayBuffer());
      sent.push(start);
      assert.equal(start, offset, "client never retransmits acknowledged bytes");
      if (corruptChunk) chunk[0] ^= 1;
      if (sha(chunk) !== options.body.get("sha256")) throw Object.assign(Error("READER_TRANSFER_CHUNK_DIGEST"), {status: 422});
      assert.ok(chunk.equals(bytes.subarray(offset, offset + chunk.length)));
      offset += chunk.length; acknowledged.push(start);
      if (loseChunk === start && !lost) {lost = true; throw TypeError("Synthetic lost chunk response");}
      return response({size: file.size, offset});
    }
    if (route === "transfers/" + key + "/finish") {
      assert.equal(offset, file.size);
      finishCount++;
      if (sha(bytes) !== binding.sha256) throw Object.assign(Error("READER_TRANSFER_PACKAGE_DIGEST"), {status: 422});
      accepted = true;
      if (loseFinish && !lost) {lost = true; throw TypeError("Synthetic lost finish response");}
      return response({id});
    }
    throw Error("Unexpected endpoint " + route);
  };
  const run = () => ReaderUpload({request, key, file, binding, report: step => steps.push(step)});
  return {run, calls, sent, steps, binding, request, key, file, id,
    snapshot: () => ({offset, accepted, finishCount, acknowledged})};
}

test("upload response loss: query receipt first, resume same binding at durable offset, never duplicate a chunk", async () => {
  const model = uploadModel({loseChunk: 0});
  await assert.rejects(model.run(), /lost chunk response/);
  assert.deepEqual(model.calls, ["requests/same-authorized-key", "transfers/same-authorized-key", "transfers/same-authorized-key/chunks"]);
  assert.deepEqual(model.steps.map(s => s.done), [0], "lost acknowledgement must not inflate visible progress");
  const oldCalls = model.calls.length;
  assert.equal((await model.run()).id, model.id);
  assert.deepEqual(model.calls.slice(oldCalls, oldCalls + 2), ["requests/same-authorized-key", "transfers/same-authorized-key"]);
  assert.deepEqual(model.sent, [0, 4 * MiB, 8 * MiB]);
  assert.equal(model.steps[1].done, 4 * MiB);
  assert.equal(model.steps.at(-1).done, model.file.size);
  assert.equal(model.snapshot().finishCount, 1);
});

test("lost final receipt: next attempt only reads receipt, with no second begin, upload or finish", async () => {
  const model = uploadModel({loseFinish: true});
  await assert.rejects(model.run(), /lost finish response/);
  const previous = model.calls.length;
  assert.equal((await model.run()).id, model.id);
  assert.deepEqual(model.calls.slice(previous), ["requests/same-authorized-key"]);
  assert.equal(model.snapshot().finishCount, 1);
});

test("digest rejection and changed target/package binding stop immediately; no unsafe fallback", async () => {
  const badDigest = uploadModel({corruptChunk: true});
  await assert.rejects(badDigest.run(), e => e.status === 422 && /DIGEST/.test(e.message));
  assert.equal(badDigest.snapshot().offset, 0); assert.equal(badDigest.snapshot().finishCount, 0);
  assert.equal(badDigest.sent.length, 1);
  const changed = uploadModel({rejectBinding: true});
  await assert.rejects(changed.run(), e => e.status === 409 && /BINDING/.test(e.message));
  assert.equal(changed.calls.length, 2); assert.equal(changed.sent.length, 0);
  assert.equal(changed.snapshot().finishCount, 0);
  const badPackage = uploadModel({badPackageDigest: true});
  await assert.rejects(badPackage.run(), e => e.status === 422 && /PACKAGE_DIGEST/.test(e.message));
  assert.equal(badPackage.snapshot().accepted, false);
  assert.equal(badPackage.snapshot().finishCount, 1);
  const resumedWithChangedTarget = uploadModel({loseChunk: 0});
  await assert.rejects(resumedWithChangedTarget.run(), /lost chunk response/);
  resumedWithChangedTarget.binding.project = "another-project";
  await assert.rejects(resumedWithChangedTarget.run(), e => e.status === 409 && /BINDING/.test(e.message));
  assert.deepEqual(resumedWithChangedTarget.sent, [0]);
  assert.equal(resumedWithChangedTarget.snapshot().finishCount, 0);
});

test("impossible server offsets and mismatched acknowledgements are not interpreted as completion", async () => {
  for (const state of [
    {size: 3, offset: 4, chunk_bytes: 4},
    {size: 4, offset: 0, chunk_bytes: 4},
    {size: 3, offset: -1, chunk_bytes: 4},
    {size: 3, offset: 0, chunk_bytes: 0},
    {size: 3, offset: 0, chunk_bytes: 9 * MiB}
  ]) {
    const calls = [];
    await assert.rejects(ReaderUpload({key: "key", file: new Blob(["abc"]), binding: {size: 3},
      report: () => {}, request: async route => {calls.push(route); return {json: async () => calls.length === 1 ? {} : state};}}),
    /Invalid transfer receipt/);
    assert.equal(calls.length, 2);
  }
  const calls = [];
  await assert.rejects(ReaderUpload({key: "key", file: new Blob(["abc"]), binding: {size: 3},
    report: () => {}, request: async route => {
      calls.push(route);
      return {json: async () => calls.length === 1 ? {} : calls.length === 2
        ? {size: 3, offset: 0, chunk_bytes: 3} : {size: 3, offset: 2}};
    }}), /Unconfirmed Reader upload offset/);
  assert.equal(calls.length, 3);
});

test("progress throttling retains the last measured update during a stall, and announces phase changes immediately", async () => {
  const seen = [], reporter = ReaderProgress.throttle(step => seen.push(step), 20);
  reporter.update({stage: "source", done: 0});
  reporter.update({stage: "source", done: 40});
  reporter.update({stage: "source", done: 80});
  assert.deepEqual(seen, [{stage: "source", done: 0}]);
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.deepEqual(seen, [{stage: "source", done: 0}, {stage: "source", done: 80}]);
  reporter.update({stage: "index", done: 1});
  assert.deepEqual(seen.at(-1), {stage: "index", done: 1});
  reporter.update({stage: "index", done: 7});
  reporter.flush();
  assert.equal(seen.at(-1).done, 7);
  reporter.close();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(seen.length, 4);
});

test("phase changes flush the previous measured final counters before showing the new phase", () => {
  const seen = [], reporter = ReaderProgress.throttle(step => seen.push(step), 300);
  reporter.update({stage: "source", done: 0});
  reporter.update({stage: "source", done: 8 * MiB + 7});
  reporter.update({stage: "index", done: 64});
  assert.deepEqual(seen, [
    {stage: "source", done: 0}, {stage: "source", done: 8 * MiB + 7}, {stage: "index", done: 64}
  ]);
  reporter.update({stage: "asset", done: 0, total: 17 * MiB, files: 1});
  reporter.update({stage: "asset", done: 17 * MiB, total: 17 * MiB, files: 1});
  reporter.update({stage: "messages", done: 1});
  assert.deepEqual(seen.slice(-3), [
    {stage: "asset", done: 0, total: 17 * MiB, files: 1},
    {stage: "asset", done: 17 * MiB, total: 17 * MiB, files: 1},
    {stage: "messages", done: 1}
  ]);
  reporter.close();
});

test("source control shares real PageIndex semantics: virtual history keeps progress/receipt; actual edits and branches invalidate", async () => {
  const {JSDOM, VirtualConsole} = require("jsdom"), errors = [], console = new VirtualConsole();
  console.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<main data-current-node-id="leaf-1"><section data-testid="conversation-turn-1">' +
    '<p data-message-id="q1" data-message-author-role="user">Question</p>' +
    '<div data-message-id="a1" data-message-author-role="assistant">Stable answer</div>' +
    '</section></main>', {url: "https://chatgpt.com/c/synthetic", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: console});
  const w = dom.window, tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const observers = [], Observer = w.MutationObserver;
  w.MutationObserver = class extends Observer {constructor(callback) {super(callback); observers.push(this);}};
  let root, resolveCapture, publish, backend = {state: "save"}, lastAttempt;
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function(options) {return root = attach.call(this, options);};
  w.HTMLElement.prototype.getClientRects = function() {return this.isConnected ? [{}] : [];}; // JSDOM has no layout.
  w.chrome = {runtime: {id: "synthetic", onMessage: {addListener() {}},
    connect() {return {onMessage: {addListener() {}}, onDisconnect: {addListener() {}}, disconnect() {}};},
    async sendMessage(message) {
      lastAttempt = message.attempt;
      return backend.matchAttempt ? {state: message.attempt === "attempt-1" ? "saved" : "previous"} : backend;
    }}};
  try {
    w.eval(fs.readFileSync(path.join(__dirname, "../extension/source-dom.js"),"utf8"));
    for (const file of ["glyphs.js", "progress.js", "progress-view.js", "page-index.js", "source-control.js"])
      w.eval(fs.readFileSync(path.join(__dirname, "../reader", file), "utf8"));
    w.ReaderSourceControl({pathId: () => "synthetic", cancel() {},
      capture(start, excerpt, batch, progress) {
        w.ReaderPageIndex.sample(); start("attempt-1"); publish = progress;
        return new Promise(resolve => {resolveCapture = resolve;});
      }});
    await tick();
    root.querySelector(".main").onclick({isTrusted: true});
    publish({stage: "source", done: 1024});
    const before = w.ReaderPageIndex.sample();
    const old = w.document.createElement("section");
    old.dataset.testid = "conversation-turn-0";
    old.innerHTML = '<p data-message-id="older" data-message-author-role="user">Older history</p>';
    w.document.querySelector("main").prepend(old); await tick();
    const answer = w.document.querySelector('[data-message-id="a1"]'), parent = answer.parentNode;
    answer.remove(); await tick(); parent.append(answer); await tick();
    old.remove(); await tick(); w.document.querySelector("main").prepend(old); await tick();
    assert.equal(w.ReaderPageIndex.sample(), before);
    publish({stage: "source", done: 2048});
    assert.match(root.querySelector(".read-progress p").textContent, /2.0 KiB/);
    backend = {matchAttempt: true}; resolveCapture(); await tick();
    assert.equal(lastAttempt, "attempt-1");
    assert.match(root.querySelector(".main").textContent, /Saved to Reader/);
    w.document.querySelector("main").setAttribute("data-current-node-id", "leaf-2"); await tick();
    assert.match(root.querySelector(".main").textContent, /Open saved version/);
    backend = {state: "save"};
    // Reuse the existing menu command instead of exporting internals just for a test.
    root.querySelector(".toggle").onclick({isTrusted: true});
    [...root.querySelectorAll(".menu button")].find(button => button.textContent === "Check and save this version").onclick({isTrusted: true});
    publish({stage: "source", done: 4096});
    answer.textContent = "An actual same-message source edit."; await tick();
    assert.equal(root.querySelector(".read-progress").hidden, true);
    publish({stage: "source", done: 8192});
    assert.doesNotMatch(root.querySelector(".read-progress p").textContent, /8.0 KiB/);
    resolveCapture(); await tick();
    assert.deepEqual(errors, []);
  } finally {for (const observer of observers) observer.disconnect(); w.close();}
});
