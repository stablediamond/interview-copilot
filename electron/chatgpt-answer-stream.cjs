// Serialized into the ChatGPT guest. Read only the assistant following the latest
// user turn; previous conversation answers must never enter the shared room.
function readChatgptAnswer() {
  const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
  const assistants = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const user = users.at(-1);
  const assistant = assistants.at(-1);
  const id = el => el?.getAttribute('data-message-id') || el?.closest('[data-message-id]')?.getAttribute('data-message-id') || '';
  return {
    userCount: users.length,
    userText: String(user?.textContent || "").trim(),
    userKey: id(user) || user?.textContent || '',
    assistantKey: id(assistant) || `assistant-${assistants.length}`,
    afterUser: Boolean(user && assistant && (user.compareDocumentPosition(assistant) & 4)),
    text: String(assistant?.querySelector('.markdown')?.innerText || assistant?.innerText || '').trim().slice(0, 100000),
    busy: Boolean(document.querySelector('[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], [data-is-streaming="true"]')),
  };
}
function createAnswerTracker(baseline, now = Date.now()) {
  let lastText = '', lastChange = now, revision = 1, finished = false;
  return snapshot => {
    if (finished) return null;
    const newTurn = snapshot.userCount > baseline.userCount || snapshot.userKey !== baseline.userKey;
    const matchesPrompt = !baseline.expectedPrompt || snapshot.userText?.replace(/\s+/g, " ").trim() === baseline.expectedPrompt.replace(/\s+/g, " ").trim();
    if (!matchesPrompt || !newTurn || !snapshot.afterUser || snapshot.assistantKey === baseline.assistantKey || !snapshot.text) return null;
    const changed = snapshot.text !== lastText;
    if (changed) { lastText = snapshot.text; lastChange = Date.now(); }
    const done = !snapshot.busy && Date.now() - lastChange >= 2500;
    if (!changed && !done) return null;
    if (done) finished = true;
    return { text: lastText, revision: ++revision, done };
  };
}
module.exports = { readChatgptAnswer, createAnswerTracker };
