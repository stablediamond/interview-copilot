const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createAnswerTracker, readChatgptAnswer } = require('../electron/chatgpt-answer-stream.cjs');
const source = fs.readFileSync(require.resolve('../electron/main.cjs'), 'utf8');
const start = source.indexOf('const { readChatgptAnswer, createAnswerTracker } = require(');
const end = source.indexOf('ipcMain.handle("chatgpt:submit"', start);
assert.ok(start > 0 && end > start);

async function main() {
  const timers = new Map(), handlers = new Map(), sent = [], logs = [];
  let now = 0, timerId = 0;
  const context = vm.createContext({
    URL, Date: { now: () => now },
    mainWindow: { webContents: { isDestroyed: () => false, send: (_name, payload) => sent.push(payload) } },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    log: (...args) => logs.push(args.join(' ')),
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const tracker = vm.runInContext(`(${createAnswerTracker})`, context);
  context.require = () => ({ readChatgptAnswer, createAnswerTracker: tracker });
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.capture = streamChatgptAnswer; globalThis.active = () => sharedAnswerActive; globalThis.changeAccount = () => { sharedAnswerAccountVersion++; sharedAnswerUpdates.clear(); };`, context);
  async function nextTimer() {
    const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || [];
    assert.ok(timer, 'Expected capture timer');
    timers.delete(id); now = timer.at;
    await timer.fn();
  }
  const baseline = { userCount: 1, userKey: 'old', userKeys: ['old'] };
  let sample = { userCount: 2, userKey: 'temporary', userKeys: ['temporary', 'turn2'], afterUser: false, text: '' };
  const wc = { isDestroyed: () => false, getURL: () => 'https://chatgpt.com/c/test', executeJavaScript: async () => sample };
  context.capture(wc, { eventId: 'event1', streamId: 'stream1' }, baseline);
  await nextTimer();
  sample = { ...sample, userKey: 'persisted', userKeys: ['persisted', 'turn2'], afterUser: true, text: 'Growing', busy: true, activeStop: true };
  await nextTimer();
  sample = { ...sample, text: 'Final answer', busy: false, activeStop: false, complete: true };
  for (let count = 0; context.active() && count < 15; count++) await nextTimer();
  assert.equal(context.active(), false);
  assert.deepEqual(sent.map(update => [update.text, update.done]), [['', false], ['Growing', false], ['Final answer', false], ['Final answer', true]]);
  const replay = handlers.get('chatgpt:get-answers');
  assert.equal(replay(null, 'event1')[0].text, 'Final answer');
  assert.equal(replay(null, 'event1')[0].done, true);
  assert.equal(replay(null, 'unrelated').length, 0);
  assert.ok(logs.some(line => line.includes('confirming-completion')));
  assert.ok(!logs.some(line => line.includes('Final answer') || line.includes('Growing')), 'Diagnostics must not log answers');

  context.capture({ ...wc, executeJavaScript: () => new Promise(() => {}) }, { eventId: 'event1', streamId: 'hung' }, baseline);
  const pending = nextTimer();
  await nextTimer();
  await pending;
  assert.equal(context.active(), false, 'A hung page read releases the capture lock');
  assert.equal(sent.at(-1).done, true);
  assert.match(sent.at(-1).error, /within 10 seconds/);

  context.capture(wc, { eventId: 'event1', streamId: 'account-change' }, baseline);
  context.changeAccount();
  const before = sent.length;
  await nextTimer();
  assert.equal(context.active(), false);
  assert.equal(sent.length, before, 'An old account capture must not emit into a new account');
  assert.equal(replay(null, 'event1').length, 0);
  console.log('Answer capture integration tests passed: incremental/final IPC, replay, event isolation, bounded page reads, account change, and text-free diagnostics.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
