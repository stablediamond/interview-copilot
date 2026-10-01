const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSseAnswerParser, createChatgptStreamCapture, markdownToPlain, isConversationRequest } = require('../electron/chatgpt-stream-capture.cjs');

const sse = (data, event = 'delta') => `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
const message = (role, parts, extra = {}) => ({ id: `${role}-1`, author: { role }, content: { content_type: 'text', parts }, status: 'in_progress', ...extra });
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('delta-encoded stream: add, shorthand append, explicit append and patch', () => {
  const parser = createSseAnswerParser();
  parser.push(sse('"v1"', 'delta_encoding'));
  parser.push(sse({ type: 'input_message', input_message: { author: { role: 'user' }, content: { parts: ['the question'] } } }, 'message'));
  parser.push(sse({ p: '', o: 'add', v: { message: message('user', ['the question']) }, c: 0 }));
  parser.push(sse({ p: '', o: 'add', v: { message: message('assistant', ['']) }, c: 1 }));
  parser.push(sse({ p: '/message/content/parts/0', o: 'append', v: 'Besides Python, I' }));
  parser.push(sse({ v: ' work' }));
  parser.push(sse({ v: ' with **SQL and T-SQL**.' }));
  assert.equal(parser.text(), 'Besides Python, I work with SQL and T-SQL.');
  parser.push(sse({ o: 'patch', v: [{ p: '/message/content/parts/0', o: 'append', v: ' Also `Bash`.' }, { p: '/message/status', o: 'replace', v: 'finished_successfully' }] }));
  assert.equal(parser.text(), 'Besides Python, I work with SQL and T-SQL. Also Bash.');
  assert.ok(!parser.text().includes('the question'), 'The user echo is never part of the answer');
  assert.equal(parser.done, false);
  parser.push('data: [DONE]\n\n');
  assert.equal(parser.done, true);
});

test('events split across arbitrary chunk boundaries', () => {
  const parser = createSseAnswerParser();
  const stream = sse({ p: '', o: 'add', v: { message: message('assistant', ['']) } }) + sse({ p: '/message/content/parts/0', o: 'append', v: 'Hello' }) + sse({ v: ' world' });
  for (let i = 0; i < stream.length; i += 7) parser.push(stream.slice(i, i + 7));
  assert.equal(parser.text(), 'Hello world');
});

test('reasoning, tool output and commentary are excluded; final channel messages are joined', () => {
  const parser = createSseAnswerParser();
  parser.push(sse({ p: '', o: 'add', v: { message: message('assistant', ['secret thoughts'], { channel: 'analysis' }) } }));
  parser.push(sse({ p: '', o: 'add', v: { message: { ...message('assistant', ['{"x":1}']), content: { content_type: 'thoughts', parts: ['hidden'] } } } }));
  parser.push(sse({ p: '', o: 'add', v: { message: message('tool', ['tool result']) } }));
  parser.push(sse({ p: '', o: 'add', v: { message: message('assistant', ['I will search.'], { channel: 'commentary' }) } }));
  parser.push(sse({ p: '', o: 'add', v: { message: message('assistant', ['Final answer'], { channel: 'final' }) } }));
  assert.equal(parser.text(), 'Final answer');
});

test('legacy full-snapshot events replace earlier text', () => {
  const parser = createSseAnswerParser();
  parser.push(sse({ message: message('assistant', ['Hel']), conversation_id: 'c' }, 'message'));
  parser.push(sse({ message: message('assistant', ['Hello there']), conversation_id: 'c' }, 'message'));
  assert.equal(parser.text(), 'Hello there');
});

test('markdown and citation markers become plain text', () => {
  assert.equal(markdownToPlain('## Title\n**Bold** and *it* and `code` [link](https://x.y)\u200ecite\ue200cite\ue202turn0search0\ue201'), 'Title\nBold and it and code link\u200ecite');
  assert.equal(markdownToPlain('```js\nconst a = 1;\n```'), 'const a = 1;\n');
  assert.equal(markdownToPlain('- one\n- two\n2 * 3 * 4'), '- one\n- two\n2 * 3 * 4');
});

test('only POST conversation requests are recognized', () => {
  const url = path => ({ method: 'POST', url: `https://chatgpt.com${path}` });
  assert.ok(isConversationRequest(url('/backend-api/conversation')));
  assert.ok(isConversationRequest(url('/backend-api/f/conversation')));
  assert.ok(!isConversationRequest(url('/backend-api/f/conversation/prepare')));
  assert.ok(!isConversationRequest(url('/backend-api/conversations?limit=20')));
  assert.ok(!isConversationRequest({ method: 'GET', url: 'https://chatgpt.com/backend-api/conversation' }));
  assert.ok(!isConversationRequest({ method: 'POST', url: 'https://evil.example/backend-api/conversation' }));
});

function fakeWebContents({ streamFails = false, buffered = '' } = {}) {
  const dbg = new EventEmitter();
  const calls = [];
  let attached = false;
  dbg.isAttached = () => attached;
  dbg.attach = () => { attached = true; };
  dbg.detach = () => { attached = false; };
  dbg.sendCommand = async (method, params) => {
    calls.push(method);
    if (method === 'Network.streamResourceContent') {
      if (streamFails) throw new Error('unsupported');
      return { bufferedData: Buffer.from(buffered).toString('base64') };
    }
    if (method === 'Network.getResponseBody') return { body: Buffer.from(streamFails.body || '').toString('base64'), base64Encoded: true };
    return {};
  };
  const emit = (method, params) => dbg.emit('message', {}, method, params);
  return { wc: { debugger: dbg }, dbg, calls, emit, isAttached: () => attached };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const chunk = text => Buffer.from(text).toString('base64');
const request = { method: 'POST', url: 'https://chatgpt.com/backend-api/f/conversation' };

test('capture streams buffered and live data in order, finishes on loadingFinished, then detaches', async () => {
  const fake = fakeWebContents({ buffered: sse({ p: '', o: 'add', v: { message: message('assistant', ['']) } }) + sse({ p: '/message/content/parts/0', o: 'append', v: 'One' }) });
  const capture = createChatgptStreamCapture(fake.wc);
  assert.equal(await capture.start(), true);
  const updates = [];
  capture.subscribe(update => updates.push(update));
  fake.emit('Network.requestWillBeSent', { requestId: 'other', request: { method: 'POST', url: 'https://chatgpt.com/backend-api/f/conversation/prepare' } });
  fake.emit('Network.requestWillBeSent', { requestId: 'r1', request });
  fake.emit('Network.responseReceived', { requestId: 'r1', response: { status: 200 } });
  // Data that arrives before the buffered response is processed must stay ordered.
  fake.emit('Network.dataReceived', { requestId: 'r1', data: chunk(sse({ v: ' Two' })) });
  await tick();
  fake.emit('Network.dataReceived', { requestId: 'r1', data: chunk(sse({ v: ' Three' })) });
  fake.emit('Network.loadingFinished', { requestId: 'r1' });
  await tick();
  const last = updates.at(-1);
  assert.equal(last.text, 'One Two Three');
  assert.equal(last.done, true);
  assert.ok(updates.slice(0, -1).every(update => !update.done));
  capture.stop();
  assert.equal(fake.isAttached(), false);
  assert.ok(fake.calls.includes('Network.disable'));
});

test('a stream-resource failure falls back to reading the finished response body', async () => {
  const body = sse({ p: '', o: 'add', v: { message: message('assistant', ['Whole body answer']) } });
  const fake = fakeWebContents({ streamFails: Object.assign(true, {}) });
  fake.wc.debugger.sendCommand = async (method) => {
    if (method === 'Network.streamResourceContent') throw new Error('unsupported');
    if (method === 'Network.getResponseBody') return { body: Buffer.from(body).toString('base64'), base64Encoded: true };
    return {};
  };
  const capture = createChatgptStreamCapture(fake.wc);
  await capture.start();
  const updates = [];
  capture.subscribe(update => updates.push(update));
  fake.emit('Network.requestWillBeSent', { requestId: 'r1', request });
  fake.emit('Network.responseReceived', { requestId: 'r1', response: { status: 200 } });
  fake.emit('Network.loadingFinished', { requestId: 'r1' });
  await tick(); await tick();
  assert.equal(updates.at(-1).text, 'Whole body answer');
  assert.equal(updates.at(-1).done, true);
  capture.stop();
});

test('non-200 responses and an already attached debugger are reported without capturing', async () => {
  const fake = fakeWebContents();
  const capture = createChatgptStreamCapture(fake.wc);
  await capture.start();
  const updates = [];
  capture.subscribe(update => updates.push(update));
  fake.emit('Network.requestWillBeSent', { requestId: 'r1', request });
  fake.emit('Network.responseReceived', { requestId: 'r1', response: { status: 429 } });
  assert.equal(updates.at(-1).failed, true);
  assert.equal(updates.at(-1).text, '');
  capture.stop();

  const busy = fakeWebContents();
  busy.dbg.attach();
  const second = createChatgptStreamCapture(busy.wc);
  assert.equal(await second.start(), false);
  assert.equal(busy.isAttached(), true, 'A debugger owned by someone else is never detached');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed += 1; console.error(`FAIL ${name}\n${error.stack}`); }
  }
  if (failed) process.exit(1);
  console.log('Stream capture tests passed.');
})();
