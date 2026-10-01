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
const { sendChatgptPrompt } = require('../electron/chatgpt-send.cjs');
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

  await test('repeated identical prompt with label and button text is bound as a new turn', async () => {
    const expectedPrompt = 'Describe your experience leading a team. Include one concrete example of a conflict you resolved.';
    const turn = answer => `<div class="turn"><div class="bubble"><span class="sr-only">You said:</span><p>Describe your experience leading a team.</p><p>Include one concrete example of a conflict you resolved.</p><button>Edit message</button></div></div><div class="turn"><div class="body"><p>${answer}</p></div></div>`;
    await reset(`<main><div id="thread">${turn('Old answer one')}</div></main><div id="prompt-textarea" contenteditable="true"></div>`);
    const baseline = await sample({ expectedPrompt });
    assert.equal(baseline.promptMatches, 1);
    const track = createAnswerTracker(baseline);
    assert.equal(track(baseline), null);
    await evaluate(html => { document.getElementById('thread').insertAdjacentHTML('beforeend', html); }, turn('Fresh answer text'));
    const snapshot = await sample({ expectedPrompt });
    assert.equal(snapshot.promptMatches, 2);
    assert.equal(track(snapshot)?.text, 'Fresh answer text');
  });

  await test('fallback ignores ChatGPT status notices and waits until the responding notice ends', async () => {
    const expectedPrompt = 'Tell me about yourself.';
    await reset('<main><div id="thread"><div class="turn"><div class="bubble">Old prompt</div></div></div></main><div id="prompt-textarea" contenteditable="true"></div>');
    const baseline = await sample({ expectedPrompt });
    const track = createAnswerTracker(baseline);
    await evaluate(prompt => {
      document.getElementById('thread').insertAdjacentHTML('beforeend',
        `<div class="turn"><div class="bubble">${prompt}</div></div><div class="turn" id="reply"><h4 class="sr-only">Latest response</h4><div aria-live="polite">ChatGPT is responding</div><div>ChatGPT can make mistakes. Check important info.</div></div>`);
    }, expectedPrompt);
    let snapshot = await sample({ expectedPrompt });
    assert.equal(snapshot.text, '', 'Status text is not an answer');
    assert.equal(snapshot.busy, true);
    assert.equal(track(snapshot), null);
    await evaluate(() => {
      document.getElementById('reply').innerHTML = '<h4 class="sr-only">Latest response</h4><div><p>First paragraph.</p><p>Second paragraph.</p></div><div>ChatGPT can make mistakes. Check important info.</div>';
    });
    snapshot = await sample({ expectedPrompt });
    assert.equal(snapshot.text, 'First paragraph.\nSecond paragraph.');
    assert.equal(snapshot.busy, false);
    assert.equal(track(snapshot)?.done, false);
    now += 2500;
    assert.deepEqual(track(await sample({ expectedPrompt })), { text: 'First paragraph.\nSecond paragraph.', revision: 3, done: true });
  });

  await test('direct text insertion fills a contenteditable composer in one input event', async () => {
    await reset('<main></main><div id="prompt-textarea" contenteditable="true">old draft</div>');
    await evaluate(() => {
      window.inputs = 0;
      const composer = document.getElementById('prompt-textarea');
      composer.addEventListener('input', () => { window.inputs += 1; });
      composer.focus();
      const range = document.createRange();
      range.selectNodeContents(composer);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    wc.focus();
    const caption = 'Tell me about a time you resolved a conflict on your team.';
    const started = Date.now();
    await wc.insertText(caption);
    const state = await evaluate(() => ({ text: document.getElementById('prompt-textarea').innerText, inputs: window.inputs }));
    assert.equal(state.text, caption, 'The selected draft is replaced by the inserted text');
    assert.equal(state.inputs, 1, 'The composer sees one input event, not one per key');
    assert.ok(Date.now() - started < 2000);
  });

  // The suite freezes Date.now for tracker tests; sending logic needs real time.
  const realClock = async fn => {
    const frozen = Date.now;
    Date.now = () => Math.floor(performance.timeOrigin + performance.now());
    try { await fn(); } finally { Date.now = frozen; }
  };

  await test('send clicks a usable Send button immediately without pressing Enter', () => realClock(async () => {
    await reset('<main></main><div id="prompt-textarea" contenteditable="true">Tell me about your last project in detail</div><button id="send" data-testid="send-button">Send</button>');
    await evaluate(() => {
      window.clicks = 0;
      document.getElementById('send').addEventListener('click', () => { window.clicks += 1; });
    });
    const started = Date.now();
    const result = await sendChatgptPrompt(wc, 'Tell me about your last project', () => { throw new Error('Enter must not be needed'); });
    assert.equal(result.ok, true);
    assert.equal(await evaluate(() => window.clicks), 1, 'Send is clicked exactly once');
    assert.ok(Date.now() - started < 1000, `Send took ${Date.now() - started} ms`);
  }));

  await test('send presses a trusted Enter key immediately when the Send button is not usable', () => realClock(async () => {
    await reset('<main></main><div id="prompt-textarea" contenteditable="true">Enter submits this prompt</div><button data-testid="send-button" disabled>Send</button>');
    await evaluate(() => {
      window.enterKeys = 0;
      document.getElementById('prompt-textarea').addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        window.enterKeys += event.isTrusted ? 1 : 0;
        event.preventDefault();
        event.target.textContent = '';
      });
    });
    wc.focus();
    await evaluate(() => document.getElementById('prompt-textarea').focus());
    const result = await sendChatgptPrompt(wc, 'Enter submits this prompt', () => {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    }, 3000);
    assert.equal(result.ok, true);
    assert.equal(await evaluate(() => window.enterKeys), 1, 'One trusted Enter key was delivered');
    assert.ok(result.stats.enterMs < 250, `Enter was pressed after ${result.stats.enterMs} ms, with no extra waiting`);
  }));

  await test('send reports failure when the prompt never reaches the composer', () => realClock(async () => {
    await reset('<main></main><div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button>');
    const result = await sendChatgptPrompt(wc, 'This text never arrives', () => {}, 300);
    assert.equal(result.ok, false);
    assert.match(result.error, /did not confirm/);
  }));

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
