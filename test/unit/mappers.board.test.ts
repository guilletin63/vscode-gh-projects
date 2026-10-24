import { describe, expect, it } from 'vitest';
import { mapField, mapFieldValue, mapItem, mapItems, mapProjectDetails, mapView } from '../../src/api/mappers';
import type { RawItem, RawItemsResponse, RawProjectDetailsResponse } from '../../src/api/raw';
import { fixture } from './fixtures';

const details = () => mapProjectDetails(fixture<RawProjectDetailsResponse>('project'))!;
const customIds = () => new Set(details().fields.filter((f) => f.kind !== 'builtin').map((f) => f.id));

describe('mapProjectDetails', () => {
  it('maps fields with kinds, options and views', () => {
    const p = details();
    expect(p).toMatchObject({ title: 'Sample project', number: 2, ownerLogin: 'octo-user' });
    const status = p.fields.find((f) => f.name === 'Status');
    expect(status?.kind).toBe('singleSelect');
    expect(status?.options?.map((o) => o.name)).toEqual(['Backlog', 'Ready', 'In progress', 'In review', 'Done']);
    expect(status?.options?.[2]?.color).toBe('YELLOW');
    expect(p.fields.find((f) => f.name === 'Title')?.kind).toBe('builtin');
    expect(p.fields.find((f) => f.name === 'Assignees')?.kind).toBe('builtin');
    expect(p.fields.filter((f) => f.kind === 'singleSelect').map((f) => f.name)).toEqual(
      expect.arrayContaining(['Status', 'Priority', 'Size']),
    );
    expect(p.views.find((v) => v.layout === 'board')?.columnFieldId).toBe(status?.id);
  });

  it('maps iteration, number, date and text fields (sandbox)', () => {
    const p = mapProjectDetails(fixture<RawProjectDetailsResponse>('sandbox-project'))!;
    const sprint = p.fields.find((f) => f.name === 'Sprint');
    expect(sprint?.kind).toBe('iteration');
    expect(sprint?.iterations?.map((i) => i.title)).toEqual(['Sprint 1', 'Sprint 2']);
    expect(sprint?.iterations?.[0]).toMatchObject({ startDate: '2026-10-12', duration: 14, completed: false });
    expect(p.fields.find((f) => f.name === 'Estimate')?.kind).toBe('number');
    expect(p.fields.find((f) => f.name === 'Due')?.kind).toBe('date');
    expect(p.fields.find((f) => f.name === 'Notes')?.kind).toBe('text');
    expect(p.fields.find((f) => f.name === 'Status')?.options?.map((o) => o.name)).toEqual(['Todo', 'In Progress', 'Done']);
  });

  it('maps the fields each view shows (sandbox)', () => {
    const p = mapProjectDetails(fixture<RawProjectDetailsResponse>('sandbox-project'))!;
    const names = (ids: string[] | undefined) => ids?.map((id) => p.fields.find((f) => f.id === id)?.name);
    const table = p.views.find((v) => v.layout === 'table');
    expect(names(table?.visibleFieldIds)).toEqual(expect.arrayContaining(['Title', 'Status', 'Priority', 'Sprint', 'Due', 'Estimate']));
    expect(p.views.map((v) => v.layout)).toEqual(expect.arrayContaining(['table', 'board', 'roadmap']));
  });

  it('maps a view sort and group-by', () => {
    const ref = (id: string) => ({ id });
    const view = mapView({
      id: 'V',
      number: 1,
      name: 'Sorted',
      layout: 'TABLE_LAYOUT',
      filter: null,
      fields: { nodes: [ref('A'), null, ref('B')] },
      sortByFields: { nodes: [{ direction: 'DESC', field: ref('B') }, { direction: 'ASC', field: ref('A') }, { direction: 'ASC', field: null }] },
      groupByFields: { nodes: [ref('S')] },
    });
    expect(view).toMatchObject({
      visibleFieldIds: ['A', 'B'],
      sortBy: [
        { fieldId: 'B', direction: 'desc' },
        { fieldId: 'A', direction: 'asc' },
      ],
      groupByFieldId: 'S',
    });
    const bare = mapView({ id: 'V', number: 1, name: 'Old', layout: 'ROADMAP_LAYOUT', filter: null });
    expect(bare).toEqual({ id: 'V', number: 1, name: 'Old', layout: 'roadmap', filter: '' });
  });

  it('returns undefined for a missing node', () => {
    expect(mapProjectDetails({ node: null })).toBeUndefined();
  });

  it('falls back to GRAY for unknown option colors and orders completed iterations first', () => {
    const f = mapField({
      __typename: 'ProjectV2IterationField',
      id: 'F',
      name: 'Iteration',
      dataType: 'ITERATION',
      configuration: {
        iterations: [{ id: 'b', title: 'Two', startDate: '2026-02-01', duration: 7 }],
        completedIterations: [{ id: 'a', title: 'One', startDate: '2026-01-01', duration: 7 }],
      },
    });
    expect(f.iterations?.map((i) => [i.id, i.completed])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    const s = mapField({ __typename: 'ProjectV2SingleSelectField', id: 'S', name: 'S', dataType: 'SINGLE_SELECT', options: [{ id: 'o', name: 'X', color: 'TEAL' }] });
    expect(s.options?.[0]?.color).toBe('GRAY');
  });
});

describe('mapItems', () => {
  it('maps the first recorded page of a >100 item project', () => {
    const page = mapItems(fixture<RawItemsResponse>('items-page1'), customIds());
    expect(page.totalCount).toBeGreaterThan(100);
    expect(page.nodes).toHaveLength(100);
    expect(page.hasNextPage).toBe(true);
    expect(page.endCursor).toBeTruthy();

    const item = page.nodes.find((i) => i.labels.length > 0)!;
    expect(item.type).toBe('Issue');
    expect(item.id).toMatch(/^PVTI_/);
    expect(item.repository).toBe('octo-user/repo-1');
    expect(item.url).toMatch(/^https:\/\/github\.com\/octo-user\/repo-1\/issues\/\d+$/);
    expect(typeof item.number).toBe('number');
    expect(item.labels[0]).toEqual({ name: expect.any(String), color: expect.stringMatching(/^[0-9A-Fa-f]{6}$/) });
  });

  it('keeps custom single-select values and drops the built-in Title text value', () => {
    const p = details();
    const status = p.fields.find((f) => f.name === 'Status')!;
    const title = p.fields.find((f) => f.name === 'Title')!;
    const items = mapItems(fixture<RawItemsResponse>('items-page1'), customIds()).nodes;
    const withStatus = items.filter((i) => i.fieldValues[status.id]);
    expect(withStatus.length).toBeGreaterThan(90);
    const v = withStatus[0]!.fieldValues[status.id]!;
    expect(v.kind).toBe('singleSelect');
    expect(status.options?.map((o) => o.id)).toContain(v.kind === 'singleSelect' ? v.optionId : '');
    expect(items.some((i) => i.fieldValues[title.id])).toBe(false);
  });

  it('maps parent issues, sub-issues, linked pull requests and dates', () => {
    const items = mapItems(fixture<RawItemsResponse>('items-page1'), customIds()).nodes;
    const child = items.find((i) => i.parent)!;
    expect(child.parent).toEqual({ number: expect.any(Number), title: expect.stringMatching(/^Sample parent issue/), url: expect.stringMatching(/^https:\/\/github\.com\//) });
    const epic = items.find((i) => i.subIssues)!;
    expect(epic.subIssues!.total).toBeGreaterThan(0);
    expect(epic.subIssues!.completed).toBeLessThanOrEqual(epic.subIssues!.total);
    const fixed = items.find((i) => i.linkedPullRequests)!;
    expect(fixed.linkedPullRequests![0]).toEqual({ number: expect.any(Number), url: expect.stringMatching(/\/pull\/\d+$/) });
    expect(items.every((i) => i.createdAt)).toBe(true);
    expect(items.some((i) => i.closedAt)).toBe(true);
    expect(items.some((i) => i.subIssues?.total === 0)).toBe(false);
  });

  it('maps the last page', () => {
    const page = mapItems(fixture<RawItemsResponse>('items-page2'), customIds());
    expect(page.nodes).toHaveLength(page.totalCount - 100);
    expect(page.hasNextPage).toBe(false);
  });
});

describe('mapItem', () => {
  const base: RawItem = {
    id: 'PVTI_x',
    type: 'PULL_REQUEST',
    isArchived: false,
    updatedAt: '2026-01-01T00:00:00Z',
    content: {
      __typename: 'PullRequest',
      id: 'PR_1',
      number: 7,
      title: 'Add thing',
      url: 'https://github.com/o/r/pull/7',
      state: 'MERGED',
      isDraft: false,
      repository: { nameWithOwner: 'o/r' },
      labels: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
      assignees: { nodes: [{ login: 'a', avatarUrl: 'https://x/a' }], pageInfo: { endCursor: null, hasNextPage: false } },
    },
    fieldValues: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
  };

  it('maps pull requests, drafts and redacted items', () => {
    expect(mapItem(base)).toMatchObject({ type: 'PullRequest', state: 'MERGED', isDraftPullRequest: false, number: 7, assignees: [{ login: 'a' }] });
    expect(mapItem({ ...base, content: { ...base.content!, milestone: { title: 'v1' } } }).milestone).toBe('v1');
    const draft = mapItem({ ...base, type: 'DRAFT_ISSUE', content: { __typename: 'DraftIssue', id: 'DI_1', title: 'Idea' } });
    expect(draft).toMatchObject({ type: 'DraftIssue', title: 'Idea', labels: [], assignees: [] });
    expect(draft.url).toBeUndefined();
    expect(mapItem({ ...base, type: 'REDACTED', content: null })).toMatchObject({ type: 'Redacted', title: 'Item you do not have access to' });
  });

  it('maps every editable field value kind', () => {
    const field = (id: string) => ({ field: { id } });
    const values = [
      { __typename: 'ProjectV2ItemFieldSingleSelectValue', optionId: 'o1', name: 'High', ...field('F1') },
      { __typename: 'ProjectV2ItemFieldTextValue', text: 'note', ...field('F2') },
      { __typename: 'ProjectV2ItemFieldNumberValue', number: 3, ...field('F3') },
      { __typename: 'ProjectV2ItemFieldDateValue', date: '2026-03-01', ...field('F4') },
      { __typename: 'ProjectV2ItemFieldIterationValue', iterationId: 'it1', title: 'Sprint 1', startDate: '2026-01-01', duration: 14, ...field('F5') },
      { __typename: 'ProjectV2ItemFieldLabelValue' },
    ];
    expect(values.map(mapFieldValue)).toEqual([
      { kind: 'singleSelect', fieldId: 'F1', optionId: 'o1', name: 'High' },
      { kind: 'text', fieldId: 'F2', text: 'note' },
      { kind: 'number', fieldId: 'F3', number: 3 },
      { kind: 'date', fieldId: 'F4', date: '2026-03-01' },
      { kind: 'iteration', fieldId: 'F5', iterationId: 'it1', title: 'Sprint 1', startDate: '2026-01-01', duration: 14 },
      undefined,
    ]);
  });

  it('skips archived items', () => {
    const page = mapItems({
      node: { items: { nodes: [base, { ...base, id: 'PVTI_y', isArchived: true }], pageInfo: { endCursor: null, hasNextPage: false }, totalCount: 2 } },
    });
    expect(page.nodes.map((i) => i.id)).toEqual(['PVTI_x']);
  });
});
