// Serialized into the ChatGPT guest. Bind to the new user turn, rather than
// comparing rendered prompt text (which can contain labels or collapsed text).
function readChatgptAnswer() {
  const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
  const assistants = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const user = users.at(-1);
  const after = assistants.filter(el => user && (user.compareDocumentPosition(el) & 4));
  const assistant = after.at(-1);
  const id = el => el?.getAttribute('data-message-id') || el?.closest('[data-message-id]')?.getAttribute('data-message-id') || '';
  const visible = el => {
    if (!el || el.hidden || el.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const activeStop = [...document.querySelectorAll('[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]')]
    .some(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
  const turn = assistant?.closest('article, [data-testid^="conversation-turn-"]') || assistant;
  const hasCompletionActions = [...(turn?.querySelectorAll('[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], [data-testid="bad-response-turn-action-button"]') || [])].some(visible);
  const markedStreaming = Boolean(assistant?.closest('[data-is-streaming="true"]') || turn?.querySelector('[data-is-streaming="true"]'));
  const text = after.map(el => {
    const blocks = [...el.querySelectorAll('.markdown')];
    return (blocks.length ? blocks : [el]).map(block => String(block.innerText || block.textContent || '').trim()).join('\n\n');
  }).filter(Boolean).join('\n\n').slice(0, 100000);
  return {
    userCount: users.length,
    userKey: id(user) || user?.textContent || '',
    assistantKey: id(assistant) || `assistant-${assistants.length}`,
    afterUser: after.length > 0,
    text,
    busy: activeStop || (markedStreaming && !hasCompletionActions),
    complete: hasCompletionActions && !activeStop,
  };
}
function createAnswerTracker(baseline, now = Date.now()) {
  let lastText = '', lastChange = now, revision = 1, finished = false, boundUser = null;
  return snapshot => {
    if (finished) return null;
    const newTurn = snapshot.userCount > baseline.userCount || snapshot.userKey !== baseline.userKey;
    if (!newTurn || !snapshot.userKey) return null;
    // Ignore any later user turn: it belongs to another submission.
    if (boundUser !== null && snapshot.userKey !== boundUser) return null;
    boundUser = snapshot.userKey;
    if (!snapshot.afterUser || !snapshot.text) return null;
    const changed = snapshot.text !== lastText;
    if (changed) { lastText = snapshot.text; lastChange = Date.now(); }
    const done = (!snapshot.busy || snapshot.complete === true) && Date.now() - lastChange >= 2500;
    if (!changed && !done) return null;
    if (done) finished = true;
    return { text: lastText, revision: ++revision, done };
  };
}
module.exports = { readChatgptAnswer, createAnswerTracker };
