// Opens the extension in an Extension Development Host, replays a scenario and captures the
// window through the Chrome DevTools Protocol (no macOS screen-recording permission needed).
//
//   npm run screenshot -- --scenario board --theme dark --out docs/screenshots/board.png
//
// Scenarios live in scripts/scenarios.mjs and only target the sandbox project.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { connectToWebview } from './cdp.mjs';
import { launchDevHost } from './devhost.mjs';
import { scenarios } from './scenarios.mjs';

const { values } = parseArgs({
  options: {
    scenario: { type: 'string', default: 'activitybar' },
    theme: { type: 'string', default: 'dark' },
    out: { type: 'string' },
    width: { type: 'string', default: '1400' },
    height: { type: 'string', default: '860' },
    settle: { type: 'string', default: '4000' },
  },
});
const scenario = scenarios[values.scenario];
if (!scenario) throw new Error(`unknown scenario ${values.scenario}; known: ${Object.keys(scenarios).join(', ')}`);
const out = resolve(values.out ?? `screenshots/tmp/${values.scenario}-${values.theme}.png`);

const host = await launchDevHost({
  theme: values.theme === 'light' ? 'light' : 'dark',
  settings: scenario.settings,
  steps: scenario.steps,
  needsToken: scenario.needsToken,
  projectFilter: scenario.projectFilter,
  width: Number(values.width),
  height: Number(values.height),
});
const { cdp, port, waitFor } = host;

try {
  if (scenario.waitFor) await waitFor(scenario.waitFor);
  // Optional UI actions in the workbench renderer (e.g. expanding a tree row) before capturing.
  let webview;
  for (const action of scenario.actions ?? []) {
    if (action.eval) await cdp.evaluate(action.eval);
    // `webview`: a function source `(doc) => …` evaluated inside the board webview document.
    if (action.webview) {
      webview ??= await connectToWebview(port);
      const deadline = Date.now() + 60000;
      while (!(await webview.evaluate(action.webview))) {
        if (Date.now() > deadline) throw new Error(`webview action never succeeded: ${action.webview.slice(0, 80)}`);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (action.waitFor) await waitFor(action.waitFor);
    if (action.wait) await new Promise((r) => setTimeout(r, action.wait));
  }
  await new Promise((r) => setTimeout(r, Number(values.settle)));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await cdp.screenshot());
  cdp.close();
  webview?.close();
  console.log(`saved ${out}`);
} finally {
  host.close();
}
