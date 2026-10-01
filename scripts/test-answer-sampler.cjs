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

  test('captures zero-role-attribute layouts by conversation headings and labels', () => {
    const baseline = readAnswer();
    const track = createTracker(baseline);
    append('<main><article><h5>You said:</h5><div>Question with no role attributes</div></article><div role="article"><h6>ChatGPT said:</h6><div class="markdown">Answer found through semantic headings</div><button data-testid="copy-turn-action-button">Copy</button></div></main>');
    equal(document.querySelectorAll('[data-message-author-role], [data-turn]').length, 0, 'Previously recognized role attributes are absent');
    const snapshot = readAnswer();
    equal(snapshot.userCount, 1, 'Semantic user is recognized');
    equal(snapshot.assistantCount, 1, 'Semantic assistant is recognized');
    equal(snapshot.roleSource, 'semantic', 'The structural fallback is reported');
    equal(track(snapshot)?.text, 'Answer found through semantic headings', 'Capture emits the answer');
    now += 3000;
    equal(track(readAnswer())?.done, true, 'The semantic response completes');
    document.body.innerHTML = '<main><div role="article" aria-label="You said:"><p>Labelled question</p></div><div class="agent-turn" aria-label="ChatGPT said:"><p>Labelled plain text answer</p></div></main>';
    equal(readAnswer().text, 'Labelled plain text answer', 'Accessible turn labels also identify an answer');
  });

  test('captures a submitted prompt and following answer with no turn metadata', () => {
    const expectedPrompt = 'Explain how to diagnose a slow application request and measure the improvement safely.';
    document.body.innerHTML = '<main><div class="markdown">An older answer must stay private</div></main><div class="ProseMirror" contenteditable="true"></div><button aria-label="Send message">Send</button>';
    const options = { expectedPrompt };
    const track = createTracker(readAnswer(options));
    document.querySelector('main').insertAdjacentHTML('beforeend', `<section><p>${expectedPrompt}</p></section><section><div class="markdown"><p>Measure each dependency first.</p><p>Compare latency percentiles.</p></div></section>`);
    const snapshot = readAnswer(options);
    equal(snapshot.roleSource, 'prompt-anchor', 'Submitted text identifies the turn');
    equal(snapshot.userCount, 1, 'Prompt anchor user count');
    equal(snapshot.assistantCount, 1, 'Only the following answer is considered');
    ok(snapshot.composerFound && snapshot.idleComposer, 'Alternate composer and send layouts match submission');
    const first = track(snapshot);
    ok(first?.text.includes('Measure each dependency first.'), 'The rendered answer is emitted');
    ok(!first.text.includes('older answer'), 'Prior answer is excluded');
    now += 3000;
    equal(track(readAnswer(options))?.done, true, 'Prompt fallback completion is detected');
  });

  test('prompt fallback supports normalized text and a distinctive collapsed prefix', () => {
    const expectedPrompt = 'Describe a reliable deployment strategy that includes database migration compatibility, health checks, and rollback planning for a distributed service.';
    document.body.innerHTML = `<main><section><p>${expectedPrompt.slice(0, 95)}…</p></section><div class="prose">Expand gradually after health checks pass.</div></main>`;
    equal(readAnswer({ expectedPrompt }).text, 'Expand gradually after health checks pass.', 'A sufficiently long collapsed prompt is recognized');
    document.body.innerHTML = '<main><p>Explain   this\n  result.</p><div class="prose">Normalized response.</div></main>';
    equal(readAnswer({ expectedPrompt: 'Explain this result.' }).text, 'Normalized response.', 'An exact short prompt supports whitespace normalization');
    document.body.innerHTML = '<main><p>Explain this…</p><div class="prose">Unrelated response.</div></main>';
    equal(readAnswer({ expectedPrompt: 'Explain this result.' }).text, '', 'A short ambiguous prefix is rejected');
  });

  test('prompt anchors support semantic assistant headings and keep identity through rerender', () => {
    const options = { expectedPrompt: 'Explain this mixed layout.' };
    document.body.innerHTML = '<main><article data-turn="user">A previous question</article><article data-turn="assistant"><div class="markdown">A previous answer</div></article></main>';
    const track = createTracker(readAnswer(options));
    document.querySelector('main').insertAdjacentHTML('beforeend', '<section class="new-question"><p>Explain this mixed layout.</p></section><article><h6>ChatGPT said:</h6><div class="markdown">Mixed layout answer.</div><button data-testid="copy-turn-action-button">Copy</button></article>');
    equal(track(readAnswer(options))?.text, 'Mixed layout answer.', 'An unmarked question supports a semantic assistant after older explicit turns');
    document.querySelector('.new-question').innerHTML = '<p>Explain this mixed layout.</p>';
    now += 3000;
    equal(track(readAnswer(options))?.done, true, 'A recreated prompt anchor retains its submission identity');
  });

  test('prompt anchor identity survives role attributes arriving with a replaced user node', () => {
    const options = { expectedPrompt: 'Describe the migration process.' };
    document.body.innerHTML = '<main></main>';
    const track = createTracker(readAnswer(options));
    document.querySelector('main').innerHTML = '<section class="pending"><p>Describe the migration process.</p></section><div class="markdown">Growing answer.</div><button data-testid="stop-button">Stop</button>';
    equal(track(readAnswer(options))?.text, 'Growing answer.', 'Initial unannotated answer is captured');
    document.querySelector('.pending').outerHTML = '<article data-message-author-role="user"><h5>You said:</h5><p>Describe the migration process.</p></article>';
    document.querySelector('.markdown').outerHTML = '<article data-message-author-role="assistant"><div class="markdown">Completed migration answer.</div><button data-testid="copy-turn-action-button">Copy</button></article>';
    document.querySelector('[data-testid="stop-button"]').remove();
    equal(track(readAnswer(options))?.text, 'Completed migration answer.', 'Annotated replacement remains bound to this submission');
    now += 3000;
    equal(track(readAnswer(options))?.done, true, 'The promoted turn completes');
    const unrelated = createTracker({ userKeys: [] });
    unrelated(readAnswer(options));
    document.querySelector('[data-message-author-role="user"]').innerHTML = '<p>A different question.</p>';
    // The real turn node remains the same here, so check the alias itself:
    ok(!readAnswer(options).userKeys.some(key => key.startsWith('prompt-position:')), 'Unrelated prompt text does not earn a submission alias');
  });

  test('prompt fallback excludes composer, sidebar, dialog, and unrelated content', () => {
    const options = { expectedPrompt: 'The submitted prompt' };
    document.body.innerHTML = '<aside><p>The submitted prompt</p><div class="markdown">Sidebar answer</div></aside><main><div class="markdown">Existing answer</div><nav><p>The submitted prompt</p><div class="prose">Navigation content</div></nav><div role="dialog"><p>The submitted prompt</p><div class="prose">Dialog answer</div></div><form><div contenteditable="true" role="textbox">The submitted prompt</div><div class="prose">Composer content</div></form></main>';
    let snapshot = readAnswer(options);
    equal(snapshot.userCount, 0, 'Copies outside the conversation do not establish a user turn');
    equal(snapshot.text, '', 'Unrelated content is never an answer');
    document.querySelector('main').insertAdjacentHTML('beforeend', '<section><p>The submitted prompt</p></section><div class="prose">Intended answer</div><section><p>A later unrelated question</p></section><div class="markdown">A later unrelated answer</div>');
    snapshot = readAnswer(options);
    equal(snapshot.text, 'Intended answer', 'An intervening question stops answer collection');
    document.body.innerHTML = '<p>The submitted prompt</p><div class="markdown">Unscoped page text</div>';
    equal(readAnswer(options).text, '', 'There is no whole-body prompt fallback');
  });

  test('prompt fallback does not reimport a baseline response or mistake answer echoes for users', () => {
    const options = { expectedPrompt: 'Repeat this question' };
    document.body.innerHTML = '<main><p>Repeat this question</p><div class="markdown"><p>Repeat this question</p><p>The existing answer.</p></div></main>';
    const snapshot = readAnswer(options);
    equal(snapshot.userCount, 1, 'Prompt echoes in markdown do not become new users');
    equal(createTracker(snapshot)(readAnswer(options)), null, 'The baseline response is not emitted');
    document.body.innerHTML = '<main><article><h5>You said:</h5><p>A previous question</p></article><article><h6>ChatGPT said:</h6><p>Repeat this question</p></article></main>';
    const semantic = readAnswer(options);
    equal(semantic.roleSource, 'semantic', 'A semantic assistant quoting a prompt does not become a prompt anchor');
    equal(semantic.userCount, 1, 'The previous user is still the only user');
  });

  test('zero-match diagnostics reveal document structure without message content', () => {
    document.body.innerHTML = '<main><section><p>Unrecognized private text</p></section><div class="prose">Unrecognized answer</div></main><iframe></iframe><div contenteditable="true" data-lexical-editor="true"></div><button id="composer-submit-button">Send</button>';
    const snapshot = readAnswer();
    equal(snapshot.userCount, 0, 'Missing user remains missing without a submitted prompt');
    equal(snapshot.text, '', 'Diagnostics do not enable arbitrary text capture');
    equal(snapshot.roleSource, 'none', 'No role recognition is reported honestly');
    equal(snapshot.markdowns, 1, 'Rendered markdown is counted');
    equal(snapshot.frames, 1, 'Frame count is available');
    ok(snapshot.bodyElements > 0 && typeof snapshot.readyState === 'string', 'Document structure is available');
    ok(snapshot.composerFound, 'Alternative composer is found');
    const metadata = { composerFound: snapshot.composerFound, articles: snapshot.articles, markdowns: snapshot.markdowns, bodyElements: snapshot.bodyElements, readyState: snapshot.readyState, frames: snapshot.frames, roleSource: snapshot.roleSource };
    ok(!JSON.stringify(metadata).includes('private'), 'Metadata contains no conversation text');
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

  test('the generic composer submit button does not imply idle while it means Stop', () => {
    seed();
    append(user(2, 'New question') + assistant(3, 'Still generating'));
    append('<div class="ProseMirror" contenteditable="true"></div><button id="composer-submit-button" aria-label="Stop">Stop</button>');
    const snapshot = readAnswer();
    ok(snapshot.activeStop, 'The generic composer button can be an active Stop control');
    equal(snapshot.idleComposer, false, 'Stop is not treated as an idle Send composer');
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
