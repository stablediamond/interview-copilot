const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.join(__dirname, '../src/components/shared-event-session.tsx');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Run the component's actual sharing effect with controllable IPC, requests, and
// timers so replay races do not rely on wall-clock sleeps or a running Electron.
function mount() {
  const replay = deferred(), effects = [], timers = new Map(), requests = [];
  let listener, timerId = 0, requestGate;
  const api = { chatgpt: {
    onAnswer: callback => { listener = callback; return () => { listener = null; }; },
    getAnswers: eventId => {
      assert.equal(eventId, 'event');
      assert.ok(listener, 'Live updates must be subscribed before requesting replay');
      return replay.promise;
    },
  }};
  const modules = {
    react: {
      useState: initial => [initial, () => {}], useRef: current => ({ current }),
      useCallback: fn => fn, useEffect: fn => effects.push(fn),
    },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    'next/link': { default: () => null },
    '@/lib/electron': { getElectronAPI: () => api },
    '@/lib/client': { apiFetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      if (requestGate) {
        const gate = requestGate;
        requestGate = null;
        gate.started.resolve();
        await gate.result.promise;
      }
      return { messages: [], changeCursor: 0, messageCursor: 0, participants: [] };
    }},
  };
  const context = {
    exports: {}, AbortSignal,
    require: name => { assert.ok(modules[name], `Unexpected dependency: ${name}`); return modules[name]; },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(source, context, { filename });
  context.exports.SharedEventSession({ event: { id: 'event' }, userId: 'user', calendarPath: '/', canEditMeeting: false });
  const cleanup = effects[0]();
  return {
    replay, requests, timers, cleanup,
    receive: update => listener(update),
    holdNextRequest: () => {
      requestGate = { started: deferred(), result: deferred() };
      return requestGate;
    },
    tick: async () => {
      assert.equal(timers.size, 1, 'Exactly one sharing timer should remain scheduled');
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      await fn();
    },
  };
}

const update = (revision, done = false, eventId = 'event') => ({
  eventId, streamId: 'stream', revision, done, text: `answer-${revision}`,
});

(async () => {
  const active = mount();
  active.receive(update(5));
  active.replay.resolve([update(3), update(12, true, 'other-event')]);
  await Promise.resolve();
  await active.tick();
  assert.equal(active.requests.length, 1);
  assert.equal(active.requests[0].revision, 5, 'Replay cannot overwrite a newer live revision');
  assert.equal(active.requests[0].body, 'answer-5');
  active.receive(update(5));
  active.receive(update(4));
  await active.tick();
  assert.equal(active.requests.length, 1, 'Already seen and older revisions must not be posted again');
  active.receive(update(6));
  await active.tick();
  assert.equal(active.requests[1].revision, 6);

  // A final answer arriving while an older request fails must survive and be
  // the revision retried, rather than getting discarded with the failed send.
  active.receive(update(7));
  const gate = active.holdNextRequest();
  const sending = active.tick();
  await gate.started.promise;
  active.receive(update(8, true));
  gate.result.reject(new Error('temporary failure'));
  await sending;
  await active.tick();
  assert.deepEqual(active.requests.map(r => r.revision), [5, 6, 7, 8]);
  assert.equal(active.requests.at(-1).done, true);
  assert.equal(active.requests.at(-1).body, 'answer-8');
  await active.tick();
  assert.equal(active.requests.length, 4, 'Successful latest revision should leave the pending queue');
  active.cleanup();

  const restored = mount();
  restored.replay.resolve([update(10, true)]);
  await Promise.resolve();
  await restored.tick();
  assert.equal(restored.requests.length, 1, 'A completed answer missed while unmounted must be restored');
  assert.equal(restored.requests[0].revision, 10);
  assert.equal(restored.requests[0].done, true);
  restored.cleanup();

  const departed = mount();
  departed.cleanup();
  departed.replay.resolve([update(9, true)]);
  await Promise.resolve();
  assert.equal(departed.requests.length, 0, 'Replay resolving after unmount must not post');
  assert.equal(departed.timers.size, 0, 'Unmount must cancel the sharing timer');
  console.log('Answer replay tests passed: subscribe-first, revision races, event isolation, latest retry, restored completion, and unmount cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
