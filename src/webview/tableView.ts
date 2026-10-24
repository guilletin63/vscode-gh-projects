// Table layout: one row per item, one column per field the view shows. Rows can be dragged to
// another group (sets the group field) or, when the table isn't sorted, to another position.
import type { FieldInput } from '../model/edits';
import type { RowGroup, TableColumn } from '../model/table';
import { cellText, fieldSum, groupItems, isEditableField, sortItems, tableColumns } from '../model/table';
import type { ProjectField, ProjectItem, ProjectView, ViewSort } from '../model/types';
import type { Place } from './dnd';
import { clearDropMarks, isItemDrag, itemUnder, makeDraggable, markDropPlace, DRAG_TYPE } from './dnd';
import { h, icons } from './dom';
import { fieldControl } from './fieldControl';
import { assigneeList, formatDate, itemRef, labelList, labelledIcon } from './itemParts';

export interface TableProps {
  items: ProjectItem[];
  fields: ProjectField[];
  view?: ProjectView;
  sort?: ViewSort[];
  groupField?: ProjectField;
  /** Groups the user folded. */
  collapsed: ReadonlySet<string>;
  selectedId?: string;
  /** Cell being edited in place. */
  editing?: { itemId: string; fieldId: string };
  /** Key of the "Add item" row being typed into. */
  adding?: { key: string; pending?: boolean };
  /** Panel root, marked while dragging. */
  root: HTMLElement;
  onSort: (fieldId: string) => void;
  onOpen: (itemId: string) => void;
  onOpenExternal: (url: string) => void;
  onToggleGroup: (groupId: string) => void;
  onStartEdit: (itemId: string, fieldId: string) => void;
  onStopEdit: () => void;
  onEdit: (itemId: string, field: ProjectField, input: FieldInput) => void;
  /** Drop into a group (undefined: no grouping) and/or next to another row. */
  onDrop: (itemId: string, groupId: string | undefined, next?: { targetId: string; place: Place }) => void;
  onStartAdd: (key: string) => void;
  onCancelAdd: () => void;
  onAdd: (key: string, title: string, groupId: string | undefined) => void;
}

interface Ctx {
  props: TableProps;
  columns: TableColumn[];
  /** Manual order applies: the table is not sorted. */
  orderable: boolean;
  /** Rows can be dropped on another group. */
  regroupable: boolean;
  /** Rows in display order, for keyboard moves. */
  sequence: { itemId: string; groupId: string | undefined }[];
  numberFields: ProjectField[];
}

export function tableView(props: TableProps): HTMLElement {
  const { columns, hidden } = tableColumns(props.fields, props.view);
  const rows = sortItems(props.items, props.sort, props.fields);
  const groups: (RowGroup | undefined)[] = props.groupField ? groupItems(rows, props.groupField) : [undefined];
  const primary = props.sort?.[0];
  const ctx: Ctx = {
    props,
    columns,
    orderable: !props.sort?.length,
    regroupable: isEditableField(props.groupField),
    sequence: groups.flatMap((g) => (g && props.collapsed.has(g.id) ? [] : (g?.items ?? rows).map((i) => ({ itemId: i.id, groupId: g?.id })))),
    numberFields: columns.filter((c) => c.field.kind === 'number').map((c) => c.field),
  };

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

  const bodies = groups.map((g) => body(g, g ? g.items : rows, ctx));
  // Grouped by a field we can't write (e.g. Assignees): one "Add item" row at the end.
  if (props.groupField && !ctx.regroupable) bodies.push(h('tbody', {}, addRow(undefined, ctx)));

  const table = h('table', { class: 'items-table', 'aria-label': props.view?.name ?? 'Items' }, h('thead', {}, head), bodies);
  const wrap = h('main', { class: 'table-wrap' }, table);
  if (rows.length === 0 && props.items.length === 0) wrap.append(h('p', { class: 'placeholder' }, 'No items match the filters.'));
  if (hidden.length) {
    wrap.append(h('p', { class: 'muted table-note' }, `Not shown here: ${hidden.map((f) => f.name).join(', ')}.`));
  }
  return wrap;
}

function body(group: RowGroup | undefined, items: ProjectItem[], ctx: Ctx): HTMLElement {
  const { props, columns } = ctx;
  const tbody = h('tbody', { 'data-group-id': group?.id });
  const collapsed = !!group && props.collapsed.has(group.id);
  if (group) {
    const toggle = h(
      'button',
      { type: 'button', class: 'group-toggle', 'aria-expanded': String(!collapsed), title: collapsed ? 'Expand group' : 'Collapse group' },
      h('span', { class: 'chevron', 'aria-hidden': 'true' }, collapsed ? '▸' : '▾'),
      h('span', { class: `dot color-${group.option?.color ?? 'none'}`, 'aria-hidden': 'true' }),
      h('span', { class: 'group-name' }, group.name),
      h('span', { class: 'count' }, String(group.items.length)),
      sums(group.items, ctx.numberFields),
    );
    toggle.addEventListener('click', () => props.onToggleGroup(group.id));
    tbody.append(h('tr', { class: 'group-row' }, h('th', { colspan: columns.length, scope: 'rowgroup' }, toggle)));
  }
  if (!collapsed) {
    for (const item of items) tbody.append(row(item, group?.id, ctx));
    if (!props.groupField || ctx.regroupable) tbody.append(addRow(group?.id, ctx));
  }
  if (group && ctx.regroupable) {
    tbody.addEventListener('dragover', (e) => {
      if (!isItemDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clearDropMarks(tbody.closest('table') ?? tbody);
      tbody.classList.add('drop-target');
      const target = itemUnder(e);
      if (target && ctx.orderable) markDropPlace(e, target);
    });
  }
  if (group ? ctx.regroupable : ctx.orderable) {
    tbody.addEventListener('drop', (e) => {
      if (!isItemDrag(e)) return;
      e.preventDefault();
      const itemId = e.dataTransfer?.getData(DRAG_TYPE);
      const target = itemUnder(e);
      const place = target ? markDropPlace(e, target) : undefined;
      clearDropMarks(props.root);
      props.root.classList.remove('is-dragging');
      if (!itemId) return;
      const next = target?.dataset.itemId && place && ctx.orderable ? { targetId: target.dataset.itemId, place } : undefined;
      if (group || next) props.onDrop(itemId, group?.id, next);
    });
  }
  return tbody;
}

function sums(items: ProjectItem[], fields: ProjectField[]): HTMLElement | null {
  const parts = fields.flatMap((f) => {
    const sum = fieldSum(items, f);
    return sum === undefined ? [] : [`${f.name}: ${sum}`];
  });
  return parts.length ? h('span', { class: 'muted field-sums' }, parts.join(' · ')) : null;
}

function row(item: ProjectItem, groupId: string | undefined, ctx: Ctx): HTMLElement {
  const { props, columns } = ctx;
  const editingRow = props.editing?.itemId === item.id;
  const tr = h(
    'tr',
    {
      class: `item-row${props.selectedId === item.id ? ' selected' : ''}`,
      tabindex: 0,
      'data-item-id': item.id,
      'aria-label': item.title,
      'aria-keyshortcuts': ctx.orderable || ctx.regroupable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined,
    },
    columns.map((c) => h('td', { class: `col-${c.cell} kind-${c.field.kind}${isEditableField(c.field) ? ' editable' : ''}` }, cell(item, c, ctx))),
  );
  if ((ctx.orderable && (!props.groupField || ctx.regroupable)) || ctx.regroupable) {
    if (!editingRow) makeDraggable(tr, item.id, props.root);
    tr.addEventListener('dragover', (e) => {
      if (!isItemDrag(e) || !ctx.orderable) return;
      e.preventDefault();
      clearDropMarks(props.root);
      tr.closest('tbody')?.classList.toggle('drop-target', !!props.groupField);
      markDropPlace(e, tr);
    });
  }
  tr.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest('button, a, input, select')) return;
    props.onOpen(item.id);
  });
  tr.addEventListener('keydown', (e) => {
    if (e.target !== tr) return;
    if (e.key === 'Enter') props.onOpen(item.id);
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      keyboardMove(item.id, groupId, e.key === 'ArrowUp' ? -1 : 1, ctx);
    }
  });
  return tr;
}

/**
 * Alt+↑/↓: one row up or down. Crossing into the next group sets the group field; inside a
 * group (or an ungrouped table) it changes the position, when the table isn't sorted.
 */
function keyboardMove(itemId: string, groupId: string | undefined, dir: -1 | 1, ctx: Ctx): void {
  const index = ctx.sequence.findIndex((r) => r.itemId === itemId);
  const neighbour = ctx.sequence[index + dir];
  if (!neighbour) return;
  const place: Place = dir < 0 ? 'before' : 'after';
  if (neighbour.groupId !== groupId) {
    if (!ctx.regroupable || neighbour.groupId === undefined) return;
    ctx.props.onDrop(itemId, neighbour.groupId, ctx.orderable ? { targetId: neighbour.itemId, place } : undefined);
  } else if (ctx.orderable) {
    ctx.props.onDrop(itemId, ctx.props.groupField ? groupId : undefined, { targetId: neighbour.itemId, place });
  }
}

function addRow(groupId: string | undefined, ctx: Ctx): HTMLElement {
  const { props, columns } = ctx;
  const key = `table:${groupId ?? ''}`;
  const adding = props.adding?.key === key ? props.adding : undefined;
  const td = h('td', { colspan: columns.length });
  if (adding) {
    const input = h('input', {
      type: 'text',
      class: 'add-input',
      placeholder: 'Draft title, then Enter',
      'aria-label': 'Title of the new draft',
      'data-focus-key': `add-${key}`,
      disabled: !!adding.pending,
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') props.onCancelAdd();
      if (e.key === 'Enter' && input.value.trim()) props.onAdd(key, input.value.trim(), groupId);
    });
    input.addEventListener('blur', () => {
      if (!input.value.trim() && !adding.pending) props.onCancelAdd();
    });
    td.append(input);
    if (adding.pending) td.append(h('span', { class: 'muted' }, ' Adding…'));
  } else {
    const b = h('button', { type: 'button', class: 'add-button' }, '+ Add item');
    b.addEventListener('click', () => props.onStartAdd(key));
    td.append(b);
  }
  return h('tr', { class: 'add-row' }, td);
}

function link(text: string, url: string, props: TableProps): HTMLElement {
  const b = h('button', { type: 'button', class: 'link-button', title: url }, text);
  b.addEventListener('click', () => props.onOpenExternal(url));
  return b;
}

function cell(item: ProjectItem, column: TableColumn, ctx: Ctx): Node | null {
  const { props } = ctx;
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
    case 'field':
      return editableCell(item, column.field, ctx);
    default:
      return document.createTextNode(cellText(item, column));
  }
}

/** A custom field value; a click (or Enter) turns it into an editor. */
function editableCell(item: ProjectItem, field: ProjectField, ctx: Ctx): Node {
  const { props } = ctx;
  if (props.editing?.itemId === item.id && props.editing.fieldId === field.id) {
    const control = fieldControl(field, item, (f, input) => props.onEdit(item.id, f, input), {
      id: `cell-${item.id}-${field.id}`,
      label: `${field.name} of ${item.title}`,
    });
    control.classList.add('cell-editor');
    control.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onStopEdit();
      }
    });
    // Commits happen on 'change', which fires before 'blur'.
    control.addEventListener('blur', () => props.onStopEdit());
    return control;
  }
  const b = h('button', { type: 'button', class: 'cell-button', title: `Edit ${field.name}`, 'aria-label': `${field.name}: ${display(item, field) || 'empty'}. Edit` });
  b.append(fieldDisplay(item, field));
  b.addEventListener('click', () => props.onStartEdit(item.id, field.id));
  return b;
}

function display(item: ProjectItem, field: ProjectField): string {
  return cellText(item, { field, cell: 'field' });
}

function fieldDisplay(item: ProjectItem, field: ProjectField): Node {
  const v = item.fieldValues[field.id];
  if (!v) return h('span', { class: 'cell-empty' }, '');
  if (v.kind === 'singleSelect') {
    const color = field.options?.find((o) => o.id === v.optionId)?.color ?? 'GRAY';
    return h('span', { class: 'select-value' }, h('span', { class: `dot color-${color}`, 'aria-hidden': 'true' }), v.name);
  }
  if (v.kind === 'date') return document.createTextNode(formatDate(v.date));
  return document.createTextNode(display(item, field));
}
