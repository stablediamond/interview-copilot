const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, globals = {}, modules = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, {
    exports, Request, Response, URL, URLSearchParams, AbortController, AbortSignal, TextDecoder, ReadableStream, Promise, setTimeout, clearTimeout,
    require: id => { assert.ok(modules[id], `Unexpected dependency: ${id}`); return modules[id]; }, ...globals,
  }, { filename: file });
  return exports;
}
const encoder = new TextEncoder();
const streamOf = chunks => new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk))); controller.close(); } });
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('SSE parser handles comments, multi-line data and chunk boundaries', () => {
  const { createSseParser } = load('src/lib/session-stream.ts');
  const received = [];
  const parse = createSseParser(item => received.push(item));
  const text = 'retry: 1000\n\n: ping\n\nevent: snapshot\ndata: {"a":\ndata: 1}\n\nevent: end\ndata: {}\n\n';
  for (let i = 0; i < text.length; i += 5) parse(text.slice(i, i + 5));
  assert.deepEqual(received.map(item => item.event), ['snapshot', 'end']);
  assert.equal(JSON.parse(received[0].data).a, 1);
});

test('readSessionStream delivers snapshots in order, sends the bearer token, and resolves on end', async () => {
  const calls = [];
  const { readSessionStream } = load('src/lib/session-stream.ts', {
    fetch: async (url, init) => { calls.push({ url, init }); return new Response(streamOf([event('snapshot', { n: 1 }), event('snapshot', { n: 2 }).slice(0, 12), event('snapshot', { n: 2 }).slice(12), event('end', { reconnect: true })]), { status: 200 }); },
  });
  const snapshots = [];
  let opened = 0;
  await readSessionStream({ url: '/stream', token: 'abc', signal: new AbortController().signal, onSnapshot: item => snapshots.push(item.n), onOpen: () => { opened += 1; } });
  assert.deepEqual(snapshots, [1, 2]);
  assert.equal(opened, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer abc');
  assert.equal(calls[0].init.headers.Accept, 'text/event-stream');
});

test('readSessionStream rejects on HTTP errors and server error events so the caller can fall back to polling', async () => {
  const failing = load('src/lib/session-stream.ts', { fetch: async () => Response.json({ error: 'Access revoked' }, { status: 403 }) });
  await assert.rejects(() => failing.readSessionStream({ url: '/s', token: null, signal: new AbortController().signal, onSnapshot() {} }), /Access revoked/);
  const broken = load('src/lib/session-stream.ts', { fetch: async () => new Response(streamOf([event('snapshot', { n: 1 }), event('error', { message: 'boom' })]), { status: 200 }) });
  const seen = [];
  await assert.rejects(() => broken.readSessionStream({ url: '/s', token: null, signal: new AbortController().signal, onSnapshot: item => seen.push(item.n) }), /boom/);
  assert.deepEqual(seen, [1]);
});

test('proxy forwards the stream with the bearer token and never exposes it in the URL', async () => {
  const calls = [];
  let configured = true;
  const route = load('src/app/api/calendar/shared-session/stream/route.ts', {
    fetch: async (url, init) => { calls.push({ url, init }); return new Response(streamOf([event('snapshot', { n: 1 })]), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }); },
  }, {
    '@/lib/api': { jsonError: (error, status) => Response.json({ ok: false, error }, { status }), handleRouteError: () => Response.json({ ok: false }, { status: 500 }) },
    '@/lib/access': { assertAccess: async () => {} },
    '@/lib/job-track': { getJobTrackUrl: () => 'https://job.test', isJobTrackConfigured: () => configured },
  });
  const url = 'http://localhost:3000/api/calendar/shared-session/stream?eventId=event-1&connectionId=tab&after=4&afterChange=9&token=ignored';
  const response = await route.GET(new Request(url, { headers: { authorization: 'Bearer valid' } }));
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-type').startsWith('text/event-stream'));
  assert.match(await response.text(), /"n":1/);
  assert.equal(calls[0].url, 'https://job.test/api/event-sessions/event-1/stream?connectionId=tab&after=4&afterChange=9');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer valid');
  assert.ok(!calls[0].url.includes('valid') && !calls[0].url.includes('ignored'));
  assert.equal((await route.GET(new Request(url))).status, 401);
  assert.equal((await route.GET(new Request('http://localhost:3000/api/calendar/shared-session/stream', { headers: { authorization: 'Bearer valid' } }))).status, 400);
  configured = false;
  assert.equal((await route.GET(new Request(url, { headers: { authorization: 'Bearer valid' } }))).status, 401);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}\n${error.stack}`); }
  }
  if (failed) process.exit(1);
  console.log('Session stream tests passed.');
})();
