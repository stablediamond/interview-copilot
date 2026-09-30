// Serialized into the ChatGPT guest. Keep this self-contained: no Node APIs or
// closure dependencies are available inside the embedded browser.
function readChatgptAnswer() {
  const turnSelector = 'article, [data-testid^="conversation-turn"], [data-turn-id]';
  const collect = role => {
    const roots = [...document.querySelectorAll(`[data-message-author-role="${role}"], [data-turn="${role}"]`)];
    // Newer layouts put the role on the article; older ones put it on a child.
    // Use the child when both exist, so headings/actions are never answer text.
    return roots.filter(el => !roots.some(other => other !== el && el.contains(other)));
  };
  const users = collect('user');
  const assistants = collect('assistant');
  const user = users.at(-1);
  const after = assistants.filter(el => user && (user.compareDocumentPosition(el) & 4));
  const assistant = after.at(-1);
  const turn = assistant?.closest(turnSelector) || assistant;

  // Message IDs can appear or change after the first render. Retain aliases for
  // the surrounding turn and the DOM node instead of binding to one transient ID.
  const stateKey = Symbol.for('interview-copilot.answer-nodes');
  const state = window[stateKey] || (window[stateKey] = { nodes: new WeakMap(), next: 0, documentId: crypto.randomUUID() });
  const nodeKey = el => {
    if (!el) return '';
    if (!state.nodes.has(el)) state.nodes.set(el, `node:${state.documentId}:${++state.next}`);
    return state.nodes.get(el);
  };
  const keys = el => {
    if (!el) return [];
    const container = el.closest(turnSelector) || el;
    const message = el.getAttribute('data-message-id') || el.closest('[data-message-id]')?.getAttribute('data-message-id');
    const turnId = container.getAttribute('data-turn-id') || container.id;
    const testId = container.getAttribute('data-testid');
    return [message && `message:${message}`, turnId && `turn:${turnId}`,
      testId?.startsWith('conversation-turn-') && `position:${testId}`,
      nodeKey(el), nodeKey(container)].filter(Boolean);
  };
  const userKeys = keys(user);
  const visible = el => {
    if (!el || el.hidden || el.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const enabled = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const activeStop = [...document.querySelectorAll('[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop response"]')]
    .some(el => visible(el) && enabled(el));
  // These actions are often hidden until hover (or while the GPT tab is hidden).
  // Their presence in THIS answer's turn is a completion signal; visibility is not.
  const completionSelector = '[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], [data-testid="bad-response-turn-action-button"]';
  const hasCompletionActions = [...(turn?.querySelectorAll(completionSelector) || [])].some(enabled);
  const markedStreaming = Boolean(assistant?.closest('[data-is-streaming="true"]') || turn?.querySelector('[data-is-streaming="true"], .result-streaming'));
  const composer = document.querySelector('#prompt-textarea, [data-testid="composer"] textarea');
  const idleComposer = Boolean(composer && document.querySelector('[data-testid="send-button"], #composer-submit-button[data-testid="send-button"], button[aria-label="Send prompt"]'));
  const reasoningSelector = '[data-testid*="reasoning"], [data-message-type="reasoning"], [data-message-type="analysis"], [data-message-type="thought"], [class*="reasoning"], [aria-label*="Reasoning"]';
  const text = after.map(el => {
    if (el.closest(reasoningSelector)) return '';
    const blocks = [...el.querySelectorAll('.markdown, .prose, [class*="markdown"]')]
      .filter(block => !block.closest(reasoningSelector));
    const outerBlocks = blocks.filter(block => !blocks.some(other => other !== block && other.contains(block)));
    if (outerBlocks.length) return outerBlocks.map(block => {
      if (!block.querySelector(reasoningSelector)) return String(block.innerText || block.textContent || '').trim();
      const copy = block.cloneNode(true);
      copy.querySelectorAll(reasoningSelector).forEach(node => node.remove());
      return String(copy.innerText || copy.textContent || '').trim();
    }).join('\n\n');
    // A turn-level fallback includes headings and controls; strip those before
    // extracting plain text. Never copy the enclosing conversation or prompt.
    const copy = el.cloneNode(true);
    copy.querySelectorAll(`button, h5, h6, ${reasoningSelector}`).forEach(node => node.remove());
    return String(copy.innerText || copy.textContent || '').trim();
  }).filter(Boolean).join('\n\n').slice(0, 100000);
  return {
    userCount: users.length,
    userKeys,
    userKey: userKeys[0] || '',
    assistantKey: keys(assistant)[0] || '',
    assistantCount: assistants.length,
    afterUser: after.length > 0,
    text,
    activeStop,
    markedStreaming,
    idleComposer,
    busy: activeStop || (markedStreaming && !hasCompletionActions),
    complete: hasCompletionActions && !activeStop,
  };
}
function createAnswerTracker(baseline, now = Date.now()) {
  let lastText = '', lastChange = now, revision = 1, finished = false, boundUser = null;
  let idleSince = null;
  let status = 'waiting-for-user-turn';
  const aliases = snapshot => snapshot.userKeys?.length ? snapshot.userKeys : [snapshot.userKey].filter(Boolean);
  const overlaps = (a, b) => a.some(key => b.includes(key));
  const baselineKeys = aliases(baseline);
  const track = snapshot => {
    if (finished) return null;
    const currentKeys = aliases(snapshot);
    if (!currentKeys.length) { status = 'user-turn-not-found'; return null; }
    if (boundUser) {
      if (!overlaps(currentKeys, boundUser)) { status = 'different-user-turn'; return null; }
      boundUser = [...new Set([...boundUser, ...currentKeys])];
    } else {
      if (overlaps(currentKeys, baselineKeys)) { status = 'waiting-for-user-turn'; return null; }
      boundUser = currentKeys;
    }
    if (!snapshot.afterUser || !snapshot.text) { status = 'waiting-for-answer-text'; idleSince = null; return null; }
    const changed = snapshot.text !== lastText;
    if (changed) { lastText = snapshot.text; lastChange = Date.now(); }
    // Require a continuous idle period, not just old/stable text. A thinking
    // pause must never finish an answer while the Stop control is still active.
    const idle = !snapshot.activeStop && (!snapshot.busy || snapshot.complete === true || snapshot.idleComposer === true);
    if (!idle) idleSince = null;
    else if (idleSince === null) idleSince = Date.now();
    const done = idleSince !== null && Date.now() - Math.max(lastChange, idleSince) >= 2500;
    status = done ? 'complete' : idle ? 'confirming-completion' : 'receiving-answer';
    if (!changed && !done) return null;
    if (done) finished = true;
    return { text: lastText, revision: ++revision, done };
  };
  track.status = () => status;
  return track;
}
module.exports = { readChatgptAnswer, createAnswerTracker };
