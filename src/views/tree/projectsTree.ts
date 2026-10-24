import * as vscode from 'vscode';
import type { ProjectsApi } from '../../api/projectsApi';
import { NotSignedInError } from '../../auth/githubAuth';
import type { Owner, ProjectSummary, ProjectView } from '../../model/types';
import { reportError } from '../notify';

export type TreeNode =
  | { kind: 'owner'; owner: Owner }
  | { kind: 'project'; owner: Owner; project: ProjectSummary }
  | { kind: 'view'; owner: Owner; project: ProjectSummary; view: ProjectView }
  | { kind: 'message'; text: string; icon: string };

const EXTRA_OWNERS_KEY = 'ghProjects.extraOwners';

const LAYOUT_ICONS: Record<ProjectView['layout'], string> = {
  board: 'project',
  table: 'table',
  roadmap: 'calendar',
};

export class ProjectsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changed = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly getApi: () => ProjectsApi,
    private readonly globalState: vscode.Memento,
    private readonly setSignedIn: (signedIn: boolean) => void,
  ) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  extraOwners(): string[] {
    return this.globalState.get<string[]>(EXTRA_OWNERS_KEY, []);
  }

  async addOwner(login: string): Promise<Owner | undefined> {
    const owner = await this.getApi().lookupOwner(login.trim());
    if (!owner) return undefined;
    const logins = new Set(this.extraOwners().map((l) => l.toLowerCase()));
    if (!logins.has(owner.login.toLowerCase())) {
      await this.globalState.update(EXTRA_OWNERS_KEY, [...this.extraOwners(), owner.login]);
    }
    this.refresh();
    return owner;
  }

  async removeOwner(login: string): Promise<void> {
    await this.globalState.update(
      EXTRA_OWNERS_KEY,
      this.extraOwners().filter((l) => l.toLowerCase() !== login.toLowerCase()),
    );
    this.refresh();
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.kind) {
      case 'owner': {
        const item = new vscode.TreeItem(node.owner.login, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `owner:${node.owner.login}`;
        item.description = node.owner.isViewer ? 'you' : node.owner.isShared ? 'shared with you' : node.owner.kind === 'Organization' ? 'org' : 'user';
        item.tooltip = node.owner.isShared
          ? `${node.owner.name ?? node.owner.login}: projects linked to repositories you collaborate on`
          : (node.owner.name ?? node.owner.login);
        item.iconPath = new vscode.ThemeIcon(node.owner.kind === 'Organization' ? 'organization' : 'account');
        item.contextValue = node.owner.isManual ? 'owner.manual' : 'owner';
        return item;
      }
      case 'project': {
        const item = new vscode.TreeItem(node.project.title, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = `project:${node.project.id}`;
        item.description = `#${node.project.number} · ${node.project.itemCount} items`;
        item.tooltip = new vscode.MarkdownString(
          `**${escapeMd(node.project.title)}** #${node.project.number}\n\n${escapeMd(node.project.shortDescription ?? '')}\n\n${node.project.url}`,
        );
        item.iconPath = new vscode.ThemeIcon('project');
        item.contextValue = 'project';
        item.command = {
          command: 'ghProjects.openBoard',
          title: 'Open Board',
          arguments: [{ project: node.project }],
        };
        return item;
      }
      case 'view': {
        const item = new vscode.TreeItem(node.view.name, vscode.TreeItemCollapsibleState.None);
        item.id = `view:${node.view.id}`;
        item.description = node.view.layout;
        item.iconPath = new vscode.ThemeIcon(LAYOUT_ICONS[node.view.layout]);
        item.contextValue = 'view';
        item.command = {
          command: 'ghProjects.openBoard',
          title: 'Open Board',
          arguments: [{ project: node.project, viewId: node.view.id }],
        };
        return item;
      }
      case 'message': {
        const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.tooltip = node.text;
        return item;
      }
    }
  }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    try {
      if (!node) return await this.owners();
      if (node.kind === 'owner') {
        const projects = (await this.getApi().listProjects(node.owner.login)).filter((p) => !p.closed);
        if (projects.length === 0) return [{ kind: 'message', text: 'No open projects', icon: 'info' }];
        return projects.map((project) => ({ kind: 'project', owner: node.owner, project }));
      }
      if (node.kind === 'project') {
        const views = await this.getApi().listViews(node.project.id);
        return views.map((view) => ({ kind: 'view', owner: node.owner, project: node.project, view }));
      }
      return [];
    } catch (err) {
      if (err instanceof NotSignedInError) {
        this.setSignedIn(false);
        return [];
      }
      return [{ kind: 'message', text: reportError('Loading projects', err), icon: 'warning' }];
    }
  }

  private async owners(): Promise<TreeNode[]> {
    const owners = await this.getApi().getOwners();
    this.setSignedIn(true);
    const known = new Set(owners.map((o) => o.login.toLowerCase()));
    const extra: Owner[] = [];
    for (const login of this.extraOwners()) {
      if (known.has(login.toLowerCase())) continue;
      try {
        const owner = await this.getApi().lookupOwner(login);
        if (owner) extra.push(owner);
      } catch (err) {
        reportError(`Looking up owner ${login}`, err);
      }
    }
    // Owners of projects shared through repositories you collaborate on; a failure here must not
    // hide the rest of the tree.
    let shared: Owner[] = [];
    try {
      shared = (await this.getApi().getSharedOwners()).filter((o) => !known.has(o.login.toLowerCase()) && !extra.some((e) => e.login.toLowerCase() === o.login.toLowerCase()));
    } catch (err) {
      reportError('Looking for shared projects', err);
    }
    return [...owners, ...shared, ...extra].map((owner) => ({ kind: 'owner', owner }));
  }
}

function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
