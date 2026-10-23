// Dev-only helper loaded next to the real extension by scripts/screenshot.mjs.
// It hands the extension a token taken from the harness process environment (kept in memory,
// never written to disk) and replays a list of commands so a screenshot can be taken.
const vscode = require('vscode');

exports.activate = async function activate() {
  const ext = vscode.extensions.getExtension('guilletin63.vscode-gh-projects');
  const api = await ext.activate();
  const token = process.env.GHP_HARNESS_TOKEN;
  if (token && typeof api.__setTokenProvider === 'function') {
    api.__setTokenProvider(async () => token);
  }
  // Demos: only list the project with this title, so other projects of the account stay private.
  const only = process.env.GHP_HARNESS_PROJECT_FILTER;
  if (only) {
    const real = api.__api();
    api.__setApiFactory(
      () =>
        new Proxy(real, {
          get(target, key) {
            if (key === 'listProjects') return async (...args) => (await target.listProjects(...args)).filter((p) => p.title === only);
            const value = target[key];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }),
    );
  }
  const steps = JSON.parse(process.env.GHP_HARNESS_STEPS || '[]');
  for (const step of steps) {
    if (step.wait) await new Promise((r) => setTimeout(r, step.wait));
    if (step.command) await vscode.commands.executeCommand(step.command, ...(step.args || []));
    if (step.boardLoaded) await api.__boards()[0]?.refresh();
    // Rollback demo: later writes fail with 401 against the real API.
    if (step.breakToken) api.__setTokenProvider(async () => 'invalid-token-rollback-demo');
    if (step.boardFilter) {
      const board = api.__boards()[0];
      if (board) {
        await board.refresh();
        await board.setFilter(step.boardFilter, { notify: true });
      }
    }
  }
};
