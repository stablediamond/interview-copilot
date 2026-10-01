// Sending the composed prompt in ChatGPT's guest page. Kept free of Electron
// imports so it can be tested against a real WebContents fixture.

const CHATGPT_COMPOSER_SELECTORS = [
  "#prompt-textarea",
  '[data-testid="prompt-textarea"]',
  '[contenteditable="true"][data-lexical-editor="true"]',
  "div.ProseMirror[contenteditable='true']",
  '[contenteditable="true"][role="textbox"]',
];

/**
 * Guest-side probe, synchronous on purpose: no timers run inside the page, so
 * page timer throttling (hidden/occluded views) cannot slow the send. The main
 * process polls this. Clicks Send as soon as the composer holds `needle`.
 */
function probeChatgptSend(needle, composerSelectors, click) {
  const sendSelectors = [
    'button[data-testid="send-button"]',
    "#composer-submit-button",
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
  ];
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const pick = (selectors) => {
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) if (isVisible(el)) return el;
    }
    return null;
  };
  const composer = pick(composerSelectors);
  const value = composer ? String(composer.innerText || composer.value || "") : "";
  const want = String(needle || "").trim();
  const hasText = !want ? Boolean(value.trim()) : value.includes(want);
  const empty = !value.trim();
  if (!hasText) return { hasText: false, empty, composerFound: Boolean(composer) };
  const send = pick(sendSelectors);
  const ready = Boolean(send) && !send.disabled && send.getAttribute("aria-disabled") !== "true";
  if (ready && click) {
    send.click();
    return { hasText: true, empty, ready: true, clicked: true };
  }
  return { hasText: true, empty, ready, clicked: false, sendFound: Boolean(send) };
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const runProbe = (wc, needle, click) =>
  wc.executeJavaScript(
    `(${probeChatgptSend})(${JSON.stringify(needle)}, ${JSON.stringify(CHATGPT_COMPOSER_SELECTORS)}, ${click ? "true" : "false"})`,
    true
  );

/**
 * Click Send as soon as the composer holds the prompt. Polling happens here in
 * the main process (page timers may be throttled). If the Send button is still
 * not usable when the text is present, press Enter right away (a trusted key
 * event, which ChatGPT treats as send) and wait for the composer to clear.
 */
async function sendChatgptPrompt(wc, needle, pressEnter = () => {}, timeoutMs = 4000) {
  const started = Date.now();
  const stats = { polls: 0, textMs: null, enterMs: null };
  while (Date.now() - started < timeoutMs) {
    stats.polls += 1;
    const probe = await runProbe(wc, needle, stats.enterMs === null);
    const elapsed = Date.now() - started;
    if (probe.clicked) return { ok: true, stats: { ...stats, clickMs: elapsed } };
    if (probe.hasText) {
      if (stats.textMs === null) stats.textMs = elapsed;
      // The click above already ran in this probe and did not happen, so the
      // Send button is not usable right now: press Enter immediately (once).
      if (stats.enterMs === null) {
        stats.enterMs = elapsed;
        pressEnter();
      }
    } else if (stats.enterMs !== null && probe.empty) {
      // The composer cleared after Enter: ChatGPT consumed the prompt.
      return { ok: true, stats: { ...stats, clickMs: elapsed } };
    }
    await sleepMs(15);
  }
  return {
    ok: false,
    stats,
    error: "ChatGPT did not confirm prompt submission. Check the GPT tab before trying again.",
  };
}

module.exports = { CHATGPT_COMPOSER_SELECTORS, probeChatgptSend, runProbe, sendChatgptPrompt, sleepMs };
