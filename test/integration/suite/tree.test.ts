import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { createFakeApi } from './fakeApi';

interface Node {
  kind: string;
  owner?: { login: string };
  project?: { title: string };
  view?: { name: string };
  text?: string;
}
interface Api {
  __setApiFactory(factory: () => unknown): void;
  __treeChildren(node?: Node): Promise<Node[]>;
}

suite('projects tree', () => {
  let api: Api;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<Api>('guilletin63.vscode-gh-projects');
    assert.ok(ext);
    api = await ext.activate();
    api.__setApiFactory(createFakeApi);
  });

  test('lists owners, open projects and views', async () => {
    const roots = await api.__treeChildren();
    assert.deepStrictEqual(
      roots.map((n) => n.owner?.login),
      ['octo-user', 'octo-org', 'friend'],
      'owners of projects shared through collaborator repositories come after your organizations',
    );
    const shared = await api.__treeChildren(roots[2]);
    assert.deepStrictEqual(
      shared.map((n) => n.project?.title),
      ['Shared game'],
    );
    const projects = await api.__treeChildren(roots[0]);
    assert.deepStrictEqual(
      projects.map((n) => n.project?.title),
      ['Roadmap'],
      'closed projects are hidden',
    );
    const views = await api.__treeChildren(projects[0]);
    assert.deepStrictEqual(
      views.map((n) => n.view?.name),
      ['Board', 'Table'],
    );
    const empty = await api.__treeChildren(roots[1]);
    assert.strictEqual(empty[0]?.kind, 'message');
  });

  test('tree view can be shown', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.ghProjects');
    await vscode.commands.executeCommand('ghProjects.refresh');
  });
});
