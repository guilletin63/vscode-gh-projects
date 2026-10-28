// Exercises the real write path (updateProjectV2ItemFieldValue / clearProjectV2ItemFieldValue)
// against the throw-away sandbox project. Refuses to run against anything else.
import { beforeAll, describe, expect, it } from 'vitest';
import { GraphQLClient, GraphQLError } from '../../src/api/client';
import { GitHubProjectsApi } from '../../src/api/projectsApi';
import type { ProjectDetails, ProjectField } from '../../src/model/types';

const SANDBOX_ID = 'PVT_kwHOBCq4Uc4BoSUH';
const SANDBOX_TITLE = 'vscode-gh-projects sandbox';
/** A draft item created in the sandbox for these tests. */
const ITEM_ID = process.env.GHP_SANDBOX_ITEM ?? 'PVTI_lAHOBCq4Uc4BoSUHzhCzpM0';
/** A sandbox issue (its labels are changed and put back). */
const ISSUE_ITEM_ID = process.env.GHP_SANDBOX_ISSUE ?? 'PVTI_lAHOBCq4Uc4BoSUHzhCzoiY';
const token = process.env.GHP_LIVE_TOKEN;

const client = new GraphQLClient({ tokenProvider: async () => token ?? '' });
const api = new GitHubProjectsApi(client);

async function readStatus(fieldName: string): Promise<string | null> {
  const r = await client.request<{ node: { project: { id: string }; fieldValueByName: { optionId?: string } | null } }>(
    `query($id: ID!, $name: String!) { node(id: $id) { ... on ProjectV2Item {
      project { id }
      fieldValueByName(name: $name) { ... on ProjectV2ItemFieldSingleSelectValue { optionId } }
    } } }`,
    { id: ITEM_ID, name: fieldName },
  );
  expect(r.node.project.id).toBe(SANDBOX_ID);
  return r.node.fieldValueByName?.optionId ?? null;
}

describe.skipIf(!token)('sandbox writes (live)', () => {
  let project: ProjectDetails;
  let status: ProjectField;

  beforeAll(async () => {
    project = await api.getProject(SANDBOX_ID);
    // Safety net: never write anywhere but the sandbox.
    expect(project.title).toBe(SANDBOX_TITLE);
    status = project.fields.find((f) => f.name === 'Status')!;
    expect(status.options?.length).toBeGreaterThanOrEqual(2);
  });

  it('moves the item between Status options and clears it', async () => {
    const [a, b] = status.options!;
    await api.setFieldValue(SANDBOX_ID, ITEM_ID, status.id, { kind: 'singleSelect', optionId: a!.id });
    expect(await readStatus('Status')).toBe(a!.id);
    await api.setFieldValue(SANDBOX_ID, ITEM_ID, status.id, { kind: 'singleSelect', optionId: b!.id });
    expect(await readStatus('Status')).toBe(b!.id);
    await api.setFieldValue(SANDBOX_ID, ITEM_ID, status.id, null);
    expect(await readStatus('Status')).toBeNull();
  });

  it('fails with a GraphQL error for an unknown option (what the board rolls back)', async () => {
    const err = await api
      .setFieldValue(SANDBOX_ID, ITEM_ID, status.id, { kind: 'singleSelect', optionId: 'does-not-exist' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphQLError);
  });

  it('edits text, number, date and iteration fields and clears them', async () => {
    const byName = (name: string) => project.fields.find((f) => f.name === name)!;
    const notes = byName('Notes');
    const estimate = byName('Estimate');
    const due = byName('Due');
    const sprint = byName('Sprint');
    const sprintId = sprint.iterations!.find((i) => !i.completed)!.id;

    await api.setFieldValue(SANDBOX_ID, ITEM_ID, notes.id, { kind: 'text', text: 'Live test note' });
    await api.setFieldValue(SANDBOX_ID, ITEM_ID, estimate.id, { kind: 'number', number: 3.5 });
    await api.setFieldValue(SANDBOX_ID, ITEM_ID, due.id, { kind: 'date', date: '2026-11-02' });
    await api.setFieldValue(SANDBOX_ID, ITEM_ID, sprint.id, { kind: 'iteration', iterationId: sprintId });

    const read = async () =>
      (
        await client.request<{ node: { fieldValues: { nodes: Record<string, unknown>[] } } }>(
          `query($id: ID!) { node(id: $id) { ... on ProjectV2Item { fieldValues(first: 30) { nodes {
            ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2FieldCommon { name } } }
          } } } } }`,
          { id: ITEM_ID },
        )
      ).node.fieldValues.nodes.filter((n) => (n.field as { name?: string } | undefined)?.name);
    const byField = (nodes: Record<string, unknown>[], name: string) => nodes.find((n) => (n.field as { name: string }).name === name);

    let nodes = await read();
    expect(byField(nodes, 'Notes')?.text).toBe('Live test note');
    expect(byField(nodes, 'Estimate')?.number).toBe(3.5);
    expect(byField(nodes, 'Due')?.date).toBe('2026-11-02');
    expect(byField(nodes, 'Sprint')?.iterationId).toBe(sprintId);

    for (const f of [notes, estimate, due, sprint]) await api.setFieldValue(SANDBOX_ID, ITEM_ID, f.id, null);
    nodes = await read();
    for (const name of ['Notes', 'Estimate', 'Due', 'Sprint']) expect(byField(nodes, name)).toBeUndefined();
  });

  it('moves an item in the project order and back', async () => {
    const order = async () => {
      const r = await client.request<{ node: { items: { nodes: { id: string }[] } } }>(
        `query($id: ID!) { node(id: $id) { ... on ProjectV2 { items(first: 100) { nodes { id } } } } }`,
        { id: SANDBOX_ID },
      );
      return r.node.items.nodes.map((n) => n.id);
    };
    const before = await order();
    const index = before.indexOf(ITEM_ID);
    const previous = index > 0 ? before[index - 1] : undefined;
    await api.setItemPosition(SANDBOX_ID, ITEM_ID, undefined);
    expect((await order())[0]).toBe(ITEM_ID);
    await api.setItemPosition(SANDBOX_ID, ITEM_ID, previous);
    expect(await order()).toEqual(before);
  });

  it('adds a draft issue (then archives it)', async () => {
    const id = await api.addDraftIssue(SANDBOX_ID, 'Live test draft');
    expect(id).toMatch(/^PVTI_/);
    const status = project.fields.find((f) => f.name === 'Status')!;
    await api.setFieldValue(SANDBOX_ID, id, status.id, { kind: 'singleSelect', optionId: status.options![0]!.id });
    await client.request(
      `mutation($p: ID!, $i: ID!) { archiveProjectV2Item(input: { projectId: $p, itemId: $i }) { item { id } } }`,
      { p: SANDBOX_ID, i: id },
      { write: true },
    );
  });

  it("adds a label to an issue and takes it off again", async () => {
    const names = async () => {
      const c = await api.getItemChoices(ISSUE_ITEM_ID);
      return c.current.labels.map((id) => c.labels.find((l) => l.id === id)!.name).sort();
    };
    const choices = await api.getItemChoices(ISSUE_ITEM_ID);
    expect(choices).toMatchObject({ contentType: 'Issue', labelable: true });
    const before = await names();
    const extra = choices.labels.find((l) => !before.includes(l.name))!.name;
    expect((await api.setLabels(ISSUE_ITEM_ID, [...before, extra])).map((l) => l.name).sort()).toEqual([...before, extra].sort());
    expect(await names()).toEqual([...before, extra].sort());
    await api.setLabels(ISSUE_ITEM_ID, before);
    expect(await names()).toEqual(before);
  });

  it("clears a draft's assignees and puts them back", async () => {
    const logins = async () => {
      const c = await api.getItemChoices(ITEM_ID);
      return c.current.assignees.map((id) => c.assignees.find((u) => u.id === id)!.login);
    };
    const choices = await api.getItemChoices(ITEM_ID);
    expect(choices).toMatchObject({ contentType: 'DraftIssue', labelable: false, labels: [] });
    const before = await logins();
    expect(await api.setAssignees(ITEM_ID, [])).toEqual([]);
    expect(await logins()).toEqual([]);
    await api.setAssignees(ITEM_ID, before);
    expect(await logins()).toEqual(before);
  });
});
