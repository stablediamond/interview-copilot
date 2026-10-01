// Run with: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/test-answer-electron.cjs --no-sandbox --disable-gpu
// Uses only local fixtures and a temporary, isolated Electron profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) {
  console.error('Run this integration test with Electron (without ELECTRON_RUN_AS_NODE):\n  env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/test-answer-electron.cjs --no-sandbox --disable-gpu');
  process.exit(1);
}

const { app, BrowserWindow, WebContentsView } = require('electron');
const { readChatgptAnswer, createAnswerTracker } = require('../electron/chatgpt-answer-stream.cjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-answer-electron-'));
app.once('quit', () => fs.rmSync(temporary, { recursive: true, force: true }));
app.setPath('userData', path.join(temporary, 'profile'));
app.setPath('sessionData', path.join(temporary, 'session'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
const fixture = path.join(temporary, 'fixture.html');
fs.writeFileSync(fixture, '<!doctype html><html><head><meta charset="utf-8"><title>Local answer fixture</title></head><body><main id="conversation"></main></body></html>');

let window;
let guest;
let exitCode = 0;
const realNow = Date.now;
let now = 1000;
const timeout = setTimeout(() => {
  console.error('Electron answer integration test exceeded 45 seconds.');
  finish(1);
}, 45000);

function finish(code) {
  clearTimeout(timeout);
  Date.now = realNow;
  if (guest && !guest.webContents.isDestroyed()) guest.webContents.close();
  if (window && !window.isDestroyed()) window.destroy();
  fs.rmSync(temporary, { recursive: true, force: true });
  app.exit(code);
}

async function run() {
  await app.whenReady();
  window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { partition: 'answer-integration-fixture', nodeIntegration: false, contextIsolation: true, sandbox: true } });
  guest = new WebContentsView({ webPreferences: { partition: 'answer-integration-fixture', nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.contentView.addChildView(guest);
  guest.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  const wc = guest.webContents;
  wc.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(file|data|about):/.test(details.url) });
  });
  const evaluate = (fn, ...args) => wc.executeJavaScript(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`);
  // Match the production sampler: bypass main-world modifications of DOM APIs.
  const sample = (options = {}) => wc.executeJavaScriptInIsolatedWorld(1004, [{ code: `(${readChatgptAnswer})(${JSON.stringify(options)})` }]);
  const reset = async html => {
    await wc.loadFile(fixture);
    await evaluate(value => { document.body.innerHTML = value; }, html);
    now = 1000;
  };
  const test = async (name, fn) => {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { exitCode = 1; console.error(`FAIL ${name}\n${error.stack}`); }
  };
  Date.now = () => now;

  await test('heading-only guest turns produce incremental and final answers', async () => {
    await reset('<main id="conversation"><article><h5>You said:</h5><div>Previous question</div></article><article><h6>ChatGPT said:</h6><div class="markdown">Previous answer</div></article></main><div id="prompt-textarea" contenteditable="true"></div>');
    const baseline = await sample();
    assert.equal(baseline.userCount, 1);
    assert.equal(baseline.assistantCount, 1);
    const track = createAnswerTracker(baseline);
    assert.equal(track(baseline), null, 'The prior answer must not be replayed');
    await evaluate(() => {
      document.getElementById('conversation').insertAdjacentHTML('beforeend', '<article><h5>You said:</h5><div>Explain the new answer</div></article><article id="new-answer"><h6>ChatGPT said:</h6><div class="markdown">Growing</div></article>');
      document.body.insertAdjacentHTML('beforeend', '<button data-testid="stop-button">Stop</button>');
    });
    let snapshot = await sample();
    assert.equal(snapshot.userCount, 2);
    assert.equal(snapshot.assistantCount, 2);
    assert.equal(snapshot.afterUser, true);
    assert.equal(snapshot.activeStop, true);
    assert.deepEqual(track(snapshot), { text: 'Growing', revision: 2, done: false });
    await evaluate(() => { document.querySelector('#new-answer .markdown').textContent = 'Growing final answer'; });
    now += 1000;
    assert.deepEqual(track(await sample()), { text: 'Growing final answer', revision: 3, done: false });
    now += 10000;
    assert.equal(track(await sample()), null, 'A stable answer with an active Stop must remain streaming');
    await evaluate(() => {
      document.querySelector('[data-testid="stop-button"]').remove();
      document.getElementById('new-answer').insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button" hidden>Copy</button>');
    });
    snapshot = await sample();
    assert.equal(snapshot.complete, true);
    assert.equal(track(snapshot), null, 'Completion waits for a sustained idle interval');
    now += 2500;
    assert.deepEqual(track(await sample()), { text: 'Growing final answer', revision: 4, done: true });
  });

  await test('submitted prompt anchors an unannotated guest conversation', async () => {
    const expectedPrompt = 'Explain how this new prompt is answered.';
    await reset('<main id="conversation"><section><div>Previous question</div></section><section><div class="markdown">Previous answer</div></section></main>');
    const baseline = await sample({ expectedPrompt });
    assert.equal(baseline.userCount, 0, 'Unrelated text is not a submitted user turn');
    const track = createAnswerTracker(baseline);
    await evaluate(prompt => {
      const conversation = document.getElementById('conversation');
      const user = document.createElement('section');
      user.innerHTML = '<div></div>';
      user.firstElementChild.textContent = prompt;
      conversation.appendChild(user);
      conversation.insertAdjacentHTML('beforeend', '<section id="answer"><div class="markdown">Current answer only</div></section>');
    }, expectedPrompt);
    const snapshot = await sample({ expectedPrompt });
    assert.equal(snapshot.userCount, 1);
    assert.equal(snapshot.text, 'Current answer only');
    assert.equal(snapshot.afterUser, true);
    assert.deepEqual(track(snapshot), { text: 'Current answer only', revision: 2, done: false });
    now += 2500;
    assert.deepEqual(track(await sample({ expectedPrompt })), { text: 'Current answer only', revision: 3, done: true });
  });

  await test('prompt anchor falls back to following content when the answer has no markdown or role markers', async () => {
    const expectedPrompt = 'Explain the unmarked layout answer.';
    await reset('<main><div id="thread"><div class="turn"><div>Older question</div></div><div class="turn"><div>Older answer</div></div></div></main><div id="prompt-textarea" contenteditable="true"></div>');
    const baseline = await sample({ expectedPrompt });
    const track = createAnswerTracker(baseline);
    await evaluate(prompt => {
      const thread = document.getElementById('thread');
      const user = document.createElement('div');
      user.className = 'turn';
      user.innerHTML = '<div class="bubble"></div>';
      user.firstElementChild.textContent = prompt;
      thread.appendChild(user);
      thread.insertAdjacentHTML('beforeend', '<div class="turn"><div class="body"><p>Unmarked first line.</p><p>Second line.</p></div><button>Copy</button></div>');
      document.querySelector('main').insertAdjacentHTML('beforeend', '<footer>ChatGPT can make mistakes.</footer>');
    }, expectedPrompt);
    const snapshot = await sample({ expectedPrompt });
    assert.equal(snapshot.tailFallback, true);
    assert.ok(snapshot.text.includes('Unmarked first line.'));
    assert.ok(snapshot.text.includes('Second line.'));
    assert.ok(!snapshot.text.includes('Older answer'));
    assert.ok(!snapshot.text.includes('ChatGPT can make mistakes'));
    assert.ok(!snapshot.text.includes(expectedPrompt));
    assert.equal(track(snapshot)?.done, false);
    now += 2500;
    assert.equal(track(await sample({ expectedPrompt }))?.done, true);
  });

  await test('missing answer reports a text-free layout outline', async () => {
    const expectedPrompt = 'A prompt without any answer yet.';
    await reset('<main><div id="thread"><div class="turn"><div class="bubble">A prompt without any answer yet.</div></div><div class="turn"><div class="spacer"></div></div></div></main>');
    const snapshot = await sample({ expectedPrompt });
    assert.equal(snapshot.text, '');
    assert.ok(snapshot.outline.length > 0);
    assert.ok(!JSON.stringify(snapshot.outline).includes('prompt without'));
  });

  await test('zero-role diagnostics identify a loaded page without exposing content', async () => {
    await reset('<main><p>Private placeholder content</p></main><div id="prompt-textarea" contenteditable="true"></div>');
    const snapshot = await sample({ expectedPrompt: 'A prompt absent from the page' });
    assert.equal(snapshot.userCount, 0);
    assert.equal(snapshot.assistantCount, 0);
    assert.equal(snapshot.afterUser, false);
    assert.equal(snapshot.text, '');
    assert.equal(snapshot.composerFound, true);
    assert.equal(snapshot.readyState, 'complete');
    assert.equal(snapshot.articles, 0);
    assert.equal(snapshot.markdowns, 0);
    assert.ok(snapshot.bodyElements > 0);
    assert.equal(snapshot.frames, 0);
    assert.ok(!JSON.stringify(snapshot).includes('Private placeholder content'));
    const track = createAnswerTracker(snapshot);
    assert.equal(track(snapshot), null);
    assert.equal(track.status(), 'user-turn-not-found');
  });

  await test('isolated-world capture survives patched page-world DOM selectors', async () => {
    await reset('<main><article data-turn="user"><div data-message-author-role="user">New prompt</div></article><article data-turn="assistant"><div data-message-author-role="assistant"><div class="markdown">Answer from the actual guest</div></div><button data-testid="copy-turn-action-button" hidden>Copy</button></article></main>');
    await evaluate(() => {
      document.querySelectorAll = () => [];
      Document.prototype.querySelectorAll = () => [];
      Element.prototype.querySelectorAll = () => [];
    });
    const mainWorld = await wc.executeJavaScript(`(${readChatgptAnswer})()`);
    assert.equal(mainWorld.userCount, 0, 'The altered page world cannot locate message roles');
    assert.equal(mainWorld.assistantCount, 0);
    const isolated = await sample();
    assert.equal(isolated.userCount, 1);
    assert.equal(isolated.assistantCount, 1);
    assert.equal(isolated.text, 'Answer from the actual guest');
    assert.equal(isolated.complete, true);
  });

  if (!exitCode) console.log(`Electron ${process.versions.electron} guest integration tests passed; no external requests or signed-in profile used.`);
}

run().catch(error => { exitCode = 1; console.error(error.stack); }).finally(() => finish(exitCode));
