import { describe, expect, it } from 'vitest';
import type { GraphQLClient } from '../../src/api/client';
import { GitHubProjectsApi } from '../../src/api/projectsApi';
import { ADD_DRAFT_ISSUE_MUTATION, CLEAR_FIELD_VALUE_MUTATION, UPDATE_FIELD_VALUE_MUTATION, UPDATE_ITEM_POSITION_MUTATION } from '../../src/api/queries';
import { PendingEdits, afterIdFor, isSameValue, moveItemAfter, setItemValue, toFieldValue, toGraphQLValue, validateInput } from '../../src/model/edits';
import type { ProjectField, ProjectItem } from '../../src/model/types';

const status: ProjectField = {
  id: 'S',
  name: 'Status',
  dataType: 'SINGLE_SELECT',
  kind: 'singleSelect',
  options: [
    { id: 'todo', name: 'Todo', color: 'GRAY' },
    { id: 'done', name: 'Done', color: 'GREEN' },
  ],
};
const sprint: ProjectField = {
  id: 'I',
  name: 'Sprint',
  dataType: 'ITERATION',
  kind: 'iteration',
  iterations: [{ id: 'it1', title: 'Sprint 1', startDate: '2026-10-12', duration: 14, completed: false }],
};
const card = (id: string, optionId?: string): ProjectItem => ({
  id,
  type: 'Issue',
  title: id,
  labels: [],
  assignees: [],
  updatedAt: '',
  fieldValues: optionId ? { S: { kind: 'singleSelect', fieldId: 'S', optionId, name: optionId } } : {},
});
const column = (items: ProjectItem[], id: string) => {
  const v = items.find((i) => i.id === id)?.fieldValues.S;
  return v?.kind === 'singleSelect' ? v.optionId : undefined;
};

describe('mutation inputs', () => {
  it('maps every input kind to ProjectV2FieldValue', () => {
    expect(toGraphQLValue({ kind: 'singleSelect', optionId: 'o' })).toEqual({ singleSelectOptionId: 'o' });
    expect(toGraphQLValue({ kind: 'iteration', iterationId: 'i' })).toEqual({ iterationId: 'i' });
    expect(toGraphQLValue({ kind: 'text', text: 't' })).toEqual({ text: 't' });
    expect(toGraphQLValue({ kind: 'number', number: 2.5 })).toEqual({ number: 2.5 });
    expect(toGraphQLValue({ kind: 'date', date: '2026-10-22' })).toEqual({ date: '2026-10-22' });
  });

  it('validates inputs against the field', () => {
    expect(validateInput(status, { kind: 'singleSelect', optionId: 'done' })).toBeUndefined();
    expect(validateInput(status, { kind: 'singleSelect', optionId: 'gone' })).toMatch(/Unknown option/);
    expect(validateInput(status, { kind: 'text', text: 'x' })).toMatch(/not a text field/);
    expect(validateInput(sprint, { kind: 'iteration', iterationId: 'it1' })).toBeUndefined();
    expect(validateInput({ ...status, kind: 'date' }, { kind: 'date', date: '22/10/2026' })).toMatch(/YYYY-MM-DD/);
    expect(validateInput({ ...status, kind: 'number' }, { kind: 'number', number: Number.NaN })).toMatch(/number/);
    expect(validateInput(status, null)).toBeUndefined();
  });

  it('builds optimistic model values', () => {
    expect(toFieldValue(status, { kind: 'singleSelect', optionId: 'done' })).toEqual({ kind: 'singleSelect', fieldId: 'S', optionId: 'done', name: 'Done' });
    expect(toFieldValue(sprint, { kind: 'iteration', iterationId: 'it1' })).toMatchObject({ title: 'Sprint 1', duration: 14 });
    expect(toFieldValue(status, null)).toBeUndefined();
  });

  it('sends update and clear mutations with the write token', async () => {
    const calls: { query: string; vars: unknown; write: boolean | undefined }[] = [];
    const client = {
      request: async (query: string, vars: unknown, opts?: { write?: boolean }) => {
        calls.push({ query, vars, write: opts?.write });
        return {};
      },
    } as unknown as GraphQLClient;
    const api = new GitHubProjectsApi(client);
    await api.setFieldValue('P', 'IT', 'S', { kind: 'singleSelect', optionId: 'done' });
    await api.setFieldValue('P', 'IT', 'S', null);
    expect(calls).toEqual([
      { query: UPDATE_FIELD_VALUE_MUTATION, vars: { projectId: 'P', itemId: 'IT', fieldId: 'S', value: { singleSelectOptionId: 'done' } }, write: true },
      { query: CLEAR_FIELD_VALUE_MUTATION, vars: { projectId: 'P', itemId: 'IT', fieldId: 'S' }, write: true },
    ]);
  });

  it('sends position and draft mutations with the write token', async () => {
    const calls: { query: string; vars: unknown; write: boolean | undefined }[] = [];
    let reply: unknown = {};
    const client = {
      request: async (query: string, vars: unknown, opts?: { write?: boolean }) => {
        calls.push({ query, vars, write: opts?.write });
        return reply;
      },
    } as unknown as GraphQLClient;
    const api = new GitHubProjectsApi(client);
    await api.setItemPosition('P', 'IT', 'A');
    await api.setItemPosition('P', 'IT', undefined);
    reply = { addProjectV2DraftIssue: { projectItem: { id: 'PVTI_new' } } };
    expect(await api.addDraftIssue('P', 'Idea')).toBe('PVTI_new');
    expect(calls).toEqual([
      { query: UPDATE_ITEM_POSITION_MUTATION, vars: { projectId: 'P', itemId: 'IT', afterId: 'A' }, write: true },
      { query: UPDATE_ITEM_POSITION_MUTATION, vars: { projectId: 'P', itemId: 'IT', afterId: null }, write: true },
      { query: ADD_DRAFT_ISSUE_MUTATION, vars: { projectId: 'P', title: 'Idea' }, write: true },
    ]);
    reply = { addProjectV2DraftIssue: null };
    await expect(api.addDraftIssue('P', 'Idea')).rejects.toThrow(/new item/);
  });
});

describe('optimistic edits', () => {
  it('setItemValue is immutable and returns the previous value', () => {
    const items = [card('a', 'todo'), card('b')];
    const { items: next, previous } = setItemValue(items, 'a', 'S', undefined);
    expect(previous).toMatchObject({ optionId: 'todo' });
    expect(column(next, 'a')).toBeUndefined();
    expect(column(items, 'a')).toBe('todo');
    expect(next[1]).toBe(items[1]);
  });

  it('moves immediately and keeps the move on confirm', () => {
    const edits = new PendingEdits();
    const { requestId, items } = edits.apply([card('a', 'todo')], 'a', status, { kind: 'singleSelect', optionId: 'done' });
    expect(column(items, 'a')).toBe('done');
    edits.confirm(requestId);
    expect(edits.size).toBe(0);
    expect(column(edits.revert(items, requestId), 'a')).toBe('done');
  });

  it('rolls back a failed move to the original column, also from "no value"', () => {
    const edits = new PendingEdits();
    let items = [card('a', 'todo'), card('b')];
    const m1 = edits.apply(items, 'a', status, { kind: 'singleSelect', optionId: 'done' });
    items = m1.items;
    const m2 = edits.apply(items, 'b', status, { kind: 'singleSelect', optionId: 'todo' });
    items = m2.items;
    items = edits.revert(items, m1.requestId);
    expect(column(items, 'a')).toBe('todo');
    expect(column(items, 'b')).toBe('todo');
    items = edits.revert(items, m2.requestId);
    expect(column(items, 'b')).toBeUndefined();
  });

  it('re-applies in-flight moves on top of refreshed data', () => {
    const edits = new PendingEdits();
    edits.apply([card('a', 'todo')], 'a', status, { kind: 'singleSelect', optionId: 'done' });
    const refreshed = [card('a', 'todo'), card('c')];
    expect(column(edits.reapply(refreshed), 'a')).toBe('done');
  });
});

describe('positions', () => {
  const ids = (items: ProjectItem[]) => items.map((i) => i.id).join('');
  const items = ['a', 'b', 'c', 'd'].map((id) => card(id));

  it('moves an item after another or to the top and reports where it was', () => {
    expect(ids(moveItemAfter(items, 'a', 'c').items)).toBe('bcad');
    expect(moveItemAfter(items, 'c', undefined)).toMatchObject({ previousAfterId: 'b' });
    expect(ids(moveItemAfter(items, 'c', undefined).items)).toBe('cabd');
    expect(ids(moveItemAfter(items, 'a', 'gone').items)).toBe('abcd');
  });

  it('computes afterId to drop before or after a target', () => {
    expect(afterIdFor(items, 'd', 'b', 'before')).toBe('a');
    expect(afterIdFor(items, 'd', 'a', 'before')).toBeUndefined();
    expect(afterIdFor(items, 'a', 'c', 'after')).toBe('c');
    // Already there: nothing to do.
    expect(afterIdFor(items, 'b', 'c', 'before')).toBeNull();
    expect(afterIdFor(items, 'b', 'a', 'after')).toBeNull();
    expect(afterIdFor(items, 'b', 'b', 'after')).toBeNull();
  });

  it('applies, re-applies and rolls back moves', () => {
    const edits = new PendingEdits();
    const move = edits.applyPosition(items, 'd', 'a');
    expect(ids(move.items)).toBe('adbc');
    expect(ids(edits.reapply(items))).toBe('adbc');
    expect(ids(edits.revert(move.items, move.requestId))).toBe('abcd');
    expect(edits.size).toBe(0);
  });

  it('rolls back a move to the top', () => {
    const edits = new PendingEdits();
    const move = edits.applyPosition(items, 'a', 'c');
    expect(ids(edits.revert(move.items, move.requestId))).toBe('abcd');
  });
});

describe('isSameValue', () => {
  it('compares a value with the input that would replace it', () => {
    const v = { kind: 'singleSelect' as const, fieldId: 'S', optionId: 'todo', name: 'Todo' };
    expect(isSameValue(v, { kind: 'singleSelect', optionId: 'todo' })).toBe(true);
    expect(isSameValue(v, { kind: 'singleSelect', optionId: 'done' })).toBe(false);
    expect(isSameValue(v, null)).toBe(false);
    expect(isSameValue(undefined, null)).toBe(true);
    expect(isSameValue({ kind: 'date', fieldId: 'D', date: '2026-10-01' }, { kind: 'date', date: '2026-10-01' })).toBe(true);
    expect(isSameValue({ kind: 'number', fieldId: 'N', number: 3 }, { kind: 'text', text: '3' })).toBe(false);
  });
});
