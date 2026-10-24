import type { ProjectField, ProjectItem, ProjectView, SelectOption, ViewSort } from './types';

/** What a table cell shows: one of GitHub's built-in fields, or a custom field value. */
export type CellKind =
  | 'title'
  | 'assignees'
  | 'labels'
  | 'repository'
  | 'milestone'
  | 'parent'
  | 'subIssues'
  | 'linkedPullRequests'
  | 'created'
  | 'updated'
  | 'closed'
  | 'field';

const BUILTIN_CELLS: Record<string, CellKind> = {
  TITLE: 'title',
  ASSIGNEES: 'assignees',
  LABELS: 'labels',
  REPOSITORY: 'repository',
  MILESTONE: 'milestone',
  PARENT_ISSUE: 'parent',
  SUB_ISSUES_PROGRESS: 'subIssues',
  LINKED_PULL_REQUESTS: 'linkedPullRequests',
  CREATED: 'created',
  UPDATED: 'updated',
  CLOSED: 'closed',
};

export interface TableColumn {
  field: ProjectField;
  cell: CellKind;
}

export function cellKind(field: ProjectField): CellKind | undefined {
  return field.kind === 'builtin' ? BUILTIN_CELLS[field.dataType] : 'field';
}

/**
 * Columns of a table view: the fields visible in the view, in the view's order, with Title
 * first like github.com. Views that don't expose their fields show Title, Assignees, Labels and
 * the custom fields. Built-in fields we can't show (Reviewers, Tracks…) are returned as `hidden`.
 */
export function tableColumns(fields: ProjectField[], view?: ProjectView): { columns: TableColumn[]; hidden: ProjectField[] } {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const chosen = view?.visibleFieldIds
    ? view.visibleFieldIds.flatMap((id) => byId.get(id) ?? [])
    : fields.filter((f) => f.kind !== 'builtin' || ['TITLE', 'ASSIGNEES', 'LABELS'].includes(f.dataType));
  const title = fields.find((f) => f.dataType === 'TITLE');
  const ordered = title ? [title, ...chosen.filter((f) => f.id !== title.id)] : chosen;
  const columns: TableColumn[] = [];
  const hidden: ProjectField[] = [];
  for (const field of ordered) {
    const cell = cellKind(field);
    if (cell) columns.push({ field, cell });
    else hidden.push(field);
  }
  return { columns, hidden };
}

const day = (iso: string) => iso.slice(0, 10);

/** Plain-text value of a cell, '' when empty. Also used to group and search rows. */
export function cellText(item: ProjectItem, column: TableColumn): string {
  switch (column.cell) {
    case 'title':
      return item.title;
    case 'assignees':
      return item.assignees.map((a) => a.login).join(', ');
    case 'labels':
      return item.labels.map((l) => l.name).join(', ');
    case 'repository':
      return item.repository ?? '';
    case 'milestone':
      return item.milestone ?? '';
    case 'parent':
      return item.parent ? `${item.parent.title} #${item.parent.number}` : '';
    case 'subIssues':
      return item.subIssues ? `${item.subIssues.completed}/${item.subIssues.total}` : '';
    case 'linkedPullRequests':
      return (item.linkedPullRequests ?? []).map((pr) => `#${pr.number}`).join(', ');
    case 'created':
      return item.createdAt ? day(item.createdAt) : '';
    case 'updated':
      return day(item.updatedAt);
    case 'closed':
      return item.closedAt ? day(item.closedAt) : '';
    case 'field': {
      const v = item.fieldValues[column.field.id];
      if (!v) return '';
      switch (v.kind) {
        case 'singleSelect':
          return v.name;
        case 'iteration':
          return v.title;
        case 'number':
          return String(v.number);
        case 'date':
          return v.date;
        case 'text':
          return v.text;
      }
    }
  }
}

/** Value used to sort a column: numbers compare as numbers, the rest as text. */
function sortValue(item: ProjectItem, column: TableColumn): string | number | undefined {
  if (column.cell === 'subIssues') return item.subIssues ? item.subIssues.completed / item.subIssues.total : undefined;
  if (column.cell === 'linkedPullRequests') return item.linkedPullRequests?.length || undefined;
  if (column.cell === 'field') {
    const v = item.fieldValues[column.field.id];
    if (!v) return undefined;
    switch (v.kind) {
      case 'singleSelect': {
        // Options sort in the field's order, not alphabetically, like github.com.
        const index = column.field.options?.findIndex((o) => o.id === v.optionId) ?? -1;
        return index >= 0 ? index : undefined;
      }
      case 'iteration':
        return v.startDate;
      case 'number':
        return v.number;
      default:
        break;
    }
  }
  const text = cellText(item, column);
  return text === '' ? undefined : text.toLocaleLowerCase();
}

/**
 * Sorts items by the view's sort, keeping the project order for ties. Empty values always go
 * last, whatever the direction.
 */
export function sortItems(items: ProjectItem[], sorts: ViewSort[] | undefined, fields: ProjectField[]): ProjectItem[] {
  const keys = (sorts ?? []).flatMap((s) => {
    const field = fields.find((f) => f.id === s.fieldId);
    const cell = field && cellKind(field);
    return field && cell ? [{ column: { field, cell }, sign: s.direction === 'desc' ? -1 : 1 }] : [];
  });
  if (keys.length === 0) return [...items];
  return items
    .map((item, index) => ({ item, index, values: keys.map((k) => sortValue(item, k.column)) }))
    .sort((a, b) => {
      for (let i = 0; i < keys.length; i++) {
        const x = a.values[i];
        const y = b.values[i];
        if (x === y) continue;
        if (x === undefined) return 1;
        if (y === undefined) return -1;
        const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        if (order !== 0) return order * (keys[i]?.sign ?? 1);
      }
      return a.index - b.index;
    })
    .map((r) => r.item);
}

export const NO_VALUE_GROUP = '__none__';

export interface RowGroup {
  /** Option / iteration id, the value itself, or NO_VALUE_GROUP. */
  id: string;
  name: string;
  option?: SelectOption;
  items: ProjectItem[];
}

/** Fields a table or roadmap can be grouped by (GitHub doesn't group by title or labels). */
export function groupableFields(fields: ProjectField[]): ProjectField[] {
  return fields.filter((f) => {
    const cell = cellKind(f);
    return cell === 'field' || cell === 'assignees' || cell === 'repository' || cell === 'milestone' || cell === 'parent';
  });
}

/**
 * Groups rows by a field: single-select options and iterations in the field's order, other
 * values alphabetically, and "No <field>" last. Groups keep the order of `items`.
 */
export function groupItems(items: ProjectItem[], field: ProjectField | undefined): RowGroup[] {
  const cell = field && cellKind(field);
  if (!field || !cell) return [{ id: NO_VALUE_GROUP, name: 'Items', items: [...items] }];
  const column: TableColumn = { field, cell };
  const groups = new Map<string, RowGroup>();
  for (const o of field.options ?? []) groups.set(o.id, { id: o.id, name: o.name, option: o, items: [] });
  const iterations = [...(field.iterations ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const it of iterations) groups.set(it.id, { id: it.id, name: it.title, items: [] });
  const none: ProjectItem[] = [];
  const free = new Map<string, RowGroup>();
  for (const item of items) {
    const v = item.fieldValues[field.id];
    const known = v?.kind === 'singleSelect' ? v.optionId : v?.kind === 'iteration' ? v.iterationId : undefined;
    const group = known ? groups.get(known) : undefined;
    if (group) {
      group.items.push(item);
      continue;
    }
    const text = cellText(item, column);
    if (!text) {
      none.push(item);
      continue;
    }
    const g = free.get(text) ?? { id: text, name: text, items: [] };
    g.items.push(item);
    free.set(text, g);
  }
  const numeric = field.kind === 'number';
  const rest = [...free.values()].sort((a, b) => (numeric ? Number(a.id) - Number(b.id) : a.name.localeCompare(b.name)));
  const result = [...groups.values(), ...rest];
  if (none.length > 0) result.push({ id: NO_VALUE_GROUP, name: `No ${field.name}`, items: none });
  return result.filter((g) => g.items.length > 0);
}
