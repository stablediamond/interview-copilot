const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readChatgptAnswer } = require('../electron/chatgpt-answer-stream.cjs');

// Exercise the serialized guest-page reader, including visibility and turn scope.
function element(text, options = {}) {
  return {
    textContent: text, innerText: text, hidden: Boolean(options.hidden),
    disabled: Boolean(options.disabled),
    getAttribute: name => name === 'data-message-id' ? options.id || null : null,
    getClientRects: () => options.hidden ? [] : [{}],
    closest: selector => selector.includes('data-is-streaming') ? (options.streaming ? {} : null)
      : selector.startsWith('article') ? options.turn || null : null,
    querySelector: () => null,
    querySelectorAll: () => options.blocks || [],
    compareDocumentPosition: other => other.previous ? 2 : 4,
  };
}
let stop = element('', { hidden: true });
let completion = element('Copy');
let markedStreaming = true;
const turn = {
  querySelectorAll: () => completion ? [completion] : [],
  querySelector: () => markedStreaming ? {} : null,
};
const user = element('You said: Explain this', { id: 'u2' });
const previous = Object.assign(element('Previous answer'), { previous: true });
const answer = element('', { id: 'a2', turn, blocks: [element('First paragraph'), element('Second paragraph')] });
function sample() {
  return vm.runInNewContext(`(${readChatgptAnswer})()`, {
    document: { querySelectorAll: selector => selector.includes('role="user"') ? [user]
      : selector.includes('role="assistant"') ? [previous, answer] : [stop] },
    window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
  });
}
let result = sample();
assert.equal(result.text, 'First paragraph\n\nSecond paragraph');
assert.equal(result.busy, false, 'Hidden stop control and stale streaming metadata must not block completion');
assert.equal(result.complete, true);
stop = element('Stop');
assert.equal(sample().busy, true, 'Visible enabled stop control must keep generation active');
assert.equal(sample().complete, false);
stop = element('Stop', { disabled: true });
assert.equal(sample().complete, true, 'Disabled stop control is not active generation');
completion = null;
assert.equal(sample().busy, true, 'Current turn streaming marker still protects an unfinished answer');
markedStreaming = false;
assert.equal(sample().busy, false);
console.log('Answer sampler tests passed: turn isolation, all answer blocks, hidden/disabled stop controls, stale and active streaming markers.');
