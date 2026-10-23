// Launches the extension in an Extension Development Host with remote debugging enabled, so
// scripts can drive and capture it over the Chrome DevTools Protocol (no OS permissions needed).
//
// With `needsToken`, the token of `gh auth token` (or GHP_GH_USER's) is handed to the dev-only
// harness extension through the child process environment only; it is never written to disk.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { connectToWorkbench } from './cdp.mjs';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const debug = (m) => process.env.GHP_DEBUG && console.error(`[devhost] ${m}`);

/**
 * @param {{ theme?: 'dark' | 'light', settings?: object, steps?: object[], needsToken?: boolean,
 *   projectFilter?: string, width?: number, height?: number, scale?: number, timeoutMs?: number }} opts
 */
export async function launchDevHost(opts = {}) {
  const exe = await downloadAndUnzipVSCode('stable');
  const userDir = mkdtempSync(join(tmpdir(), 'ghp-'));
  mkdirSync(join(userDir, 'User'), { recursive: true });
  writeFileSync(
    join(userDir, 'User', 'settings.json'),
    JSON.stringify({
      'workbench.colorTheme': opts.theme === 'light' ? 'Default Light Modern' : 'Default Dark Modern',
      'workbench.startupEditor': 'none',
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
      'chat.disableAIFeatures': true,
      'window.commandCenter': false,
      'workbench.tips.enabled': false,
      ...opts.settings,
    }),
  );

  const token = opts.needsToken
    ? execFileSync('gh', ['auth', 'token', ...(process.env.GHP_GH_USER ? ['-u', process.env.GHP_GH_USER] : [])], { encoding: 'utf8' }).trim()
    : '';
  const port = 9300 + Math.floor(Math.random() * 500);
  const child = spawn(
    exe,
    [
      `--extensionDevelopmentPath=${root}`,
      `--extensionDevelopmentPath=${join(root, 'test', 'harness')}`,
      `--user-data-dir=${userDir}`,
      `--extensions-dir=${join(userDir, 'extensions')}`,
      `--remote-debugging-port=${port}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--new-window',
    ],
    {
      env: {
        ...process.env,
        GHP_HARNESS_TOKEN: token,
        GHP_HARNESS_STEPS: JSON.stringify(opts.steps ?? []),
        GHP_HARNESS_PROJECT_FILTER: opts.projectFilter ?? '',
      },
      stdio: 'ignore',
    },
  );

  const close = () => {
    clearTimeout(watchdog);
    child.kill();
    rmSync(userDir, { recursive: true, force: true });
  };
  // Never leave a dev host behind if something hangs.
  const watchdog = setTimeout(() => {
    console.error('dev host timed out');
    close();
    process.exit(1);
  }, opts.timeoutMs ?? 120_000);

  debug(`launching on port ${port}`);
  const cdp = await connectToWorkbench(port);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: opts.width ?? 1400,
    height: opts.height ?? 860,
    deviceScaleFactor: opts.scale ?? 2,
    mobile: false,
  });

  const waitFor = async (expr, timeoutMs = 60_000) => {
    debug(`waiting for ${expr.slice(0, 80)}`);
    const deadline = Date.now() + timeoutMs;
    while (!(await cdp.evaluate(expr))) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${expr}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  return { cdp, port, waitFor, close };
}
