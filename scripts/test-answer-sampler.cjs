const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readChatgptAnswer, createAnswerTracker } = require('../electron/chatgpt-answer-stream.cjs');

// Exercise the serialized guest code in Chromium, including real layout,
// document order, selector matching, and DOM replacement during rendering.
function runFixtures(readAnswer, createTracker) {
  const results = [];
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  const equal = (actual, expected, message) => {
    if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  };
  const ok = (condition, message) => { if (!condition) throw new Error(message); };
  const test = (name, fn) => {
    try { document.body.innerHTML = ''; now = 1000; fn(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: error.message }); }
  };
  const turn = (index, role, body, extra = '') => `<article data-testid="conversation-turn-${index}" data-turn="${role}" ${extra}>${body}</article>`;
  const user = (index, text, messageId = `u${index}`) => turn(index, 'user', `<div data-message-author-role="user"${messageId ? ` data-message-id="${messageId}"` : ''}>${text}</div>`);
  const assistant = (index, text, extra = '') => turn(index, 'assistant', `<div data-message-author-role="assistant" data-message-id="a${index}" ${extra}><div class="markdown">${text}</div></div>`);
  const seed = () => {
    document.body.innerHTML = user(0, 'Previous question') + assistant(1, 'Previous answer');
    return readAnswer();
  };
  const append = html => document.body.insertAdjacentHTML('beforeend', html);

  test('reads only the current answer and all answer markdown blocks', () => {
    seed();
    append(user(2, 'New question') + turn(3, 'assistant', '<div data-message-author-role="assistant" data-message-id="a3"><div class="markdown">First paragraph</div><div class="markdown">Second paragraph</div></div>'));
    const snapshot = readAnswer();
    equal(snapshot.userCount, 2, 'User turns');
    ok(snapshot.afterUser, 'The assistant follows the new user');
    equal(snapshot.text, 'First paragraph\n\nSecond paragraph', 'Complete answer text');
    ok(!snapshot.text.includes('Previous answer'), 'Previous answer must not be captured');
  });

  test('captures article data-turn layout without message-role attributes', () => {
    document.body.innerHTML = turn(0, 'user', 'Question') + turn(1, 'assistant', '<div class="markdown">Answer from article layout</div>');
    const snapshot = readAnswer();
    equal(snapshot.userCount, 1, 'User turn fallback');
    ok(snapshot.afterUser, 'Assistant turn fallback');
    equal(snapshot.text, 'Answer from article layout', 'Answer turn text');
  });

  test('keeps the submitted turn when its provisional ID is assigned and node is replaced', () => {
    const track = createTracker(seed());
    append(user(2, 'New question', ''));
    equal(track(readAnswer()), null, 'Wait for new assistant');
    document.querySelector('[data-testid="conversation-turn-2"] [data-message-author-role="user"]').setAttribute('data-message-id', 'confirmed-user-id');
    append(assistant(3, 'Growing answer'));
    const first = track(readAnswer());
    equal(first?.text, 'Growing answer', 'Capture survives assigned message ID');
    document.querySelector('[data-testid="conversation-turn-2"]').innerHTML = '<div data-message-author-role="user" data-message-id="replacement-user-id">New question</div>';
    document.querySelector('[data-testid="conversation-turn-3"] .markdown').textContent = 'Growing answer finished';
    equal(track(readAnswer())?.text, 'Growing answer finished', 'Capture survives node replacement');
    now += 3000;
    equal(track(readAnswer())?.done, true, 'Replaced turn completes');
  });

  test('binds a blank pending user turn before prompt text and IDs render', () => {
    const track = createTracker(seed());
    append(user(2, '', ''));
    equal(track(readAnswer()), null, 'Blank pending user is not an answer');
    document.querySelector('[data-testid="conversation-turn-2"]').innerHTML = '<div data-message-author-role="user" data-message-id="persisted-user">Rendered prompt text</div>';
    append(assistant(3, 'Answer to the pending prompt'));
    equal(track(readAnswer())?.text, 'Answer to the pending prompt', 'Blank pending user keeps its identity');
  });

  test('active stop control prevents completing a stable answer', () => {
    const track = createTracker(seed());
    append(user(2, 'New question') + assistant(3, 'Still generating', 'data-is-streaming="true"'));
    append('<button data-testid="stop-button">Stop</button>');
    document.querySelector('[data-testid="conversation-turn-3"]').insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button">Copy</button>');
    const snapshot = readAnswer();
    ok(snapshot.busy, 'Active Stop is busy');
    equal(snapshot.complete, false, 'Completion actions cannot override active Stop');
    equal(track(snapshot)?.done, false, 'First text update remains streaming');
    now += 10000;
    equal(track(readAnswer()), null, 'Stable text during active generation is not terminal');
  });

  test('requires a continuous idle period after generation actually stops', () => {
    const track = createTracker(seed());
    append(user(2, 'New question') + assistant(3, 'Stable answer'));
    append('<button data-testid="stop-button">Stop</button>');
    equal(track(readAnswer())?.done, false, 'Initial response is streaming');
    now += 10000;
    document.querySelector('[data-testid="stop-button"]').remove();
    equal(track(readAnswer()), null, 'Old stable text does not complete immediately when Stop disappears');
    now += 1500;
    append('<button data-testid="stop-button">Stop</button>');
    equal(track(readAnswer()), null, 'Generation resumed');
    document.querySelector('[data-testid="stop-button"]').remove();
    now += 500;
    equal(track(readAnswer()), null, 'The idle confirmation period restarts');
    now += 2400;
    equal(track(readAnswer()), null, 'The restarted idle period is still short');
    now += 200;
    equal(track(readAnswer())?.done, true, 'Continuous idle completes the response');
  });

  test('idle composer recovers from stale streaming metadata without response toolbar', () => {
    const track = createTracker(seed());
    append(user(2, 'New question') + assistant(3, 'Final answer', 'data-is-streaming="true"'));
    append('<div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button" disabled>Send</button>');
    const snapshot = readAnswer();
    ok(snapshot.idleComposer, 'The composer has switched back to Send');
    equal(track(snapshot)?.text, 'Final answer', 'Final answer is available');
    now += 3000;
    equal(track(readAnswer())?.done, true, 'Idle composer allows completion despite stale metadata');
  });

  test('hidden current-turn completion actions override stale streaming metadata', () => {
    const track = createTracker(seed());
    append(user(2, 'New question') + assistant(3, 'Completed answer', 'data-is-streaming="true"'));
    document.querySelector('[data-testid="conversation-turn-3"]').insertAdjacentHTML('beforeend', '<div style="display:none"><button data-testid="copy-turn-action-button">Copy</button></div>');
    append('<button data-testid="stop-button" hidden>Old Stop</button>');
    const snapshot = readAnswer();
    equal(snapshot.complete, true, 'Hidden toolbar still identifies a completed answer');
    equal(track(snapshot)?.text, 'Completed answer', 'Final text is captured');
    now += 3000;
    equal(track(readAnswer())?.done, true, 'Stale metadata no longer blocks completion');
  });

  test('does not use completion controls from the previous answer', () => {
    seed();
    document.querySelector('[data-testid="conversation-turn-1"]').insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button">Copy</button>');
    append(user(2, 'New question') + assistant(3, 'New answer', 'data-is-streaming="true"'));
    const snapshot = readAnswer();
    equal(snapshot.complete, false, 'Old toolbar does not complete new answer');
    ok(snapshot.busy, 'New answer is still marked streaming');
  });

  test('rejects old answers and later unrelated user turns', () => {
    const baseline = seed();
    const track = createTracker(baseline);
    equal(track(readAnswer()), null, 'Baseline response is not a new response');
    append(user(2, 'New question') + assistant(3, 'Submitted answer'));
    equal(track(readAnswer())?.text, 'Submitted answer', 'Intended answer is captured');
    append(user(4, 'Unrelated question') + assistant(5, 'Unrelated answer'));
    now += 3000;
    equal(track(readAnswer()), null, 'Later response is never attributed to this submission');
  });

  test('excludes reasoning panels and keeps the final response', () => {
    seed();
    append(user(2, 'New question') + turn(3, 'assistant', '<div data-message-author-role="assistant" data-message-id="a3"><div data-message-type="thought"><div class="markdown">Private thought text</div></div><div data-testid="reasoning"><div class="markdown">Reasoning panel text</div></div><div class="markdown">Final answer only</div></div>'));
    equal(readAnswer().text, 'Final answer only', 'Only answer content is shared');
  });

  test('does not duplicate nested markdown or include its nested reasoning subtree', () => {
    seed();
    append(user(2, 'New question') + turn(3, 'assistant', '<div data-message-author-role="assistant" data-message-id="a3"><div class="markdown"><div data-message-type="reasoning"><div class="prose">Reasoning should be excluded</div></div><div class="prose">Nested final answer</div></div></div>'));
    equal(readAnswer().text, 'Nested final answer', 'Nested markup is read once without reasoning');
  });

  Date.now = realNow;
  document.body.innerHTML = '<pre id="test-results"></pre>';
  document.getElementById('test-results').textContent = JSON.stringify(results);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-answer-dom-'));
try {
  const fixture = path.join(temporary, 'fixture.html');
  const script = `(${runFixtures})(${readChatgptAnswer}, ${createAnswerTracker});`;
  fs.writeFileSync(fixture, `<!doctype html><html><body><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
  const browser = process.env.CHROME_BIN || 'google-chrome';
  const output = execFileSync(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--disable-background-networking', `--user-data-dir=${path.join(temporary, 'profile')}`, '--dump-dom', '--virtual-time-budget=1000', pathToFileURL(fixture).href], { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
  const serialized = output.match(/<pre id="test-results">([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(serialized, 'Chromium did not return the fixture results');
  const results = JSON.parse(serialized.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}`);
  assert.equal(results.filter(result => !result.ok).length, 0, 'Answer DOM fixtures must pass');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
