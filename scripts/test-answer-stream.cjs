const assert = require('node:assert/strict');
const { createAnswerTracker } = require('../electron/chatgpt-answer-stream.cjs');
const realNow = Date.now;
let now = 1000;
Date.now = () => now;
try {
  const baseline = { userCount: 1, userKey: 'u1', assistantKey: 'a1' };
  const track = createAnswerTracker(baseline);
  assert.equal(track({ ...baseline, text: 'Old answer', afterUser: true, busy: false }), null);
  const next = { userCount: 2, userKey: 'u2', assistantKey: 'a2', afterUser: true, busy: true, activeStop: true, text: 'Hello' };
  assert.equal(track({ ...next, afterUser: false }), null);
  assert.deepEqual(track(next), { text: 'Hello', revision: 2, done: false });
  assert.equal(track(next), null);
  assert.equal(track({ ...next, userKey: 'unrelated-user', text: 'Another conversation' }), null);
  assert.equal(track.status(), 'different-user-turn');
  now += 1000;
  assert.deepEqual(track({ ...next, text: 'Hello world' }), { text: 'Hello world', revision: 3, done: false });
  now += 30_000;
  assert.equal(track({ ...next, text: 'Hello world' }), null, 'A long thinking pause is still generating');
  const idle = { ...next, text: 'Hello world', busy: false, activeStop: false };
  assert.equal(track(idle), null, 'Stable text alone is not enough; wait for sustained idle');
  now += 2500;
  assert.deepEqual(track(idle), { text: 'Hello world', revision: 4, done: true });
  assert.equal(track({ ...next, text: 'Later unrelated answer' }), null);

  const rebound = createAnswerTracker(baseline);
  const pending = { ...next, userKeys: ['node:2', 'position:conversation-turn-3'], userKey: 'node:2', text: '', afterUser: false };
  assert.equal(rebound(pending), null);
  const assigned = { ...next, userKeys: ['message:u2', 'position:conversation-turn-3'], text: 'Final answer', busy: false, activeStop: false, complete: true };
  assert.deepEqual(rebound(assigned), { text: 'Final answer', revision: 2, done: false }, 'Late message ID and replaced inner node must retain the same turn');
  now += 2500;
  assert.equal(rebound(assigned).done, true);

  const streaming = createAnswerTracker(baseline);
  assert.equal(streaming({ ...next, complete: true }).done, false, 'Visible Stop overrides completion actions');
  now += 5000;
  assert.equal(streaming({ ...next, complete: true }), null);
  const staleMarker = { ...next, activeStop: false, idleComposer: true };
  assert.equal(streaming(staleMarker), null, 'Composer returning to Send can recover stale streaming metadata');
  now += 1500;
  assert.equal(streaming({ ...next }), null, 'Resuming generation resets the idle interval');
  now += 1500;
  assert.equal(streaming(staleMarker), null);
  now += 2500;
  assert.equal(streaming(staleMarker).done, true);
  console.log('Answer stream tests passed: turn identity upgrades, previous/unrelated answer isolation, incremental revisions, sustained idle, active generation, and completion.');
} finally { Date.now = realNow; }
