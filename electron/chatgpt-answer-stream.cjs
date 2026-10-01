// Serialized into the ChatGPT guest. Keep this self-contained: no Node APIs or
// closure dependencies are available inside the embedded browser.
function readChatgptAnswer(options = {}) {
  const turnSelector = 'article, [role="article"], [data-testid^="conversation-turn"], [data-turn-id], .agent-turn';
  const markdownSelector = '.markdown, .prose, [class*="markdown"]';
  const excludedSelector = 'form, textarea, input, [contenteditable="true"], #prompt-textarea, [data-testid="prompt-textarea"], [data-testid="composer"], nav, aside, [role="navigation"], [role="complementary"], dialog, [role="dialog"], script, style';
  const reasoningSelector = '[data-testid*="reasoning"], [data-message-type="reasoning"], [data-message-type="analysis"], [data-message-type="thought"], [class*="reasoning"], [aria-label*="Reasoning"]';
  const scopeSelector = 'main, [role="main"], [data-testid="conversation"], [data-testid="conversation-container"], #thread';
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const allowed = el => !el.closest(excludedSelector);
  const roleLabel = value => {
    const label = normalize(value).replace(/:$/, '').toLowerCase();
    if (/^(you(?: said)?|user(?: said)?|your message)$/.test(label)) return 'user';
    if (/^(chatgpt(?: said)?|assistant(?: said)?)$/.test(label)) return 'assistant';
    return '';
  };
  const turns = [...document.querySelectorAll(turnSelector)].filter(allowed);
  const semanticRole = el => {
    const label = roleLabel(el.getAttribute('aria-label'));
    if (label) return label;
    for (const heading of el.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
      if (heading.closest(turnSelector) !== el || heading.closest(`${markdownSelector}, ${reasoningSelector}`)) continue;
      const role = roleLabel(heading.textContent);
      if (role) return role;
    }
    return '';
  };
  let roleSource = 'none';
  let foundAttributeRoles = false, foundSemanticRoles = false;
  const collect = role => {
    const explicit = [...document.querySelectorAll(`[data-message-author-role="${role}"], [data-turn="${role}"]`)].filter(allowed);
    const semantic = turns.filter(el => semanticRole(el) === role && !explicit.some(other => el.contains(other) || other.contains(el)));
    foundAttributeRoles ||= explicit.length > 0;
    foundSemanticRoles ||= semantic.length > 0;
    roleSource = foundAttributeRoles && foundSemanticRoles ? 'mixed' : foundSemanticRoles ? 'semantic' : foundAttributeRoles ? 'attributes' : 'none';
    const roots = [...explicit, ...semantic].sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1);
    // Newer layouts put the role on the article; older ones put it on a child.
    // Use the child when both exist, so headings/actions are never answer text.
    return roots.filter(el => !roots.some(other => other !== el && el.contains(other)));
  };
  let users = collect('user');
  let assistants = collect('assistant');
  let user = users.at(-1);
  let promptScope = null;
  // Some layouts omit all role attributes. Bind to the submitted prompt inside
  // the conversation, never to a copy in the composer/sidebar or a whole page.
  const expectedPrompt = normalize(options.expectedPrompt);
  const matchesPrompt = value => expectedPrompt && (value === expectedPrompt || (expectedPrompt.length >= 80 && value.length >= 80 && value.length <= expectedPrompt.length + 4 && value.startsWith(expectedPrompt.slice(0, 80))));
  if (expectedPrompt) {
    const scopes = [...document.querySelectorAll(scopeSelector)].filter(allowed);
    const matches = [];
    for (const scope of scopes) {
      const candidates = [...scope.querySelectorAll('div, p, span, section, article, [role="article"]')].filter(el => {
        if (!allowed(el) || el.closest(`${markdownSelector}, ${reasoningSelector}`)) return false;
        if (el.querySelector(excludedSelector)) return false;
        if (users.some(message => message.contains(el) || el.contains(message))) return false;
        if (assistants.some(message => message.contains(el) || el.contains(message))) return false;
        if (user && !(user.compareDocumentPosition(el) & 4)) return false;
        const value = normalize(el.textContent);
        // Exact matching also supports short questions. A truncated long prompt
        // must retain a distinctive prefix, without absorbing the answer below.
        return matchesPrompt(value);
      });
      for (const el of candidates) {
        if (!candidates.some(other => other !== el && el.contains(other)) && !matches.includes(el)) matches.push(el);
      }
    }
    matches.sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1);
    const anchor = matches.at(-1);
    if (anchor) {
      user = anchor;
      users = [...users, ...matches];
      promptScope = user.closest(scopeSelector);
      roleSource = 'prompt-anchor';
    }
  }
  const conversationScope = promptScope || user?.closest(scopeSelector);
  let after = assistants.filter(el => user && (user.compareDocumentPosition(el) & 4) && (!conversationScope || conversationScope.contains(el)));
  if (promptScope) {
    const following = [...promptScope.querySelectorAll(markdownSelector)].filter(el => allowed(el) && !el.closest(reasoningSelector) && !el.contains(user) && (user.compareDocumentPosition(el) & 4));
    const blocks = following.filter(el => !following.some(other => other !== el && other.contains(el)));
    after = [];
    let preceding = user;
    for (const block of blocks) {
      const gap = document.createRange();
      gap.setStartAfter(preceding);
      gap.setEndBefore(block);
      const between = gap.cloneContents();
      between.querySelectorAll(`button, ${excludedSelector}, ${reasoningSelector}`).forEach(el => el.remove());
      between.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').forEach(el => { if (roleLabel(el.textContent) === 'assistant') el.remove(); });
      // A later question creates a text boundary. Do not attach its answer to
      // this submission merely because it also occurs after our prompt.
      if (normalize(between.textContent)) break;
      after.push(block);
      preceding = block;
    }
    assistants = after;
  }
  // Structure-only description (tag, role/test-id attributes, class tokens and
  // text length). Never includes page text, so it is safe to log.
  const describe = el => {
    const attrs = ['data-testid', 'data-turn', 'data-message-author-role', 'role']
      .map(name => el.getAttribute(name) ? `${name.replace('data-', '')}=${String(el.getAttribute(name)).slice(0, 40)}` : '').filter(Boolean);
    const classes = String(el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).map(name => name.slice(0, 24));
    return `${el.tagName.toLowerCase()}${attrs.length ? `[${attrs.join(',')}]` : ''}${classes.length ? `.${classes.join('.')}` : ''}#${normalize(el.textContent).length}`;
  };
  // The prompt was found but no markdown/role-marked answer exists. The page
  // layout changed, so read whatever visible content follows the prompt turn
  // (up to the conversation boundary) instead of waiting forever.
  let tailFallback = false;
  const outline = [];
  if (user && roleSource === 'prompt-anchor' && after.length === 0) {
    const stop = conversationScope || document.body;
    const tail = [];
    for (let node = user; node && node !== stop && node !== document.body; node = node.parentElement) {
      outline.push(`^${describe(node)}`);
      for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        outline.push(`+${describe(sibling)}`);
        if (!allowed(sibling) || sibling.matches('footer, [role="contentinfo"], script, style') || sibling.closest(reasoningSelector)) continue;
        if (users.some(message => sibling.contains(message))) continue;
        tail.push(sibling);
      }
    }
    if (tail.length) { after = tail; assistants = tail; tailFallback = true; }
  }
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
  if (conversationScope && expectedPrompt && user) {
    const copy = user.cloneNode(true);
    copy.querySelectorAll(`button, ${excludedSelector}`).forEach(el => el.remove());
    copy.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').forEach(el => { if (roleLabel(el.textContent) === 'user') el.remove(); });
    // Keep this alias when React replaces an unannotated prompt with its final
    // role-marked element. Only the matching submitted prompt earns the alias.
    if (promptScope || matchesPrompt(normalize(copy.textContent))) userKeys.push(`prompt-position:${nodeKey(conversationScope)}:${users.length}`);
  }
  const visible = el => {
    if (!el || el.hidden || el.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const enabled = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const activeStop = [...document.querySelectorAll('[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop response"], #composer-submit-button')]
    .filter(el => el.id !== 'composer-submit-button' || /stop/i.test(`${el.getAttribute('data-testid') || ''} ${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`))
    .some(el => visible(el) && enabled(el));
  // These actions are often hidden until hover (or while the GPT tab is hidden).
  // Their presence in THIS answer's turn is a completion signal; visibility is not.
  const completionSelector = '[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], [data-testid="bad-response-turn-action-button"]';
  const hasCompletionActions = [...(tailFallback ? after.flatMap(el => [...el.querySelectorAll(completionSelector)]) : turn?.querySelectorAll(completionSelector) || [])].some(enabled);
  const markedStreaming = Boolean(assistant?.closest('[data-is-streaming="true"]') || turn?.querySelector('[data-is-streaming="true"], .result-streaming'));
  const composer = document.querySelector('#prompt-textarea, [data-testid="prompt-textarea"], [data-testid="composer"] textarea, [contenteditable="true"][data-lexical-editor="true"], div.ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"]');
  const send = document.querySelector('button[data-testid="send-button"], #composer-submit-button, button[aria-label="Send prompt"], button[aria-label="Send message"]');
  const stopVariant = send && /stop/i.test(`${send.getAttribute('data-testid') || ''} ${send.getAttribute('aria-label') || ''} ${send.textContent || ''}`);
  const idleComposer = Boolean(composer && send && !stopVariant && !activeStop);
  const text = after.map(el => {
    if (el.closest(reasoningSelector)) return '';
    const blocks = [...(el.matches(markdownSelector) ? [el] : el.querySelectorAll(markdownSelector))]
      .filter(block => !block.closest(reasoningSelector));
    const outerBlocks = blocks.filter(block => !blocks.some(other => other !== block && other.contains(block)));
    if (outerBlocks.length) return outerBlocks.map(block => {
      const nonAnswerSelector = `button, ${excludedSelector}, ${reasoningSelector}`;
      if (!block.querySelector(nonAnswerSelector)) return String(block.innerText || block.textContent || '').trim();
      const copy = block.cloneNode(true);
      copy.querySelectorAll(nonAnswerSelector).forEach(node => node.remove());
      return String(copy.innerText || copy.textContent || '').trim();
    }).join('\n\n');
    // A turn-level fallback includes headings and controls; strip those before
    // extracting plain text. Never copy the enclosing conversation or prompt.
    const copy = el.cloneNode(true);
    copy.querySelectorAll(`button, ${excludedSelector}, ${reasoningSelector}`).forEach(node => node.remove());
    copy.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]').forEach(node => { if (roleLabel(node.textContent)) node.remove(); });
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
    composerFound: Boolean(composer),
    articles: turns.length,
    markdowns: document.querySelectorAll(markdownSelector).length,
    bodyElements: document.body?.querySelectorAll('*').length || 0,
    readyState: document.readyState,
    frames: document.querySelectorAll('iframe, frame').length,
    roleSource,
    tailFallback,
    roleNodes: document.querySelectorAll('[data-message-author-role], [data-message-id], [data-turn]').length,
    outline: text ? [] : outline.slice(0, 24),
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
