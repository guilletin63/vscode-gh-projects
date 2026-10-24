// Screenshot scenarios: harness steps (commands replayed inside the dev host), an optional
// `waitFor` expression evaluated in the workbench renderer and optional `actions`.
// Every scenario targets the sandbox project (writes included). Point SANDBOX at your own
// throw-away project before running them.

const treeRow = (label) =>
  `[...document.querySelectorAll('.monaco-list-row')].find((r) => r.getAttribute('aria-label')?.startsWith(${JSON.stringify(label)}))`;

/** Expands a tree row by clicking its twistie (monaco lists react to mouse events). */
const expandRow = (label) => `(() => {
  const row = ${treeRow(label)};
  const t = row?.querySelector('.monaco-tl-twistie');
  if (!t || row.getAttribute('aria-expanded') === 'true') return;
  for (const type of ['mousedown', 'mouseup', 'click']) t.dispatchEvent(new MouseEvent(type, { bubbles: true }));
})()`;

// Throw-away project used for every screenshot; the only one scenarios may write to.
export const SANDBOX = {
  id: 'PVT_kwHOBCq4Uc4BoSUH',
  number: 3,
  title: 'vscode-gh-projects sandbox',
  url: 'https://github.com/users/guilletin63/projects/3',
  ownerLogin: 'guilletin63',
};

/** Webview action: opens the "Move" menu of the card titled `title` and picks column `to`. */
const moveCard = (title, to) => `(doc) => {
  const card = [...doc.querySelectorAll('.card')].find((c) => c.querySelector('.card-title')?.textContent?.includes(${JSON.stringify(title)}));
  if (!card) return false;
  const menu = card.querySelector('.move-menu');
  menu.open = true;
  const item = [...menu.querySelectorAll('.menu-item')].find((b) => b.textContent === ${JSON.stringify(to)});
  if (!item || item.disabled) return false;
  item.click();
  return true;
}`;

/** Webview action: picks `option` in the toolbar select labelled `label`. */
const pick = (label, option) => `(doc) => {
  const select = doc.querySelector('.toolbar select[aria-label=${JSON.stringify(label)}]');
  const o = select && [...select.options].find((x) => x.textContent === ${JSON.stringify(option)});
  if (!o) return false;
  select.value = o.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}`;

const webviewShown = "!!document.querySelector('.webview.ready, iframe.webview')";

export const scenarios = {
  activitybar: {
    needsToken: false,
    steps: [{ command: 'workbench.view.extension.ghProjects' }],
    waitFor: "!!document.querySelector('.pane-header[aria-label*=\"Projects\"]')",
  },
  welcome: {
    needsToken: false,
    steps: [{ command: 'workbench.view.extension.ghProjects' }],
    waitFor: "!!document.querySelector('.welcome-view-content')",
  },
  tree: {
    needsToken: true,
    steps: [{ command: 'workbench.view.extension.ghProjects' }],
    waitFor: `!!(${treeRow(SANDBOX.title)})`,
    actions: [{ eval: expandRow(SANDBOX.title), waitFor: `!!(${treeRow('Board')})` }],
  },
  board: {
    needsToken: true,
    settings: { 'workbench.activityBar.location': 'default' },
    steps: [
      { command: 'workbench.view.extension.ghProjects' },
      { command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] },
      { command: 'workbench.action.toggleSidebarVisibility' },
    ],
    waitFor: webviewShown,
    actions: [{ wait: 9000 }],
  },
  // Read-only: the sandbox's table view (fields chosen on github.com).
  table: {
    needsToken: true,
    steps: [
      { command: 'ghProjects.openBoard', args: [{ project: SANDBOX, viewId: 'PVTV_lAHOBCq4Uc4BoSUHzgMMTSw' }] },
      { command: 'workbench.action.closeSidebar' },
    ],
    waitFor: webviewShown,
    actions: [{ webview: "(doc) => doc.querySelectorAll('.item-row').length > 0" }, { wait: 3000 }],
  },
  // Read-only: the sandbox's roadmap view, bars from the Sprint iteration field.
  roadmap: {
    needsToken: true,
    steps: [
      { command: 'ghProjects.openBoard', args: [{ project: SANDBOX, viewId: 'PVTV_lAHOBCq4Uc4BoSUHzgMNwQM' }] },
      { command: 'workbench.action.closeSidebar' },
    ],
    waitFor: webviewShown,
    actions: [{ webview: "(doc) => doc.querySelectorAll('.roadmap-row').length > 0" }, { wait: 3000 }],
  },
  // Read-only: roadmap with bars from the Due date field, grouped by Status.
  'roadmap-due': {
    needsToken: true,
    steps: [
      { command: 'ghProjects.openBoard', args: [{ project: SANDBOX, viewId: 'PVTV_lAHOBCq4Uc4BoSUHzgMNwQM' }] },
      { command: 'workbench.action.closeSidebar' },
    ],
    waitFor: webviewShown,
    actions: [
      { webview: "(doc) => doc.querySelectorAll('.roadmap-row').length > 0" },
      { webview: pick('Start', 'Due') },
      { webview: pick('Target', 'Due') },
      { webview: pick('Group by', 'Status') },
      { wait: 2000 },
    ],
  },
  // Read-only: opens an item's detail from a table row.
  'table-detail': {
    needsToken: true,
    steps: [
      { command: 'ghProjects.openBoard', args: [{ project: SANDBOX, viewId: 'PVTV_lAHOBCq4Uc4BoSUHzgMMTSw' }] },
      { command: 'workbench.action.closeSidebar' },
    ],
    waitFor: webviewShown,
    actions: [
      { webview: `(doc) => { const r = [...doc.querySelectorAll('.item-row')].find((x) => x.textContent.includes('M6:')); if (!r) return false; r.click(); return true; }` },
      { webview: "(doc) => !!doc.querySelector('.detail-body') && !doc.querySelector('.detail-body')?.textContent?.startsWith('Loading')" },
      { wait: 2000 },
    ],
  },
  // Label + Status filter. The filter only lives in the throw-away harness profile.
  'board-filtered': {
    needsToken: true,
    steps: [
      { command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] },
      { command: 'workbench.action.closeSidebar' },
      {
        boardFilter: {
          text: '',
          labels: ['milestone'],
          assignees: [],
          // Priority in (P0, P1)
          fields: { PVTSSF_lAHOBCq4Uc4BoSUHzhmzHOM: ['bfd5a372', '5ca9b56d'] },
        },
      },
    ],
    waitFor: webviewShown,
    actions: [{ wait: 4000 }],
  },
  // WRITES to the sandbox: moves a draft from In Progress to Done.
  'sandbox-move': {
    needsToken: true,
    steps: [{ command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] }, { command: 'workbench.action.closeSidebar' }],
    waitFor: webviewShown,
    actions: [{ webview: "(doc) => doc.querySelectorAll('.card').length > 0" }, { wait: 1500 }, { webview: moveCard('Draft: try the sandbox board', 'Done') }, { wait: 4000 }],
  },
  // Sandbox: the token is broken after loading, so the move fails with 401 and rolls back.
  'sandbox-rollback': {
    needsToken: true,
    steps: [
      { command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] },
      { command: 'workbench.action.closeSidebar' },
      { boardLoaded: true },
      { breakToken: true },
    ],
    waitFor: webviewShown,
    actions: [{ webview: "(doc) => doc.querySelectorAll('.card').length > 0" }, { wait: 3000 }, { webview: moveCard('Draft: check the in-progress counter', 'Todo') }, { webview: "(doc) => !!doc.querySelector('.banner')" }, { wait: 1000 }],
  },
  // Read-only: opens the detail of the "M6" issue (no field is touched).
  detail: {
    needsToken: true,
    steps: [{ command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] }, { command: 'workbench.action.closeSidebar' }],
    waitFor: webviewShown,
    actions: [
      { webview: `(doc) => { const c = [...doc.querySelectorAll('.card.type-Issue')].find((x) => x.querySelector('.card-title')?.textContent?.startsWith('M6:')); if (!c) return false; c.click(); return true; }` },
      { webview: "(doc) => !!doc.querySelector('.detail-body') && !doc.querySelector('.detail-body')?.textContent?.startsWith('Loading')" },
      { wait: 2500 },
    ],
  },
  // Read-only: board + the status bar counter, after pressing the board's refresh button.
  statusbar: {
    needsToken: true,
    steps: [{ command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] }, { command: 'workbench.action.closeSidebar' }],
    waitFor: webviewShown,
    actions: [
      { webview: "(doc) => doc.querySelectorAll('.card').length > 0" },
      { webview: "(doc) => { doc.querySelector('.toolbar .icon-button[title=\"Refresh\"]')?.click(); return true; }" },
      { eval: "new Promise((r) => setTimeout(r, 6000)).then(() => true)" },
      { waitFor: "!!document.querySelector('[id=\"guilletin63.vscode-gh-projects.ghProjects.inProgress\"]')" },
    ],
  },
  // WRITES to the sandbox: opens a draft and sets Priority to P0 from the detail panel.
  'sandbox-edit': {
    needsToken: true,
    steps: [{ command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] }, { command: 'workbench.action.closeSidebar' }],
    waitFor: webviewShown,
    actions: [
      { webview: `(doc) => { const c = [...doc.querySelectorAll('.card')].find((x) => x.querySelector('.card-title')?.textContent?.startsWith('Draft: try the sandbox board')); if (!c) return false; c.click(); return true; }` },
      { webview: "(doc) => !!doc.querySelector('.detail-body') && !doc.querySelector('.detail-body')?.textContent?.startsWith('Loading')" },
      {
        webview: `(doc) => {
          const row = [...doc.querySelectorAll('.detail-field')].find((r) => r.querySelector('label')?.textContent === 'Priority');
          const select = row?.querySelector('select');
          const option = select && [...select.options].find((o) => o.textContent === 'P0');
          if (!option) return false;
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }`,
      },
      { wait: 4000 },
    ],
  },
  // Read-only: drafts assigned to the signed-in user in "In Progress" -> non-zero counter.
  'sandbox-counter': {
    needsToken: true,
    steps: [{ command: 'ghProjects.openBoard', args: [{ project: SANDBOX }] }, { command: 'workbench.action.closeSidebar' }],
    waitFor: webviewShown,
    actions: [
      { webview: "(doc) => doc.querySelectorAll('.card').length > 0" },
      { waitFor: "/[1-9]\\d* in progress/.test(document.querySelector('[id=\"guilletin63.vscode-gh-projects.ghProjects.inProgress\"]')?.textContent ?? '')" },
      { wait: 1500 },
    ],
  },
};
