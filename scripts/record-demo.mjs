// Records short GIF demos of the extension in an Extension Development Host.
//
//   node scripts/record-demo.mjs --demo open|move|filter|detail|all [--out docs/media]
//
// The pointer moves with real CDP mouse events. Clicks in the workbench (the tree) are real CDP
// clicks; inside the board webview CDP clicks arrive incomplete (the first one only focuses the
// iframe, later ones lose their mouseup), so there the demo dispatches the DOM events a click or a
// key press produces (click(), input, keydown, dragstart/dragover/drop). The pointer, click
// ripples and the dragged card's ghost are drawn onto the frames by scripts/make-gif.py.
//
// Every demo uses the SANDBOX project from scripts/scenarios.mjs. `move` and `detail` WRITE to it
// (a Status and a Priority change); reset them afterwards if you want to record again.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { connectToWebview } from './cdp.mjs';
import { launchDevHost } from './devhost.mjs';
import { SANDBOX } from './scenarios.mjs';

const { values } = parseArgs({
  options: {
    demo: { type: 'string', default: 'all' },
    out: { type: 'string', default: 'docs/media' },
    theme: { type: 'string', default: 'dark' },
  },
});
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const outDir = resolve(root, values.out);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIDTH = 1280;
const HEIGHT = 800;

const statusBarCounter = "[id=\"guilletin63.vscode-gh-projects.ghProjects.inProgress\"]";

/** One recording session: dev host + frame capture + pointer state. */
async function session({ steps }) {
  const host = await launchDevHost({
    theme: values.theme === 'light' ? 'light' : 'dark',
    needsToken: true,
    projectFilter: SANDBOX.title,
    steps,
    width: WIDTH,
    height: HEIGHT,
    // Native density (Retina = 2): with an emulated density of 1, captures briefly restore the
    // real one and mouse presses landing in that window are hit-tested at twice the coordinates.
    scale: 2,
    timeoutMs: 240_000,
  });
  const { cdp, port } = host;
  const frames = [];
  const pointer = { x: WIDTH / 2, y: HEIGHT / 2, visible: false };
  const events = []; // clicks and ghost spans, in ms since start
  let recording = false;
  let t0 = 0;
  let webview;

  const now = () => Date.now() - t0;

  async function captureLoop() {
    while (recording) {
      const r = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 88,
        clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 0.5 },
      });
      frames.push({ t: now(), data: r.data, pointer: { ...pointer } });
    }
  }

  const api = {
    cdp,
    host,
    async start() {
      t0 = Date.now();
      recording = true;
      api.loop = captureLoop();
    },
    async stop() {
      recording = false;
      await api.loop;
    },
    async webview() {
      webview ??= await connectToWebview(port);
      return webview;
    },
    /** Rect of an element inside the board webview, in workbench coordinates. */
    async rectIn(fnSource) {
      const wv = await api.webview();
      const outer = await cdp.evaluate(
        "(() => { const r = document.querySelector('iframe.webview')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y } : null; })()",
      );
      const inner = await wv.send('Runtime.evaluate', {
        expression: "(() => { const r = document.querySelector('iframe#active-frame')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y } : { x: 0, y: 0 }; })()",
        returnByValue: true,
      });
      const el = await wv.evaluate(`(doc) => { const el = (${fnSource})(doc); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }`);
      if (!outer || !el) return null;
      const off = inner.result.value;
      return { x: outer.x + off.x + el.x, y: outer.y + off.y + el.y, w: el.w, h: el.h };
    },
    async rectWb(expr) {
      return cdp.evaluate(`(() => { const el = ${expr}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    },
    async moveTo(x, y, ms = 600) {
      pointer.visible = true;
      const steps = Math.max(8, Math.round(ms / 25));
      const sx = pointer.x;
      const sy = pointer.y;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        pointer.x = sx + (x - sx) * e;
        pointer.y = sy + (y - sy) * e;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pointer.x, y: pointer.y });
        await sleep(ms / steps);
      }
    },
    async click(x, y) {
      await api.moveTo(x, y);
      // Frame capture delays input processing: settle the pointer before pressing, or the press
      // lands where the renderer still thinks the pointer is.
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
      await sleep(150);
      events.push({ type: 'click', t: now(), x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(70);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    },
    async clickRect(r) {
      if (!r) throw new Error('element not found');
      await api.click(r.x + r.w / 2, r.y + r.h / 2);
    },
    /** Points at an element of the board webview and activates it with a DOM click. */
    async clickIn(fnSource) {
      const r = await api.rectIn(fnSource);
      if (!r) throw new Error(`element not found: ${fnSource.slice(0, 80)}`);
      const x = r.x + Math.min(r.w / 2, 120);
      const y = r.y + r.h / 2;
      await api.moveTo(x, y);
      await sleep(150);
      events.push({ type: 'click', t: now(), x, y });
      const wv = await api.webview();
      await wv.evaluate(`(doc) => { const el = (${fnSource})(doc); if (el.matches('input, select, textarea')) el.focus(); else el.click(); return true; }`);
    },
    /** Types into the focused field of the board webview, one character at a time. */
    async typeIn(fnSource, text, delay = 120) {
      const wv = await api.webview();
      for (const ch of text) {
        await wv.evaluate(`(doc) => { const el = (${fnSource})(doc); el.value += ${JSON.stringify(ch)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; }`);
        await sleep(delay);
      }
    },
    async keyIn(fnSource, key) {
      const wv = await api.webview();
      await wv.evaluate(`(doc) => { const el = (${fnSource})(doc) ?? doc.body; el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); return true; }`);
    },
    async type(text, delay = 110) {
      for (const ch of text) {
        await cdp.send('Input.insertText', { text: ch });
        await sleep(delay);
      }
    },
    async key(key, code, keyCode) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
    },
    async waitWebview(fnSource, timeoutMs = 60_000) {
      const wv = await api.webview();
      const deadline = Date.now() + timeoutMs;
      while (!(await wv.evaluate(fnSource))) {
        if (Date.now() > deadline) throw new Error(`webview condition never met: ${fnSource.slice(0, 80)}`);
        await sleep(250);
      }
    },
    /** Drags the card matched by `cardFn` onto the column matched by `columnFn`. */
    async drag(cardFn, columnFn) {
      const card = await api.rectIn(cardFn);
      if (!card) throw new Error('drag source not found');
      const from = { x: card.x + card.w * 0.35, y: card.y + 24 };
      await api.moveTo(from.x, from.y);
      await sleep(250);
      const wv = await api.webview();
      await wv.evaluate(`(doc) => {
        window.__ghpDrag = new DataTransfer();
        const card = (${cardFn})(doc);
        card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__ghpDrag }));
        return true;
      }`);
      const ghost = { type: 'ghost', start: now(), rect: card, grab: { x: from.x - card.x, y: from.y - card.y } };
      events.push(ghost);
      // Dragging reveals the "No <field>" drop column, which shifts the others: measure now.
      await sleep(150);
      const column = await api.rectIn(columnFn);
      if (!column) throw new Error('drag target not found');
      const to = { x: column.x + column.w / 2, y: column.y + 140 };
      const steps = 30;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        pointer.x = from.x + (to.x - from.x) * e;
        pointer.y = from.y + (to.y - from.y) * e;
        if (i > steps * 0.55) {
          await wv.evaluate(`(doc) => { const c = (${columnFn})(doc); c.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__ghpDrag })); return true; }`);
        }
        await sleep(40);
      }
      await sleep(400);
      ghost.end = now();
      await wv.evaluate(`(doc) => {
        const c = (${columnFn})(doc);
        c.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__ghpDrag }));
        return true;
      }`);
    },
    async finish(name) {
      await api.stop();
      const dir = mkdtempSync(join(tmpdir(), 'ghp-frames-'));
      frames.forEach((f, i) => writeFileSync(join(dir, `${String(i).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64')));
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ frames: frames.map(({ t, pointer: p }) => ({ t, pointer: p })), events }));
      mkdirSync(outDir, { recursive: true });
      const out = join(outDir, `${name}.gif`);
      execFileSync('python3', [join(root, 'scripts', 'make-gif.py'), dir, out], { stdio: 'inherit' });
      rmSync(dir, { recursive: true, force: true });
      webview?.close();
      cdp.close();
      host.close();
      console.log(`saved ${out}`);
    },
  };
  return api;
}

const card = (title) =>
  `(doc) => [...doc.querySelectorAll('.card')].find((c) => c.querySelector('.card-title')?.textContent?.startsWith(${JSON.stringify(title)}))`;
const column = (name) => `(doc) => doc.querySelector('.column[aria-label=${JSON.stringify(name)}]')`;
const boardReady = "(doc) => doc.querySelectorAll('.card').length > 0";

const demos = {
  /** Activity Bar → projects tree → open the board. */
  async open() {
    const s = await session({ steps: [{ command: 'workbench.view.extension.ghProjects' }] });
    const row = (label) =>
      `[...document.querySelectorAll('.monaco-list-row')].find((r) => r.getAttribute('aria-label')?.startsWith(${JSON.stringify(label)}))`;
    await s.host.waitFor(`!!(${row(SANDBOX.title)})`);
    await sleep(800);
    await s.start();
    await sleep(900);
    await s.click(...center(await s.rectWb(row(SANDBOX.title))));
    await s.host.waitFor("!!document.querySelector('iframe.webview')");
    await s.waitWebview(boardReady);
    await sleep(2200);
    await s.finish('open-board');
  },

  /** Drag a card to another column; the status bar counter follows. */
  async move() {
    const s = await session({
      steps: [{ command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] }, { command: 'workbench.action.closeSidebar' }],
    });
    await s.waitWebview(boardReady);
    await s.host.waitFor(`/\\d+ in progress/.test(document.querySelector('${statusBarCounter}')?.textContent ?? '')`);
    await sleep(800);
    await s.start();
    await sleep(800);
    await s.drag(card('Draft: check the in-progress counter'), column('Done'));
    await sleep(2600);
    await s.finish('move-card');
  },

  /** Free-text search, then a Priority filter, then clear. */
  async filter() {
    const s = await session({
      steps: [{ command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] }, { command: 'workbench.action.closeSidebar' }],
    });
    await s.waitWebview(boardReady);
    await sleep(800);
    await s.start();
    await sleep(700);
    const search = "(doc) => doc.querySelector('input.search')";
    await s.clickIn(search);
    await s.typeIn(search, 'draft');
    await sleep(1600);
    await s.keyIn(search, 'Escape');
    await sleep(800);
    await s.clickIn("(doc) => [...doc.querySelectorAll('.filter-menu summary')].find((x) => x.textContent.startsWith('Priority'))");
    await sleep(600);
    for (const name of ['P0', 'P1']) {
      await s.clickIn(`(doc) => [...doc.querySelectorAll('.filter-menu[open] .menu label')].find((l) => l.querySelector('.menu-label')?.textContent === ${JSON.stringify(name)})`);
      await sleep(700);
    }
    await s.keyIn('(doc) => doc.body', 'Escape');
    await sleep(1800);
    await s.clickIn("(doc) => doc.querySelector('.filter-bar .link-button')");
    await sleep(1500);
    await s.finish('filters');
  },

  /** Open an item, read its body, change Priority from the panel. */
  async detail() {
    const s = await session({
      steps: [{ command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] }, { command: 'workbench.action.closeSidebar' }],
    });
    await s.waitWebview(boardReady);
    await sleep(800);
    await s.start();
    await sleep(700);
    await s.clickIn(`(doc) => (${card('M7:')})(doc)?.querySelector('.card-title')`);
    await s.waitWebview("(doc) => !!doc.querySelector('.detail-body') && !doc.querySelector('.detail-body').textContent.startsWith('Loading')");
    await sleep(1500);
    const select = await s.rectIn("(doc) => [...doc.querySelectorAll('.detail-field')].find((r) => r.querySelector('label')?.textContent === 'Priority')?.querySelector('select')");
    await s.moveTo(select.x + select.w * 0.4, select.y + select.h / 2);
    await sleep(300);
    // Native <select> popups are drawn by the OS, outside the page: pick the value in the DOM.
    const wv = await s.webview();
    await wv.evaluate(`(doc) => {
      const select = [...doc.querySelectorAll('.detail-field')].find((r) => r.querySelector('label')?.textContent === 'Priority').querySelector('select');
      select.value = [...select.options].find((o) => o.textContent === 'P1').value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }`);
    await sleep(1800);
    await s.clickIn("(doc) => doc.querySelector('.detail-header .icon-button')");
    await sleep(1400);
    await s.finish('item-detail');
  },
};

function center(r) {
  if (!r) throw new Error('element not found');
  return [r.x + Math.min(r.w / 2, 160), r.y + r.h / 2];
}

const selected = values.demo === 'all' ? Object.keys(demos) : values.demo.split(',');
for (const name of selected) {
  if (!demos[name]) throw new Error(`unknown demo ${name}; known: ${Object.keys(demos).join(', ')}`);
  await demos[name]();
}
