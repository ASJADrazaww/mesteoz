// Temporary verification harness: drives headless Chrome over CDP in real time.
const BASE = 'http://127.0.0.1:9222';
const URL = 'http://127.0.0.1:3131/';

const targets = await (await fetch(`${BASE}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (!page) {
  console.log('NO_PAGE_TARGET');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const problems = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    problems.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
  }
});

await send('Page.navigate', { url: URL });
await wait(4000);

async function probe(label) {
  const expression = `JSON.stringify({
    editorCards: document.querySelectorAll('.editor-card').length,
    editorNames: [...document.querySelectorAll('.editor-card h3')].map(function (h) { return h.textContent; }),
    projectCards: document.querySelectorAll('.project-card').length,
    emptyStates: [...document.querySelectorAll('.empty-state h3')].map(function (h) { return h.textContent; }),
    revealTotal: document.querySelectorAll('.reveal').length,
    revealVisible: document.querySelectorAll('.reveal.visible').length,
    heroOpacity: getComputedStyle(document.querySelector('.hero-copy')).opacity,
    dashboardOpacity: getComputedStyle(document.querySelector('.dashboard-shell')).opacity,
    bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 0)
  })`;
  const res = await send('Runtime.evaluate', { expression, returnByValue: true });
  console.log(label, res.result.value);
}

await probe('AT_1280x900 ->');

// Simulate "all sections on screen at once" to check every reveal resolves.
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 6200, deviceScaleFactor: 1, mobile: false });
await wait(1500);
await probe('AT_1280x6200 ->');

// Back to a normal viewport, then scroll to the bottom like a real user.
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await wait(500);
await send('Runtime.evaluate', { expression: 'window.scrollTo(0, document.body.scrollHeight)' });
await wait(1500);
await probe('AFTER_SCROLL_BOTTOM ->');

console.log('CONSOLE_ERRORS:', JSON.stringify(problems));
ws.close();
process.exit(0);