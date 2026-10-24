import { describe, expect, it } from 'vitest';
import { NO_VALUE_GROUP, cellText, fieldSum, groupInput, groupItems, groupableFields, isEditableField, sortItems, tableColumns } from '../../src/model/table';
import type { FieldValue, ProjectField, ProjectItem, ProjectView } from '../../src/model/types';

const builtin = (id: string, name: string, dataType: string): ProjectField => ({ id, name, dataType, kind: 'builtin' });
const title = builtin('TI', 'Title', 'TITLE');
const assignees = builtin('AS', 'Assignees', 'ASSIGNEES');
const labels = builtin('LA', 'Labels', 'LABELS');
const reviewers = builtin('RV', 'Reviewers', 'REVIEWERS');
const linked = builtin('LP', 'Linked pull requests', 'LINKED_PULL_REQUESTS');
const status: ProjectField = {
  id: 'ST',
  name: 'Status',
  dataType: 'SINGLE_SELECT',
  kind: 'singleSelect',
  options: ['Todo', 'Doing', 'Done'].map((o) => ({ id: o, name: o, color: 'GRAY' as const })),
};
const estimate: ProjectField = { id: 'ES', name: 'Estimate', dataType: 'NUMBER', kind: 'number' };
const sprint: ProjectField = {
  id: 'SP',
  name: 'Sprint',
  dataType: 'ITERATION',
  kind: 'iteration',
  iterations: [
    { id: 'it2', title: 'Sprint 2', startDate: '2026-10-26', duration: 14, completed: false },
    { id: 'it1', title: 'Sprint 1', startDate: '2026-10-12', duration: 14, completed: false },
  ],
};
const fields = [title, assignees, status, labels, reviewers, linked, estimate, sprint];

const view = (extra: Partial<ProjectView>): ProjectView => ({ id: 'V', number: 1, name: 'T', layout: 'table', filter: '', ...extra });

function item(id: string, opts: { values?: FieldValue[]; assignees?: string[] } & Partial<Omit<ProjectItem, 'assignees'>> = {}): ProjectItem {
  const { values = [], assignees: logins = [], ...rest } = opts;
  return {
    id,
    type: 'Issue',
    title: id,
    labels: [],
    assignees: logins.map((login) => ({ login })),
    updatedAt: '2026-10-20T10:00:00Z',
    fieldValues: Object.fromEntries(values.map((v) => [v.fieldId, v])),
    ...rest,
  };
}
const st = (optionId: string): FieldValue => ({ kind: 'singleSelect', fieldId: 'ST', optionId, name: optionId });
const est = (n: number): FieldValue => ({ kind: 'number', fieldId: 'ES', number: n });
const iterationValue = (iterationId: string, t: string): FieldValue => ({ kind: 'iteration', fieldId: 'SP', iterationId, title: t, startDate: '', duration: 14 });

describe('tableColumns', () => {
  it('follows the view order, puts Title first and hides fields it cannot show', () => {
    const { columns, hidden } = tableColumns(fields, view({ visibleFieldIds: ['ST', 'RV', 'TI', 'ES', 'LP'] }));
    expect(columns.map((c) => c.field.name)).toEqual(['Title', 'Status', 'Estimate', 'Linked pull requests']);
    expect(columns.map((c) => c.cell)).toEqual(['title', 'field', 'field', 'linkedPullRequests']);
    expect(hidden.map((f) => f.name)).toEqual(['Reviewers']);
  });

  it('falls back to Title, Assignees, Labels and custom fields', () => {
    expect(tableColumns(fields).columns.map((c) => c.field.name)).toEqual(['Title', 'Assignees', 'Status', 'Labels', 'Estimate', 'Sprint']);
  });
});

describe('cellText', () => {
  it('renders built-in and custom values as text', () => {
    const i = item('A', {
      values: [st('Doing'), est(3)],
      assignees: ['ana', 'bo'],
      linkedPullRequests: [{ number: 7, url: 'https://github.com/o/r/pull/7' }],
      subIssues: { total: 4, completed: 1 },
      createdAt: '2026-10-01T08:00:00Z',
    });
    const col = (f: ProjectField) => tableColumns(fields, view({ visibleFieldIds: [f.id] })).columns.at(-1)!;
    expect(cellText(i, col(assignees))).toBe('ana, bo');
    expect(cellText(i, col(status))).toBe('Doing');
    expect(cellText(i, col(estimate))).toBe('3');
    expect(cellText(i, col(linked))).toBe('#7');
    expect(cellText(i, { field: builtin('SI', 'Sub-issues progress', 'SUB_ISSUES_PROGRESS'), cell: 'subIssues' })).toBe('1/4');
    expect(cellText(i, { field: builtin('CR', 'Created', 'CREATED'), cell: 'created' })).toBe('2026-10-01');
    expect(cellText(item('B'), col(status))).toBe('');
  });
});

describe('sortItems', () => {
  const items = [item('c', { values: [st('Done'), est(2)] }), item('a', { values: [est(10)] }), item('b', { values: [st('Todo'), est(2)] })];

  it('keeps the project order without a sort', () => {
    expect(sortItems(items, undefined, fields).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('sorts options in field order and numbers numerically, empty values last', () => {
    expect(sortItems(items, [{ fieldId: 'ST', direction: 'asc' }], fields).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(sortItems(items, [{ fieldId: 'ST', direction: 'desc' }], fields).map((i) => i.id)).toEqual(['c', 'b', 'a']);
    expect(sortItems(items, [{ fieldId: 'ES', direction: 'desc' }], fields).map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('uses later sort keys for ties and ignores unknown fields', () => {
    const sorts = [{ fieldId: 'ES', direction: 'asc' as const }, { fieldId: 'TI', direction: 'asc' as const }];
    expect(sortItems(items, sorts, fields).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(sortItems(items, [{ fieldId: 'nope', direction: 'asc' }], fields).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('groupItems', () => {
  it('groups by options in field order with "No <field>" last, hiding empty groups', () => {
    const groups = groupItems([item('a', { values: [st('Done')] }), item('b'), item('c', { values: [st('Todo')] })], status);
    expect(groups.map((g) => [g.name, g.items.map((i) => i.id)])).toEqual([
      ['Todo', ['c']],
      ['Done', ['a']],
      ['No Status', ['b']],
    ]);
    expect(groups.at(-1)?.id).toBe(NO_VALUE_GROUP);
    expect(groups[0]?.option?.name).toBe('Todo');
  });

  it('groups iterations by start date and other values by text', () => {
    const items = [item('a', { values: [iterationValue('it2', 'Sprint 2')] }), item('b', { values: [iterationValue('it1', 'Sprint 1')] })];
    expect(groupItems(items, sprint).map((g) => g.name)).toEqual(['Sprint 1', 'Sprint 2']);
    const people = [item('a', { assignees: ['zoe'] }), item('b', { assignees: ['ana'] }), item('c', { assignees: ['zoe'] })];
    expect(groupItems(people, assignees).map((g) => [g.name, g.items.length])).toEqual([
      ['ana', 1],
      ['zoe', 2],
    ]);
    const numbers = [item('a', { values: [est(10)] }), item('b', { values: [est(9)] })];
    expect(groupItems(numbers, estimate).map((g) => g.name)).toEqual(['9', '10']);
  });

  it('returns a single group without a field', () => {
    expect(groupItems([item('a')], undefined)).toMatchObject([{ id: NO_VALUE_GROUP, items: [{ id: 'a' }] }]);
  });

  it('only offers fields GitHub can group by', () => {
    expect(groupableFields(fields).map((f) => f.name)).toEqual(['Assignees', 'Status', 'Estimate', 'Sprint']);
  });
});

describe('editing through groups', () => {
  it('turns a group into the value an item dropped on it gets', () => {
    expect(groupInput(status, 'Done')).toEqual({ kind: 'singleSelect', optionId: 'Done' });
    expect(groupInput(status, NO_VALUE_GROUP)).toBeNull();
    expect(groupInput(status, 'nope')).toBeUndefined();
    expect(groupInput(sprint, 'it1')).toEqual({ kind: 'iteration', iterationId: 'it1' });
    expect(groupInput(estimate, '5')).toEqual({ kind: 'number', number: 5 });
    expect(groupInput({ id: 'D', name: 'Due', dataType: 'DATE', kind: 'date' }, '2026-10-01')).toEqual({ kind: 'date', date: '2026-10-01' });
    expect(groupInput({ id: 'N', name: 'Notes', dataType: 'TEXT', kind: 'text' }, 'x')).toEqual({ kind: 'text', text: 'x' });
    expect(groupInput(assignees, 'ana')).toBeUndefined();
    expect(isEditableField(status)).toBe(true);
    expect(isEditableField(assignees)).toBe(false);
  });

  it('sums number fields', () => {
    expect(fieldSum([item('a', { values: [est(2.5)] }), item('b'), item('c', { values: [est(3)] })], estimate)).toBe(5.5);
    expect(fieldSum([item('a')], estimate)).toBeUndefined();
  });
});
