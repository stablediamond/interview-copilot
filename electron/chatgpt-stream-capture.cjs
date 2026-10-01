// Reads the ChatGPT `conversation` Server-Sent Events response directly through
// Chrome DevTools Protocol (Network domain, read-only). This is the primary
// answer source: it does not depend on the page layout. DOM capture remains the
// fallback when this cannot attach or the stream is not recognized.

const CONVERSATION_PATH = /^\/backend-(?:api|anon)\/(?:f\/)?conversation$/;
const PARTS_PATH = /^\/message\/content\/parts\/(\d+)$/;
const HIDDEN_CHANNELS = new Set(['analysis', 'commentary']);
const TEXT_TYPES = new Set(['text', 'multimodal_text']);

// Copilot shows plain text; remove markdown syntax and ChatGPT's citation markers.
function markdownToPlain(value) {
  return String(value || '')
    .replace(/\ue200[^\ue201]*\ue201/g, '')
    .replace(/[\ue200-\ue206]/g, '')
    .replace(/^ {0,3}```[^\n]*\n?/gm, '')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\*\*([^*]+?)\*\*/g, '$1')
    .replace(/__([^_]+?)__/g, '$1')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .slice(0, 100000);
}

function createSseAnswerParser() {
  let buffer = '';
  const messages = [];
  let current = null;
  let lastPath = '';
  let events = 0;
  let done = false;

  const partsFrom = content => Array.isArray(content?.parts) ? content.parts.map(part => typeof part === 'string' ? part : '') : [];
  const fieldsFrom = message => ({
    id: message.id,
    role: message.author?.role,
    contentType: message.content?.content_type,
    channel: message.channel,
    recipient: message.recipient,
    status: message.status,
  });
  const startMessage = message => {
    current = { ...fieldsFrom(message), parts: partsFrom(message.content) };
    messages.push(current);
    lastPath = '';
  };
  const upsertSnapshot = message => {
    // Older protocol: every event carries the complete message so far.
    const existing = message.id ? messages.find(item => item.id === message.id) : null;
    if (!existing) { startMessage(message); return; }
    Object.assign(existing, fieldsFrom(message), { parts: partsFrom(message.content) });
    current = existing;
  };
  const applyOp = (path, op, value) => {
    lastPath = path;
    if (!current) return;
    const parts = PARTS_PATH.exec(path);
    if (parts) {
      const index = Number(parts[1]);
      const text = typeof value === 'string' ? value : '';
      if (op === 'append') current.parts[index] = (current.parts[index] || '') + text;
      else current.parts[index] = text;
    } else if (path === '/message/status') current.status = value;
    else if (path === '/message/channel') current.channel = value;
    else if (path === '/message/recipient') current.recipient = value;
    else if (path === '/message/content' && value && typeof value === 'object') {
      current.contentType = value.content_type ?? current.contentType;
      current.parts = partsFrom(value);
    } else if (path === '/message/content/content_type') current.contentType = value;
  };
  const handle = obj => {
    if (!obj || typeof obj !== 'object') return;
    events += 1;
    if (typeof obj.type === 'string' && !('v' in obj) && !obj.message) return;
    if (obj.message && typeof obj.message === 'object') { upsertSnapshot(obj.message); return; }
    if (!('v' in obj)) return;
    const { p, o, v } = obj;
    if (v && typeof v === 'object' && !Array.isArray(v) && v.message && typeof v.message === 'object') { startMessage(v.message); return; }
    if (Array.isArray(v)) {
      for (const item of v) if (item && typeof item === 'object') applyOp(String(item.p ?? lastPath), item.o || 'append', item.v);
      return;
    }
    if (p === undefined || p === '') { if (typeof v === 'string') applyOp(lastPath, 'append', v); return; }
    applyOp(String(p), o || 'append', v);
  };
  const handleBlock = block => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') { done = true; return; }
    try { handle(JSON.parse(data)); } catch { /* partial or unrelated event */ }
  };
  return {
    push(chunk) {
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop();
      blocks.forEach(handleBlock);
    },
    end() { if (buffer.trim()) { handleBlock(buffer); buffer = ''; } },
    // Final-answer messages only: no user echo, tool output, or reasoning.
    text() {
      const answer = messages
        .filter(m => m.role === 'assistant' && (!m.contentType || TEXT_TYPES.has(m.contentType))
          && !HIDDEN_CHANNELS.has(m.channel) && (!m.recipient || m.recipient === 'all'))
        .map(m => m.parts.join('')).filter(part => part.trim());
      return markdownToPlain(answer.join('\n\n')).trim();
    },
    get done() { return done; },
    get events() { return events; },
  };
}

function isConversationRequest(request) {
  if (request?.method !== 'POST') return false;
  try {
    const url = new URL(request.url);
    return (url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com')) && CONVERSATION_PATH.test(url.pathname);
  } catch { return false; }
}

// Attach just before sending the prompt so only the new response is observed.
function createChatgptStreamCapture(wc, log = () => {}) {
  const dbg = wc.debugger;
  const parser = createSseAnswerParser();
  const decoder = new TextDecoder('utf-8');
  const state = { text: '', done: false, failed: false, error: '', events: 0, active: false };
  let attachedHere = false, candidate = null, requestId = null, ready = false, finishing = false, streamFailed = false;
  let pending = [], listener = null, stopTimer = null, stopped = false;

  const publish = () => {
    state.text = parser.text();
    state.events = parser.events;
    if (parser.done) state.done = true;
    listener?.({ ...state });
  };
  const feed = base64 => {
    if (!base64) return;
    parser.push(decoder.decode(Buffer.from(base64, 'base64'), { stream: true }));
    publish();
  };
  const finish = async () => {
    if (streamFailed) {
      try {
        const body = await dbg.sendCommand('Network.getResponseBody', { requestId });
        parser.push(body.base64Encoded ? decoder.decode(Buffer.from(body.body, 'base64')) : body.body);
      } catch (error) { state.error = error instanceof Error ? error.message : 'Could not read response body.'; }
    } else parser.push(decoder.decode());
    parser.end();
    state.done = true;
    publish();
  };
  const onMessage = (_event, method, params) => {
    if (stopped) return;
    try {
      if (method === 'Network.requestWillBeSent' && !candidate && !params.redirectResponse && isConversationRequest(params.request)) {
        candidate = params.requestId;
      } else if (method === 'Network.responseReceived' && params.requestId === candidate && !requestId) {
        if (params.response?.status !== 200) { state.failed = true; state.error = `ChatGPT responded with HTTP ${params.response?.status}.`; publish(); return; }
        requestId = candidate;
        state.active = true;
        dbg.sendCommand('Network.streamResourceContent', { requestId })
          .then(result => feed(result?.bufferedData))
          .catch(() => { streamFailed = true; })
          .finally(() => {
            ready = true;
            const queued = pending; pending = [];
            queued.forEach(feed);
            if (finishing) finish();
          });
      } else if (method === 'Network.dataReceived' && params.requestId === requestId) {
        if (!ready) pending.push(params.data); else feed(params.data);
      } else if (method === 'Network.loadingFinished' && params.requestId === requestId) {
        if (ready) finish(); else finishing = true;
      } else if (method === 'Network.loadingFailed' && params.requestId === requestId) {
        state.failed = true;
        state.error = params.errorText || 'The ChatGPT response stream failed.';
        publish();
      }
    } catch (error) { log('GPT stream capture event error', error instanceof Error ? error.message : String(error)); }
  };
  const onDetach = (_event, reason) => {
    if (stopped) return;
    if (!state.done) { state.failed = true; state.error = `Debugger detached: ${reason}`; publish(); }
  };

  return {
    state,
    async start() {
      try {
        if (dbg.isAttached()) return false;
        dbg.attach('1.3');
        attachedHere = true;
        dbg.on('message', onMessage);
        dbg.on('detach', onDetach);
        await dbg.sendCommand('Network.enable');
        stopTimer = setTimeout(() => this.stop(), 12 * 60_000);
        return true;
      } catch (error) {
        log('GPT stream capture unavailable', error instanceof Error ? error.message : String(error));
        this.stop();
        return false;
      }
    },
    // Replays the current state so a late subscriber does not miss early data.
    subscribe(fn) {
      listener = fn;
      if (state.text || state.done || state.failed) fn({ ...state });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(stopTimer);
      listener = null;
      try { dbg.removeListener('message', onMessage); dbg.removeListener('detach', onDetach); } catch { /* destroyed */ }
      if (!attachedHere) return;
      try { dbg.sendCommand('Network.disable').catch(() => {}); } catch { /* detached */ }
      try { if (dbg.isAttached()) dbg.detach(); } catch { /* destroyed */ }
    },
  };
}

module.exports = { createSseAnswerParser, createChatgptStreamCapture, markdownToPlain, isConversationRequest };
