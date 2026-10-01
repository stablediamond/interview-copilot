// Times readChatgptAnswer (with a submitted prompt) on a synthetic long chat.
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/bench-answer-reader.cjs --no-sandbox --disable-gpu [turns...]
const { app, BrowserWindow, WebContentsView } = require('electron');
const { readChatgptAnswer } = require('../electron/chatgpt-answer-stream.cjs');

const build = turns => {
  const main = document.createElement('main');
  const thread = document.createElement('div');
  main.appendChild(thread);
  for (let i = 0; i < turns; i++) {
    thread.insertAdjacentHTML('beforeend', `<div class="turn"><div class="bubble"><p>Question number ${i} about system design and tradeoffs with several words in it.</p></div></div>`);
    let body = '';
    for (let p = 0; p < 6; p++) body += `<p>Paragraph ${p} of answer ${i} with <strong>bold</strong> and <code>code</code> and a long sentence that goes on about things.</p><ul><li>one item</li><li>another item</li></ul>`;
    thread.insertAdjacentHTML('beforeend', `<div class="turn"><div class="body"><div class="inner"><div class="deep">${body}</div></div></div></div>`);
  }
  document.body.appendChild(main);
};

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 900, height: 700 });
  const view = new WebContentsView({ webPreferences: { partition: 'bench-reader', sandbox: true, contextIsolation: true } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  const wc = view.webContents;
  const sizes = process.argv.slice(2).filter(arg => /^\d+$/.test(arg)).map(Number);
  const prompt = 'Tell me about a time you led a team through a conflict and what you learned. Please include concrete numbers and the outcome for the business.';
  for (const turns of sizes.length ? sizes : [20, 60]) {
    await wc.loadURL('data:text/html,<body></body>');
    wc.on('console-message', (_event, ...details) => console.log('PAGE', JSON.stringify(details).slice(0, 300)));
    await wc.executeJavaScript(`(${build})(${turns})`).catch(error => { throw new Error(`build: ${error.message}`); });
    const elements = await wc.executeJavaScript('document.body.querySelectorAll("*").length');
    for (const label of ['cold', 'warm']) {
      const started = Date.now();
      const result = await wc.executeJavaScriptInIsolatedWorld(1004, [{ code: `(${readChatgptAnswer})(${JSON.stringify({ expectedPrompt: prompt })})` }]);
      console.log(`BENCH turns=${turns} elements=${elements} ${label} ms=${Date.now() - started} users=${result.userCount}`);
    }
  }
}
run().catch(error => { console.error('BENCH FAIL', error.message); process.exitCode = 1; }).finally(() => setTimeout(() => app.exit(process.exitCode || 0), 100));
