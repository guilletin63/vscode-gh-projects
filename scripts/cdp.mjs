// Minimal Chrome DevTools Protocol client (Node >= 22 global WebSocket). Used by the screenshot
// harness to drive and capture the Extension Development Host window without OS permissions.

/**
 * `value` as a JavaScript string literal, for strings spliced into code that `evaluate` runs.
 * Unlike plain JSON.stringify, `<`, `>`, `/`, U+2028 and U+2029 are escaped too.
 */
export function jsString(value) {
  return JSON.stringify(String(value)).replace(/[<>/\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export async function connectToWorkbench(port, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('workbench'));
      if (page) return await openSession(page.webSocketDebuggerUrl);
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('workbench target not found');
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Session on the board webview's iframe target. `evaluate` runs inside the webview's inner
 * document (VS Code nests our page in an "active-frame" iframe of the same origin).
 */
export async function connectToWebview(port, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const frame = targets.find((t) => t.type === 'iframe' && t.url.startsWith('vscode-webview://'));
    if (frame) {
      const session = await openSession(frame.webSocketDebuggerUrl);
      const raw = session.evaluate.bind(session);
      session.evaluate = (expression) =>
        raw(`(() => { const doc = document.querySelector('iframe#active-frame')?.contentDocument ?? document; return (${expression})(doc); })()`);
      return session;
    }
    if (Date.now() > deadline) throw new Error('webview target not found');
    await new Promise((r) => setTimeout(r, 500));
  }
}

function openSession(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    };
    ws.onerror = () => reject(new Error('CDP websocket error'));
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          const msgId = ++id;
          ws.send(JSON.stringify({ id: msgId, method, params }));
          return new Promise((res, rej) => pending.set(msgId, { resolve: res, reject: rej }));
        },
        async evaluate(expression) {
          const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
          return r.result?.value;
        },
        async screenshot() {
          const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          return Buffer.from(r.data, 'base64');
        },
        close() {
          ws.close();
        },
      });
  });
}
