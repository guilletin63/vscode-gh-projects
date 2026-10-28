import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { createFakeApi, detailRequests, drafts, failures, filterQueries, items, listWrites, positions, projects, writes } from './fakeApi';

interface Board {
  projectId: string;
  current?: {
    items: { id: string; fieldValues: Record<string, { optionId?: string }>; labels: { name: string }[]; assignees: { login: string }[] }[];
    viewId?: string;
    filter: { text: string; labels: string[] };
    viewMatches?: { viewId: string; itemIds?: string[]; error?: string };
  };
  selectView(viewId: string): void;
  loadViewMatches(): Promise<void>;
  refresh(): Promise<void>;
  setFilter(filter: unknown): Promise<void>;
  setField(requestId: string, itemId: string, fieldId: string, input: unknown): Promise<boolean>;
  setPosition(requestId: string, itemId: string, afterId: string | undefined): Promise<boolean>;
  addDraft(requestId: string, title: string, values?: { fieldId: string; input: unknown }[]): Promise<boolean>;
  loadDetail(itemId: string): Promise<void>;
  setList(requestId: string, itemId: string, key: 'labels' | 'assignees', values: string[]): Promise<boolean>;
  openInPrExtension(itemId: string): Promise<boolean>;
  panel: vscode.WebviewPanel;
}
interface Api {
  __setApiFactory(factory: () => unknown): void;
  __boards(): Board[];
}

suite('board webview', () => {
  let api: Api;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<Api>('guilletin63.vscode-gh-projects');
    assert.ok(ext);
    api = await ext.activate();
    api.__setApiFactory(createFakeApi);
  });

  test('opens one panel per project and loads every item', async () => {
    const project = projects['octo-user']?.[0];
    const board = (await vscode.commands.executeCommand('ghProjects.openBoard', { project })) as Board;
    assert.ok(board, 'openBoard returns the panel');
    await board.refresh();
    assert.strictEqual(board.current?.items.length, items.length);
    assert.strictEqual(board.current?.viewId, 'V1', 'defaults to the board view');
    assert.strictEqual(board.panel.webview.options.enableScripts, true);
    assert.match(board.panel.webview.html, /Content-Security-Policy/);
    assert.match(board.panel.webview.html, /script-src 'nonce-[A-Za-z0-9_-]+'/);
    assert.doesNotMatch(board.panel.webview.html, /<script(?![^>]*nonce=)/, 'every script carries the nonce');

    const again = (await vscode.commands.executeCommand('ghProjects.openBoard', { project })) as Board;
    assert.strictEqual(again, board, 'reuses the existing panel');
    assert.strictEqual(api.__boards().length, 1);
    board.panel.dispose();
    assert.strictEqual(api.__boards().length, 0);
  });

  test('remembers the filter per project in workspaceState', async () => {
    const project = projects['octo-user']?.[0];
    const board = (await vscode.commands.executeCommand('ghProjects.openBoard', { project })) as Board;
    await board.refresh();
    assert.deepStrictEqual(board.current?.filter.labels, []);
    await board.setFilter({ text: 'login', labels: ['bug'], assignees: [], fields: {} });
    board.panel.dispose();

    const reopened = (await vscode.commands.executeCommand('ghProjects.openBoard', { project })) as Board;
    assert.notStrictEqual(reopened, board);
    await reopened.refresh();
    assert.strictEqual(reopened.current?.filter.text, 'login');
    assert.deepStrictEqual(reopened.current?.filter.labels, ['bug']);
    await reopened.setFilter({ text: '', labels: [], assignees: [], fields: {} });
    reopened.panel.dispose();
  });

  test('moves a card by writing the column field, and keeps state on failure', async () => {
    const project = projects['octo-user']?.[0];
    const board = (await vscode.commands.executeCommand('ghProjects.openBoard', { project })) as Board;
    await board.refresh();
    const ok = await board.setField('r1', 'PVTI_1', 'F1', { kind: 'singleSelect', optionId: 'done' });
    assert.strictEqual(ok, true);
    assert.deepStrictEqual(writes.at(-1), { itemId: 'PVTI_1', fieldId: 'F1', input: { kind: 'singleSelect', optionId: 'done' } });
    assert.strictEqual(board.current?.items.find((i) => i.id === 'PVTI_1')?.fieldValues.F1?.optionId, 'done');

    failures.next = true;
    const failed = await board.setField('r2', 'PVTI_1', 'F1', { kind: 'singleSelect', optionId: 'todo' });
    assert.strictEqual(failed, false);
    assert.strictEqual(board.current?.items.find((i) => i.id === 'PVTI_1')?.fieldValues.F1?.optionId, 'done', 'host state unchanged');

    const invalid = await board.setField('r3', 'PVTI_1', 'F1', { kind: 'singleSelect', optionId: 'nope' });
    assert.strictEqual(invalid, false, 'unknown options are rejected before calling GitHub');
    board.panel.dispose();
  });

  test('loads item details and only offers GitHub Pull Requests when installed', async () => {
    const project = projects['octo-user']?.[0];
    const board = (await vscode.commands.executeCommand('ghProjects.openBoard', { project })) as Board;
    await board.refresh();
    await board.loadDetail('PVTI_3');
    assert.strictEqual(detailRequests.at(-1), 'PVTI_3');
    const installed = vscode.extensions.getExtension('GitHub.vscode-pull-request-github') !== undefined;
    assert.strictEqual(await board.openInPrExtension('PVTI_3'), installed ? true : false);
    board.panel.dispose();
  });

  test('moves an item in the project order, and keeps the order on failure', async () => {
    const project = projects['octo-user']?.[0];
    const board = (await vscode.commands.executeCommand('ghProjects.openBoard', { project })) as Board;
    await board.refresh();
    const ids = () => board.current?.items.slice(0, 4).map((i) => i.id);
    assert.strictEqual(await board.setPosition('p1', 'PVTI_3', 'PVTI_0'), true);
    assert.deepStrictEqual(positions.at(-1), { itemId: 'PVTI_3', afterId: 'PVTI_0' });
    assert.deepStrictEqual(ids(), ['PVTI_0', 'PVTI_3', 'PVTI_1', 'PVTI_2']);
    assert.strictEqual(await board.setPosition('p2', 'PVTI_2', undefined), true);
    assert.deepStrictEqual(ids(), ['PVTI_2', 'PVTI_0', 'PVTI_3', 'PVTI_1']);

    failures.next = true;
    assert.strictEqual(await board.setPosition('p3', 'PVTI_1', undefined), false);
    assert.deepStrictEqual(ids(), ['PVTI_2', 'PVTI_0', 'PVTI_3', 'PVTI_1'], 'host order unchanged');
    assert.strictEqual(await board.setPosition('p4', 'PVTI_1', 'gone'), false, 'unknown afterId is rejected');
    board.panel.dispose();
  });

  test('sets labels and assignees one edit at a time per item', async () => {
    const project = projects['octo-user']?.[0];
    const board = (await vscode.commands.executeCommand('ghProjects.openBoard', { project })) as Board;
    await board.refresh();
    const item = () => board.current?.items.find((i) => i.id === 'PVTI_4');
    listWrites.length = 0;
    // Adding then removing a label quickly must not end with the label added.
    const [added, removed] = await Promise.all([board.setList('l1', 'PVTI_4', 'labels', ['bug']), board.setList('l2', 'PVTI_4', 'labels', [])]);
    assert.ok(added && removed);
    assert.deepStrictEqual(listWrites, ['start PVTI_4 bug', 'end PVTI_4 bug', 'start PVTI_4 ', 'end PVTI_4 ']);
    assert.deepStrictEqual(item()?.labels, []);

    assert.strictEqual(await board.setList('l3', 'PVTI_4', 'assignees', ['octo-user', 'friend']), true);
    assert.deepStrictEqual(item()?.assignees, [{ login: 'octo-user' }, { login: 'friend' }]);

    failures.next = true;
    assert.strictEqual(await board.setList('l4', 'PVTI_4', 'labels', ['documentation']), false);
    assert.deepStrictEqual(item()?.labels, [], 'labels unchanged after a failure');
    assert.strictEqual(await board.setList('l5', 'gone', 'labels', ['bug']), false);
    board.panel.dispose();
  });

  test('adds a draft with the value of its column, and rejects invalid values', async () => {
    const project = projects['octo-user']?.[0];
    const board = (await vscode.commands.executeCommand('ghProjects.openBoard', { project })) as Board;
    await board.refresh();
    const before = writes.length;
    assert.strictEqual(await board.addDraft('a1', 'New idea', [{ fieldId: 'F1', input: { kind: 'singleSelect', optionId: 'doing' } }]), true);
    assert.strictEqual(drafts.at(-1), 'New idea');
    assert.deepStrictEqual(writes.at(-1), { itemId: `PVTI_draft_${drafts.length}`, fieldId: 'F1', input: { kind: 'singleSelect', optionId: 'doing' } });
    assert.strictEqual(await board.addDraft('a2', 'No column'), true);
    assert.strictEqual(writes.length, before + 1, 'no field write without a column');
    assert.strictEqual(await board.addDraft('a3', 'Bad', [{ fieldId: 'F1', input: { kind: 'singleSelect', optionId: 'nope' } }]), false);
    assert.strictEqual(drafts.at(-1), 'No column', 'nothing created for an invalid value');
    board.panel.dispose();
  });

  test("applies the view's own filter through GitHub, once per view", async () => {
    const project = projects['octo-user']?.[0];
    const board = (await vscode.commands.executeCommand('ghProjects.openBoard', { project })) as Board;
    await board.refresh();
    assert.strictEqual(board.current?.viewMatches, undefined, 'the board view has no filter');
    const before = filterQueries.length;
    board.selectView('V3');
    await board.loadViewMatches();
    const done = items.filter((i) => (i.fieldValues as { F1?: { optionId: string } }).F1?.optionId === 'done').map((i) => i.id);
    assert.deepStrictEqual(board.current?.viewMatches, { viewId: 'V3', itemIds: done });
    await board.loadViewMatches();
    assert.strictEqual(filterQueries.length, before + 1, 'cached until the next load');
    board.selectView('V1');
    await board.loadViewMatches();
    assert.strictEqual(board.current?.viewMatches, undefined);
    board.panel.dispose();
  });
});
