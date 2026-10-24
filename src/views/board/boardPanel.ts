import * as vscode from 'vscode';
import type { ProjectsApi } from '../../api/projectsApi';
import { defaultView } from '../../model/board';
import type { FieldInput } from '../../model/edits';
import { moveItemAfter, setItemValue, toFieldValue, validateInput } from '../../model/edits';
import type { BoardFilter } from '../../model/filter';
import { normalizeFilter } from '../../model/filter';
import type { ProjectSummary } from '../../model/types';
import type { BoardState, DraftValue, HostMessage } from '../../shared/protocol';
import { parseWebviewMessage } from '../../shared/protocol';
import { buildCsp, createNonce } from '../csp';
import { onRateLimit, reportError } from '../notify';

export const BOARD_VIEW_TYPE = 'ghProjects.board';
export const PR_EXTENSION_ID = 'GitHub.vscode-pull-request-github';

function prExtensionInstalled(): boolean {
  return vscode.extensions.getExtension(PR_EXTENSION_ID) !== undefined;
}

/** What we persist with the panel so VS Code can restore it after a reload. */
export interface PersistedBoard {
  project: Pick<ProjectSummary, 'id' | 'number' | 'title' | 'url' | 'ownerLogin'>;
  viewId?: string;
  groupFieldId?: string;
}

export interface BoardDeps {
  extensionUri: vscode.Uri;
  getApi: () => ProjectsApi;
  /** workspaceState: filters are remembered per project and workspace. */
  workspaceState: vscode.Memento;
}

const filterKey = (projectId: string) => `ghProjects.filter.${projectId}`;

/** One webview panel per project. Owns loading and talks to the webview only via the protocol. */
export class BoardPanel implements vscode.Disposable {
  private static readonly panels = new Map<string, BoardPanel>();
  private static readonly loaded = new vscode.EventEmitter<BoardPanel>();
  /** Fires after every successful (re)load or field edit of any board. */
  static readonly onDidLoad = BoardPanel.loaded.event;

  private state: BoardState | undefined;
  private loading: Promise<void> | undefined;
  private matching: { loadedAt: string; viewId: string; request: Promise<NonNullable<BoardState['viewMatches']>> } | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static open(deps: BoardDeps, project: PersistedBoard['project'], viewId?: string): BoardPanel {
    const existing = BoardPanel.panels.get(project.id);
    if (existing) {
      existing.panel.reveal();
      if (viewId && viewId !== existing.persisted.viewId) existing.selectView(viewId);
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(BOARD_VIEW_TYPE, project.title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'dist'), vscode.Uri.joinPath(deps.extensionUri, 'media')],
    });
    return new BoardPanel(panel, deps, { project, ...(viewId ? { viewId } : {}) });
  }

  static revive(panel: vscode.WebviewPanel, deps: BoardDeps, persisted: PersistedBoard): BoardPanel {
    return new BoardPanel(panel, deps, persisted);
  }

  static all(): BoardPanel[] {
    return [...BoardPanel.panels.values()];
  }

  private constructor(
    readonly panel: vscode.WebviewPanel,
    private readonly deps: BoardDeps,
    private persisted: PersistedBoard,
  ) {
    BoardPanel.panels.set(persisted.project.id, this);
    panel.iconPath = {
      light: vscode.Uri.joinPath(deps.extensionUri, 'media', 'projects-light.png'),
      dark: vscode.Uri.joinPath(deps.extensionUri, 'media', 'projects-dark.png'),
    };
    panel.webview.html = this.html();
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((raw: unknown) => this.onMessage(raw)),
      vscode.extensions.onDidChange(() => this.post({ type: 'env', prExtension: prExtensionInstalled() })),
      onRateLimit((n) => {
        if (this.loading) this.post({ type: 'rateLimit', waitMs: n.waitMs, reason: n.reason });
      }),
    );
  }

  get projectId(): string {
    return this.persisted.project.id;
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  get current(): BoardState | undefined {
    return this.state;
  }

  get filter(): BoardFilter {
    return normalizeFilter(this.deps.workspaceState.get(filterKey(this.projectId)));
  }

  /**
   * Stores the filter for this project. `notify` pushes it to the webview; it is off for
   * changes that come from the webview itself so a late echo can't overwrite what the user types.
   */
  async setFilter(filter: BoardFilter, opts: { notify?: boolean } = {}): Promise<void> {
    await this.deps.workspaceState.update(filterKey(this.projectId), filter);
    if (this.state) {
      this.state = { ...this.state, filter };
      if (opts.notify) this.post({ type: 'state', state: this.state });
    }
  }

  /** Reloads fields, views and items. Concurrent calls share one load. */
  refresh(): Promise<void> {
    this.loading ??= this.load().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  selectView(viewId: string): void {
    this.persisted = { ...this.persisted, viewId };
    delete this.persisted.groupFieldId;
    if (this.state) {
      this.state = { ...this.state, viewId };
      delete this.state.groupFieldId;
      this.post({ type: 'state', state: this.state });
      void this.loadViewMatches();
    }
  }

  /**
   * Asks GitHub which items match the current view's own filter (`status:Done`, `@me`…), so the
   * panel shows the same items as github.com. Views without a filter need no request.
   */
  async loadViewMatches(opts: { post?: boolean } = {}): Promise<void> {
    const post = opts.post ?? true;
    const state = this.state;
    const view = state?.project.views.find((v) => v.id === state.viewId);
    if (!state || !view?.filter.trim()) {
      if (state?.viewMatches) {
        this.state = { ...state };
        delete this.state.viewMatches;
        if (post) this.post({ type: 'state', state: this.state });
      }
      return;
    }
    if (state.viewMatches?.viewId === view.id) return;
    // One request per view at a time (switching views and a reload can both ask).
    if (this.matching?.loadedAt !== state.loadedAt || this.matching.viewId !== view.id) {
      const request = this.deps
        .getApi()
        .listItemIds(state.project.id, view.filter)
        .then(
          (itemIds): NonNullable<BoardState['viewMatches']> => ({ viewId: view.id, itemIds }),
          (err: unknown): NonNullable<BoardState['viewMatches']> => ({ viewId: view.id, error: reportError(`Applying the filter of view ${view.name}`, err) }),
        );
      this.matching = { loadedAt: state.loadedAt, viewId: view.id, request };
    }
    const matches = await this.matching.request;
    // The user may have switched views (or reloaded) meanwhile.
    if (this.state && this.state.viewId === view.id && this.state.viewMatches?.viewId !== view.id) {
      this.state = { ...this.state, viewMatches: matches };
      if (post) this.post({ type: 'state', state: this.state });
    }
  }

  /**
   * Writes a field (the webview already shows the new value). Reports the outcome so the
   * webview can roll back, and warns the user on failure.
   */
  async setField(requestId: string, itemId: string, fieldId: string, input: FieldInput): Promise<boolean> {
    const state = this.state;
    const field = state?.project.fields.find((f) => f.id === fieldId);
    const item = state?.items.find((i) => i.id === itemId);
    const invalid = !state || !field || !item ? 'The board changed; refresh and try again.' : validateInput(field, input);
    if (invalid || !state || !field) {
      this.post({ type: 'editResult', requestId, ok: false, message: invalid });
      void vscode.window.showWarningMessage(`Could not update the item: ${invalid}`);
      return false;
    }
    try {
      await this.deps.getApi().setFieldValue(state.project.id, itemId, fieldId, input);
      if (this.state) {
        this.state = { ...this.state, items: setItemValue(this.state.items, itemId, fieldId, toFieldValue(field, input)).items };
      }
      this.post({ type: 'editResult', requestId, ok: true });
      BoardPanel.loaded.fire(this);
      return true;
    } catch (err) {
      const message = reportError(`Updating ${field.name} of ${item?.title ?? itemId}`, err);
      this.post({ type: 'editResult', requestId, ok: false, message });
      void vscode.window.showWarningMessage(`Could not update "${item?.title ?? 'item'}": ${message} The change was reverted.`);
      return false;
    }
  }

  /** Moves an item in the project order (the webview already shows it there). */
  async setPosition(requestId: string, itemId: string, afterId: string | undefined): Promise<boolean> {
    const state = this.state;
    const item = state?.items.find((i) => i.id === itemId);
    if (!state || !item || (afterId !== undefined && !state.items.some((i) => i.id === afterId))) {
      this.post({ type: 'editResult', requestId, ok: false, message: 'The board changed; refresh and try again.' });
      return false;
    }
    try {
      await this.deps.getApi().setItemPosition(state.project.id, itemId, afterId);
      if (this.state) this.state = { ...this.state, items: moveItemAfter(this.state.items, itemId, afterId).items };
      this.post({ type: 'editResult', requestId, ok: true });
      return true;
    } catch (err) {
      const message = reportError(`Moving ${item.title}`, err);
      this.post({ type: 'editResult', requestId, ok: false, message });
      void vscode.window.showWarningMessage(`Could not move "${item.title}": ${message} The change was reverted.`);
      return false;
    }
  }

  /**
   * Adds a draft issue, sets the fields of the column, group or swimlane it was added to, and
   * reloads so the webview gets the new item.
   */
  async addDraft(requestId: string, title: string, values: DraftValue[] = []): Promise<boolean> {
    const state = this.state;
    let invalid: string | undefined = state ? undefined : 'The board is still loading.';
    for (const v of values) {
      const field = state?.project.fields.find((f) => f.id === v.fieldId);
      invalid ??= field ? validateInput(field, v.input) : 'Unknown field.';
    }
    if (invalid || !state) {
      this.post({ type: 'addResult', requestId, ok: false, message: invalid });
      return false;
    }
    const api = this.deps.getApi();
    try {
      const itemId = await api.addDraftIssue(state.project.id, title);
      for (const v of values) await api.setFieldValue(state.project.id, itemId, v.fieldId, v.input);
      this.post({ type: 'addResult', requestId, ok: true });
      await this.refresh();
      return true;
    } catch (err) {
      const message = reportError(`Adding "${title}"`, err);
      this.post({ type: 'addResult', requestId, ok: false, message });
      void vscode.window.showWarningMessage(`Could not add "${title}": ${message}`);
      return false;
    }
  }

  async loadDetail(itemId: string): Promise<void> {
    try {
      const detail = await this.deps.getApi().getItemDetail(itemId);
      this.post({ type: 'detail', itemId, detail });
    } catch (err) {
      this.post({ type: 'detailError', itemId, message: reportError('Loading item', err) });
    }
  }

  /** Hands the issue/PR to the GitHub Pull Requests extension through its URI handler. */
  async openInPrExtension(itemId: string): Promise<boolean> {
    const item = this.state?.items.find((i) => i.id === itemId);
    const [owner, repo] = item?.repository?.split('/') ?? [];
    if (!item?.number || !owner || !repo || !prExtensionInstalled()) return false;
    const isPr = item.type === 'PullRequest';
    const uri = vscode.Uri.from({
      scheme: vscode.env.uriScheme,
      authority: PR_EXTENSION_ID,
      path: isPr ? '/open-pull-request-webview' : '/open-issue-webview',
      query: JSON.stringify(isPr ? { owner, repo, pullRequestNumber: item.number } : { owner, repo, issueNumber: item.number }),
    });
    return vscode.env.openExternal(uri);
  }

  private async load(): Promise<void> {
    const api = this.deps.getApi();
    try {
      this.post({ type: 'loading', loaded: 0, total: 0 });
      const project = await api.getProject(this.projectId);
      const items = await api.listItems(project, (p) => this.post({ type: 'loading', ...p }));
      const viewId =
        this.persisted.viewId && project.views.some((v) => v.id === this.persisted.viewId)
          ? this.persisted.viewId
          : defaultView(project)?.id;
      this.state = {
        project,
        items,
        ...(viewId ? { viewId } : {}),
        ...(this.persisted.groupFieldId ? { groupFieldId: this.persisted.groupFieldId } : {}),
        filter: this.filter,
        loadedAt: new Date().toISOString(),
      };
      this.panel.title = project.title;
      // Filtered views arrive already filtered: no flash of every item first.
      await this.loadViewMatches({ post: false });
      this.post({ type: 'state', state: this.state });
      BoardPanel.loaded.fire(this);
    } catch (err) {
      this.post({ type: 'error', message: reportError(`Loading board ${this.persisted.project.title}`, err) });
    }
  }

  private onMessage(raw: unknown): void {
    const msg = parseWebviewMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case 'ready':
        this.post({ type: 'env', prExtension: prExtensionInstalled() });
        if (this.state) this.post({ type: 'state', state: this.state });
        else void this.refresh();
        return;
      case 'refresh':
        void this.refresh();
        return;
      case 'selectView':
        this.selectView(msg.viewId);
        return;
      case 'selectGroupField':
        this.persisted = { ...this.persisted, groupFieldId: msg.fieldId };
        if (this.state) this.state = { ...this.state, groupFieldId: msg.fieldId };
        return;
      case 'openExternal':
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        return;
      case 'setFilter':
        void this.setFilter(msg.filter);
        return;
      case 'setField':
        void this.setField(msg.requestId, msg.itemId, msg.fieldId, msg.input);
        return;
      case 'setPosition':
        void this.setPosition(msg.requestId, msg.itemId, msg.afterId);
        return;
      case 'addDraft':
        void this.addDraft(msg.requestId, msg.title, msg.values);
        return;
      case 'openDetail':
        void this.loadDetail(msg.itemId);
        return;
      case 'copyLink':
        void vscode.env.clipboard.writeText(msg.url).then(() => vscode.window.setStatusBarMessage('$(check) Link copied', 3000));
        return;
      case 'openInPrExtension':
        void this.openInPrExtension(msg.itemId);
        return;
    }
  }

  private post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private html(): string {
    const webview = this.panel.webview;
    const nonce = createNonce();
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'dist', name));
    // The persisted board travels in a data attribute so the serializer can restore the panel.
    const persisted = escapeAttr(JSON.stringify(this.persisted));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${buildCsp(webview.cspSource, nonce)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${asset('webview.css').toString()}">
  <title>${escapeAttr(this.persisted.project.title)}</title>
</head>
<body data-persisted="${persisted}">
  <div id="app" role="application" aria-busy="true"></div>
  <div id="live" class="sr-only" aria-live="polite"></div>
  <script nonce="${nonce}" src="${asset('webview.js').toString()}"></script>
</body>
</html>`;
  }

  dispose(): void {
    BoardPanel.panels.delete(this.projectId);
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
