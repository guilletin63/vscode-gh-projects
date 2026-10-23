import * as vscode from 'vscode';
import type { TokenProvider } from './api/client';
import { GraphQLClient } from './api/client';
import type { ProjectsApi } from './api/projectsApi';
import { GitHubProjectsApi } from './api/projectsApi';
import { GitHubAuth } from './auth/githubAuth';
import type { ProjectSummary } from './model/types';
import type { PersistedBoard } from './views/board/boardPanel';
import { BOARD_VIEW_TYPE, BoardPanel } from './views/board/boardPanel';
import { getLog, notifyRateLimit, reportError } from './views/notify';
import type { TreeNode } from './views/tree/projectsTree';
import { ProjectsTreeProvider } from './views/tree/projectsTree';
import { countMine } from './model/stats';
import type { ProjectDetails, ProjectItem } from './model/types';
import { Poller } from './views/poller';
import { StatusBarCounter } from './views/statusBar';
import { onRateLimit } from './views/notify';

/** Returned by activate(). The `__` members are test/screenshot hooks, not product API. */
export interface ExtensionApi {
  __setTokenProvider(provider: TokenProvider): void;
  __setApiFactory(factory: () => ProjectsApi): void;
  __treeChildren(node?: TreeNode): Promise<TreeNode[]>;
  __api(): ProjectsApi;
  __boards(): BoardPanel[];
  __statusText(): string;
  __refreshCounter(): Promise<void>;
}

const LAST_PROJECT_KEY = 'ghProjects.lastProject';

function config() {
  const c = vscode.workspace.getConfiguration('ghProjects');
  return {
    refreshInterval: c.get<number>('refreshInterval', 0),
    inProgressColumn: c.get<string>('inProgressColumn', 'In progress'),
  };
}

export interface OpenBoardArgs {
  project: ProjectSummary;
  viewId?: string;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const log = getLog();
  const auth = new GitHubAuth();
  let tokenProvider: TokenProvider = (opts) => auth.getToken(opts);
  let overrideToken = false;

  const buildApi = (): ProjectsApi =>
    new GitHubProjectsApi(
      new GraphQLClient({
        tokenProvider: (opts) => tokenProvider(opts),
        onRateLimit: notifyRateLimit,
        onWarning: (m) => log.warn(m),
      }),
    );
  let api = buildApi();

  const setSignedIn = (signedIn: boolean): void => {
    void vscode.commands.executeCommand('setContext', 'ghProjects.signedIn', signedIn);
  };

  const boardDeps = { extensionUri: context.extensionUri, getApi: () => api, workspaceState: context.workspaceState };

  const tree = new ProjectsTreeProvider(() => api, context.globalState, setSignedIn);
  const treeView = vscode.window.createTreeView('ghProjects.projects', { treeDataProvider: tree, showCollapseAll: true });

  const syncSignedIn = async (): Promise<void> => {
    setSignedIn(overrideToken || (await auth.currentSession()) !== undefined);
  };
  void syncSignedIn();

  context.subscriptions.push(
    auth,
    treeView,
    auth.onDidChange(async () => {
      await syncSignedIn();
      tree.refresh();
    }),
    vscode.commands.registerCommand('ghProjects.signIn', async () => {
      try {
        await auth.signIn();
        setSignedIn(true);
        tree.refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(reportError('Sign in', err));
      }
    }),
    vscode.commands.registerCommand('ghProjects.refresh', async () => {
      tree.refresh();
      await Promise.all(BoardPanel.all().map((b) => b.refresh()));
    }),
    vscode.commands.registerCommand('ghProjects.openLastBoard', () => {
      const last = context.globalState.get<PersistedBoard['project']>(LAST_PROJECT_KEY);
      return last ? BoardPanel.open(boardDeps, last) : vscode.commands.executeCommand('workbench.view.extension.ghProjects');
    }),
    vscode.commands.registerCommand('ghProjects.addOwner', async () => {
      const login = await vscode.window.showInputBox({
        title: 'Add owner',
        prompt: 'GitHub user or organization login whose projects you want to see',
        placeHolder: 'octo-org',
        validateInput: (v) => (/^[A-Za-z0-9-]{1,39}$/.test(v.trim()) ? undefined : 'Not a valid GitHub login'),
      });
      if (!login) return;
      try {
        const owner = await tree.addOwner(login);
        if (!owner) void vscode.window.showWarningMessage(`No GitHub user or organization named "${login}".`);
      } catch (err) {
        void vscode.window.showErrorMessage(reportError('Add owner', err));
      }
    }),
    vscode.commands.registerCommand('ghProjects.removeOwner', async (node?: { owner?: { login: string } }) => {
      if (node?.owner) await tree.removeOwner(node.owner.login);
    }),
    vscode.commands.registerCommand('ghProjects.openBoard', (args?: OpenBoardArgs) => {
      if (!args?.project) return undefined;
      const { id, number, title, url, ownerLogin } = args.project;
      void context.globalState.update(LAST_PROJECT_KEY, { id, number, title, url, ownerLogin });
      return BoardPanel.open(boardDeps, args.project, args.viewId);
    }),
    vscode.window.registerWebviewPanelSerializer(BOARD_VIEW_TYPE, {
      async deserializeWebviewPanel(panel, state: unknown) {
        const persisted = state as PersistedBoard | undefined;
        if (!persisted?.project?.id) {
          panel.dispose();
          return;
        }
        BoardPanel.revive(panel, boardDeps, persisted);
      },
    }),
    vscode.commands.registerCommand('ghProjects.openOnGitHub', async (node?: { project?: ProjectSummary }) => {
      if (node?.project) await vscode.env.openExternal(vscode.Uri.parse(node.project.url));
    }),
  );

  // ---- status bar counter + polling ----
  const counter = new StatusBarCounter();
  let viewerLogin: string | undefined;
  const myLogin = async (): Promise<string | undefined> => {
    viewerLogin ??= (await api.getOwners()).find((o) => o.isViewer)?.login;
    return viewerLogin;
  };
  const showCount = async (project: ProjectDetails, items: ProjectItem[]): Promise<void> => {
    const last = context.globalState.get<PersistedBoard['project']>(LAST_PROJECT_KEY);
    if (!last || last.id !== project.id) return;
    const login = await myLogin();
    if (!login) return;
    const column = config().inProgressColumn;
    counter.show(countMine(project, items, login, column), column, project.title);
  };
  /** Counter for the last project when its board is not open (startup, polling). */
  const refreshCounter = async (): Promise<void> => {
    const last = context.globalState.get<PersistedBoard['project']>(LAST_PROJECT_KEY);
    if (!last) return counter.hide();
    const open = BoardPanel.all().find((b) => b.projectId === last.id)?.current;
    if (open) return showCount(open.project, open.items);
    try {
      const project = await api.getProject(last.id);
      await showCount(project, await api.listItems(project));
    } catch (err) {
      reportError('Updating the status bar counter', err);
    }
  };
  const poller = new Poller({
    intervalSeconds: () => config().refreshInterval,
    isActive: () => vscode.window.state.focused,
    tick: async () => {
      const visible = BoardPanel.all().filter((b) => b.visible);
      await Promise.all(visible.map((b) => b.refresh()));
      await refreshCounter();
    },
  });
  poller.start();
  void auth.currentSession().then((s) => (s ? refreshCounter() : undefined));

  context.subscriptions.push(
    counter,
    { dispose: () => poller.stop() },
    BoardPanel.onDidLoad((b) => {
      if (b.current) void showCount(b.current.project, b.current.items);
    }),
    onRateLimit(() => poller.notifyRateLimited()),
    auth.onDidChange(() => {
      viewerLogin = undefined;
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ghProjects.refreshInterval')) poller.start();
      if (e.affectsConfiguration('ghProjects.inProgressColumn')) void refreshCounter();
    }),
  );

  return {
    __statusText: () => counter.text,
    __refreshCounter: refreshCounter,
    __setTokenProvider(provider) {
      tokenProvider = provider;
      overrideToken = true;
      api = buildApi();
      viewerLogin = undefined;
      setSignedIn(true);
      tree.refresh();
    },
    __setApiFactory(factory) {
      api = factory();
      viewerLogin = undefined;
      overrideToken = true;
      setSignedIn(true);
      tree.refresh();
    },
    __treeChildren: (node) => tree.getChildren(node),
    __api: () => api,
    __boards: () => BoardPanel.all(),
  };
}

export function deactivate(): void {}
