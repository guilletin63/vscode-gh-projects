// Table layout: one row per item, one column per field the view shows.
import type { TableColumn } from '../model/table';
import { cellText, groupItems, sortItems, tableColumns } from '../model/table';
import type { ProjectField, ProjectItem, ProjectView, ViewSort } from '../model/types';
import { h, icons } from './dom';
import { assigneeList, formatDate, itemRef, labelList, labelledIcon } from './itemParts';

export interface TableProps {
  items: ProjectItem[];
  fields: ProjectField[];
  view?: ProjectView;
  sort?: ViewSort[];
  groupField?: ProjectField;
  selectedId?: string;
  onSort: (fieldId: string) => void;
  onOpen: (itemId: string) => void;
  onOpenExternal: (url: string) => void;
}

export function tableView(props: TableProps): HTMLElement {
  const { columns, hidden } = tableColumns(props.fields, props.view);
  const rows = sortItems(props.items, props.sort, props.fields);
  const groups = props.groupField ? groupItems(rows, props.groupField) : undefined;
  const primary = props.sort?.[0];

  const head = h(
    'tr',
    {},
    columns.map((column) => {
      const sorted = primary?.fieldId === column.field.id ? primary.direction : undefined;
      const b = h(
        'button',
        { type: 'button', class: 'th-button', title: `Sort by ${column.field.name}` },
        h('span', {}, column.field.name),
        sorted ? h('span', { class: 'sort-arrow', 'aria-hidden': 'true' }, sorted === 'asc' ? '↑' : '↓') : null,
      );
      b.addEventListener('click', () => props.onSort(column.field.id));
      return h(
        'th',
        { scope: 'col', class: `col-${column.cell}`, 'aria-sort': sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined },
        b,
      );
    }),
  );

  const bodies = groups
    ? groups.map((g) =>
        h(
          'tbody',
          {},
          h(
            'tr',
            { class: 'group-row' },
            h(
              'th',
              { colspan: columns.length, scope: 'rowgroup' },
              h('span', { class: `dot color-${g.option?.color ?? 'none'}`, 'aria-hidden': 'true' }),
              h('span', { class: 'group-name' }, g.name),
              h('span', { class: 'count' }, String(g.items.length)),
            ),
          ),
          g.items.map((item) => row(item, columns, props)),
        ),
      )
    : [h('tbody', {}, rows.map((item) => row(item, columns, props)))];

  const table = h('table', { class: 'items-table', 'aria-label': props.view?.name ?? 'Items' }, h('thead', {}, head), bodies);
  const wrap = h('main', { class: 'table-wrap' }, table);
  if (rows.length === 0) wrap.append(h('p', { class: 'placeholder' }, 'No items match the filters.'));
  if (hidden.length) {
    wrap.append(h('p', { class: 'muted table-note' }, `Not shown here: ${hidden.map((f) => f.name).join(', ')}.`));
  }
  return wrap;
}

function row(item: ProjectItem, columns: TableColumn[], props: TableProps): HTMLElement {
  const tr = h(
    'tr',
    { class: `item-row${props.selectedId === item.id ? ' selected' : ''}`, tabindex: 0, 'data-item-id': item.id, 'aria-label': item.title },
    columns.map((c) => h('td', { class: `col-${c.cell} kind-${c.field.kind}` }, cell(item, c, props))),
  );
  tr.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest('button, a')) return;
    props.onOpen(item.id);
  });
  tr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === tr) props.onOpen(item.id);
  });
  return tr;
}

function link(text: string, url: string, props: TableProps): HTMLElement {
  const b = h('button', { type: 'button', class: 'link-button', title: url }, text);
  b.addEventListener('click', () => props.onOpenExternal(url));
  return b;
}

function cell(item: ProjectItem, column: TableColumn, props: TableProps): Node | null {
  switch (column.cell) {
    case 'title': {
      const ref = itemRef(item);
      return h(
        'div',
        { class: 'title-cell' },
        labelledIcon(item),
        h('span', { class: 'row-title' }, item.title),
        ref ? h('span', { class: 'muted row-ref' }, ref) : null,
      );
    }
    case 'assignees':
      return assigneeList(item, { names: true });
    case 'labels':
      return labelList(item);
    case 'linkedPullRequests': {
      const prs = item.linkedPullRequests ?? [];
      return prs.length ? h('span', { class: 'pr-links' }, prs.map((pr) => h('span', { class: 'pr-link' }, icons.pr(), link(`#${pr.number}`, pr.url, props)))) : null;
    }
    case 'parent':
      return item.parent ? (item.parent.url ? link(`${item.parent.title} #${item.parent.number}`, item.parent.url, props) : document.createTextNode(cellText(item, column))) : null;
    case 'subIssues': {
      if (!item.subIssues) return null;
      const { completed, total } = item.subIssues;
      const bar = h('span', { class: 'progress', 'aria-hidden': 'true' }, h('span', { class: 'progress-done' }));
      (bar.firstChild as HTMLElement).style.setProperty('width', `${Math.round((completed / total) * 100)}%`);
      return h('span', { class: 'sub-issues', title: `${completed} of ${total} sub-issues done` }, bar, `${completed}/${total}`);
    }
    case 'created':
    case 'updated':
    case 'closed': {
      const text = cellText(item, column);
      return text ? document.createTextNode(formatDate(text)) : null;
    }
    case 'field': {
      const v = item.fieldValues[column.field.id];
      if (!v) return null;
      if (v.kind === 'singleSelect') {
        const color = column.field.options?.find((o) => o.id === v.optionId)?.color ?? 'GRAY';
        return h('span', { class: 'select-value' }, h('span', { class: `dot color-${color}`, 'aria-hidden': 'true' }), v.name);
      }
      if (v.kind === 'date') return document.createTextNode(formatDate(v.date));
      return document.createTextNode(cellText(item, column));
    }
    default:
      return document.createTextNode(cellText(item, column));
  }
}
