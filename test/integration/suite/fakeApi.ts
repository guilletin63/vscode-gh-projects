// In-memory ProjectsApi used by integration tests. Kept structurally typed so the test project
// does not import extension sources.
export const owners = [
  { login: 'octo-user', kind: 'User', isViewer: true },
  { login: 'octo-org', kind: 'Organization', isViewer: false },
];

export const projects: Record<string, unknown[]> = {
  'octo-user': [
    { id: 'P1', number: 1, title: 'Roadmap', url: 'https://github.com/users/octo-user/projects/1', closed: false, ownerLogin: 'octo-user', itemCount: 3, updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'P2', number: 2, title: 'Old', url: 'https://github.com/users/octo-user/projects/2', closed: true, ownerLogin: 'octo-user', itemCount: 0, updatedAt: '2025-01-01T00:00:00Z' },
  ],
  'octo-org': [],
  friend: [
    { id: 'P9', number: 9, title: 'Shared game', url: 'https://github.com/users/friend/projects/9', closed: false, ownerLogin: 'friend', itemCount: 4, updatedAt: '2026-01-01T00:00:00Z' },
  ],
};

export const projectDetails = {
  id: 'P1',
  number: 1,
  title: 'Roadmap',
  url: 'https://github.com/users/octo-user/projects/1',
  ownerLogin: 'octo-user',
  fields: [
    { id: 'F-title', name: 'Title', dataType: 'TITLE', kind: 'builtin' },
    {
      id: 'F1',
      name: 'Status',
      dataType: 'SINGLE_SELECT',
      kind: 'singleSelect',
      options: [
        { id: 'todo', name: 'Todo', color: 'GRAY' },
        { id: 'doing', name: 'In progress', color: 'YELLOW' },
        { id: 'done', name: 'Done', color: 'GREEN' },
      ],
    },
  ],
  views: [
    { id: 'V1', number: 1, name: 'Board', layout: 'board', filter: '', columnFieldId: 'F1' },
    { id: 'V3', number: 3, name: 'Done', layout: 'table', filter: 'status:Done' },
  ],
};

/** 250 items so the board exercises more than one page worth of cards. */
export const items = Array.from({ length: 250 }, (_, i) => ({
  id: `PVTI_${i}`,
  type: 'Issue',
  number: i + 1,
  title: `Item ${i + 1}`,
  url: `https://github.com/octo-user/repo/issues/${i + 1}`,
  state: 'OPEN',
  repository: 'octo-user/repo',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  assignees: [{ login: 'octo-user' }],
  fieldValues:
    i % 10 === 0
      ? {}
      : { F1: { kind: 'singleSelect', fieldId: 'F1', optionId: ['todo', 'doing', 'done'][i % 3], name: '' } },
  updatedAt: '2026-01-01T00:00:00Z',
}));

export const writes: { itemId: string; fieldId: string; input: unknown }[] = [];
export const positions: { itemId: string; afterId: string | undefined }[] = [];
export const drafts: string[] = [];
export const failures = { next: false };
export const filterQueries: string[] = [];

export const detailRequests: string[] = [];

export function createFakeApi() {
  return {
    getItemDetail: async (itemId: string) => {
      detailRequests.push(itemId);
      return { itemId, bodyHTML: '<p>Body</p>', comments: 1 };
    },
    setFieldValue: async (_projectId: string, itemId: string, fieldId: string, input: unknown) => {
      if (failures.next) {
        failures.next = false;
        throw new Error('Simulated GitHub failure');
      }
      writes.push({ itemId, fieldId, input });
    },
    setItemPosition: async (_projectId: string, itemId: string, afterId: string | undefined) => {
      if (failures.next) {
        failures.next = false;
        throw new Error('Simulated GitHub failure');
      }
      positions.push({ itemId, afterId });
    },
    addDraftIssue: async (_projectId: string, title: string) => {
      drafts.push(title);
      return `PVTI_draft_${drafts.length}`;
    },
    listItemIds: async (_projectId: string, query: string) => {
      filterQueries.push(query);
      if (query === 'status:Done') return items.filter((i) => (i.fieldValues as { F1?: { optionId: string } }).F1?.optionId === 'done').map((i) => i.id);
      throw new Error('Invalid filter');
    },
    getProject: async () => projectDetails,
    listItems: async (_p: unknown, onProgress?: (p: { loaded: number; total: number }) => void) => {
      onProgress?.({ loaded: 100, total: items.length });
      onProgress?.({ loaded: items.length, total: items.length });
      return items;
    },
    getOwners: async () => owners,
    getSharedOwners: async () => [
      { login: 'friend', kind: 'User', isViewer: false, isShared: true },
      // Already listed as an organization: not repeated.
      { login: 'octo-org', kind: 'Organization', isViewer: false, isShared: true },
    ],
    lookupOwner: async (login: string) =>
      login === 'missing' ? undefined : { login, kind: 'Organization', isViewer: false, isManual: true },
    listProjects: async (login: string) => projects[login] ?? [],
    listViews: async () => [
      { id: 'V1', number: 1, name: 'Board', layout: 'board', filter: '', columnFieldId: 'F1' },
      { id: 'V2', number: 2, name: 'Table', layout: 'table', filter: '' },
    ],
  };
}
