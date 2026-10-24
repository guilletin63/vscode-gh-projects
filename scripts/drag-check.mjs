// Drags a board card (or, with --table, a table row) with real mouse input in the Extension
// Development Host and reports where it lands. Synthetic DOM drag events can't catch drags that
// Chromium cancels by itself; this can. WRITES to the sandbox (moves one item).
//
//   node scripts/drag-check.mjs "Draft: empty column copy" "In Progress" [--table]
//
// Chromium only keeps such a drag alive with interception on, so the drag data is captured and
// replayed through Input.dispatchDragEvent; the page still gets real dragstart/dragover/drop.
import { connectToWebview } from './cdp.mjs';
import { launchDevHost } from './devhost.mjs';
import { SANDBOX } from './scenarios.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const table = process.argv.includes('--table');
const [title = 'Draft: empty column copy', target = 'In Progress'] = args;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const host = await launchDevHost({
  needsToken: true,
  timeoutMs: 180_000,
  steps: [
    { command: 'ghProjects.openBoard', args: [{ project: SANDBOX, viewId: table ? 'PVTV_lAHOBCq4Uc4BoSUHzgMMTSw' : 'PVTV_lAHOBCq4Uc4BoSUHzgMNwQI' }] },
    { command: 'workbench.action.closeSidebar' },
  ],
});

/** CDP session that also collects Input.dragIntercepted events. */
async function session(url, onDrag) {
  const ws = new WebSocket(url);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Input.dragIntercepted') onDrag(m.params.data);
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message));
    else p.resolve(m.result);
  };
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => ws.close(),
  };
}

const { cdp, port, waitFor, close } = host;
try {
  await waitFor("!!document.querySelector('iframe.webview')");
  const wv = await connectToWebview(port);
  for (let i = 0; i < 60 && !(await wv.evaluate("(doc) => doc.querySelectorAll('.card, .item-row').length > 0")); i++) await sleep(500);
  if (table) {
    await wv.evaluate(`(doc) => {
      const select = doc.querySelector('.toolbar select[aria-label="Group by"]');
      select.value = [...select.options].find((o) => o.textContent === 'Status').value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }`);
  }
  await sleep(1500);
  // Where the item is and where it goes, in webview coordinates.
  const where = `(doc) => {
    const item = [...doc.querySelectorAll('.card, .item-row')].find((el) => (el.querySelector('.card-title, .row-title')?.textContent ?? '') === ${JSON.stringify(title)});
    const group = (el) => el?.closest('.column, tbody')?.querySelector('h2, .group-name')?.textContent;
    return { item, group, doc };
  }`;
  const rects = await wv.evaluate(`(doc) => {
    const { item, group } = (${where})(doc);
    const dest = [...doc.querySelectorAll('.column, tbody[data-group-id]')].find((el) => el.querySelector('h2, .group-name')?.textContent === ${JSON.stringify(target)});
    if (!item || !dest) return null;
    const a = item.getBoundingClientRect();
    const b = (dest.querySelector('.group-row') ?? dest).getBoundingClientRect();
    return { from: group(item), item: { x: a.left + Math.min(a.width / 2, 200), y: a.top + a.height / 2 }, dest: { x: b.left + Math.min(b.width / 2, 200), y: b.top + Math.min(b.height / 2, 60) } };
  }`);
  if (!rects) throw new Error(`"${title}" or "${target}" not found`);
  const frame = await cdp.evaluate(`(() => { const b = document.querySelector('iframe.webview').getBoundingClientRect(); return { x: b.left, y: b.top }; })()`);
  const a = { x: frame.x + rects.item.x, y: frame.y + rects.item.y };
  const b = { x: frame.x + rects.dest.x, y: frame.y + rects.dest.y };

  // Drag events the page sees, printed at the end.
  await wv.evaluate(`(doc) => {
    const w = doc.defaultView;
    w.__dnd = [];
    for (const t of ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend']) {
      doc.addEventListener(t, () => (w.__dnd.at(-1) === t ? null : w.__dnd.push(t)), true);
    }
    return true;
  }`);

  let data;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = await session(targets.find((t) => t.type === 'page' && t.url.includes('workbench')).webSocketDebuggerUrl, (d) => (data = d));
  // The webview is an out-of-process iframe: intercept on its target too.
  const frameTarget = await session(targets.find((t) => t.type === 'iframe' && t.url.startsWith('vscode-webview://')).webSocketDebuggerUrl, (d) => (data = d));
  await page.send('Input.setInterceptDrags', { enabled: true });
  await frameTarget.send('Input.setInterceptDrags', { enabled: true }).catch(() => undefined);

  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...a });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...a, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10, button: 'left', buttons: 1 });
    await sleep(50);
  }
  // The intercepted drag can take a moment to be reported.
  for (let i = 0; i < 20 && !data; i++) await sleep(100);
  console.log(`drag started: ${!!data}`);
  if (data) {
    for (const type of ['dragEnter', 'dragOver', 'dragOver']) {
      await page.send('Input.dispatchDragEvent', { type, ...b, data });
      await sleep(100);
    }
    console.log('drop target shown:', await wv.evaluate("(doc) => !!doc.querySelector('.drop-target')"));
    await page.send('Input.dispatchDragEvent', { type: 'drop', ...b, data });
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...b, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(3000);
  const after = await wv.evaluate(`(doc) => { const { item, group } = (${where})(doc); return group(item); }`);
  console.log(`events: ${(await wv.evaluate('(doc) => doc.defaultView.__dnd')).join(' ')}`);
  console.log(`${table ? 'group' : 'column'}: ${rects.from} -> ${after}`);
  page.close();
  frameTarget.close();
  wv.close();
  if (!data || after !== target) process.exitCode = 1;
} finally {
  cdp.close();
  close();
}
