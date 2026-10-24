// Board webview. Renders the BoardState sent by the extension; never talks to the network.
import { NO_VALUE_COLUMN, buildColumns, cardFields, resolveGroupField } from '../model/board';
import type { Column } from '../model/board';
import type { FieldInput } from '../model/edits';
import { PendingEdits } from '../model/edits';
import type { BoardFilter } from '../model/filter';
import { applyFilter, buildFacets } from '../model/filter';
import { dateFields, dayNumber, resolveDateSource } from '../model/roadmap';
import type { DateSource } from '../model/roadmap';
import { groupableFields } from '../model/table';
import type { FieldValue, ItemDetail, ProjectField, ProjectItem, ProjectView, ViewSort } from '../model/types';
import type { BoardState, HostMessage, WebviewMessage } from '../shared/protocol';
import { h, icons } from './dom';
import { detailPanel } from './detail';
import { filterBar } from './filterBar';
import { assigneeList, formatDate, itemRef, labelList, labelledIcon } from './itemParts';
import type { Zoom } from './roadmapView';
import { ZOOM_SCALE, roadmapView } from './roadmapView';
import { tableView } from './tableView';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const app = document.getElementById('app') as HTMLElement;

interface UiState {
  board?: BoardState;
  loading?: { loaded: number; total: number };
  error?: string;
  banner?: string;
  openMenu?: string;
  detail?: { itemId: string; detail?: ItemDetail; error?: string };
  prExtension?: boolean;
}
const ui: UiState = {};
const pending = new PendingEdits();
const DRAG_TYPE = 'application/x-ghp-item';

// Persisted panel identity (for the serializer) + webview-only UI state.
const persisted = JSON.parse(document.body.dataset.persisted ?? '{}') as Record<string, unknown>;
const saved = (vscode.getState() ?? {}) as Record<string, unknown>;
vscode.setState({ ...saved, ...persisted, ...(saved.viewId ? { viewId: saved.viewId } : {}) });

function send(message: WebviewMessage): void {
  vscode.postMessage(message);
}

function updateSaved(patch: Record<string, unknown>): void {
  vscode.setState({ ...((vscode.getState() ?? {}) as object), ...patch });
}

/**
 * Per-view choices made in the toolbar or table header, kept in the webview state only. An
 * empty `groupFieldId` means "no grouping" even when the view has one on GitHub.
 */
interface ViewPrefs {
  groupFieldId?: string;
  sort?: ViewSort[];
  startFieldId?: string;
  endFieldId?: string;
  zoom?: Zoom;
}

function allPrefs(): Record<string, ViewPrefs> {
  return ((vscode.getState() as { viewPrefs?: Record<string, ViewPrefs> } | undefined)?.viewPrefs ?? {});
}

function prefsFor(viewId: string | undefined): ViewPrefs {
  return viewId ? (allPrefs()[viewId] ?? {}) : {};
}

function setPrefs(viewId: string | undefined, patch: ViewPrefs): void {
  if (!viewId) return;
  updateSaved({ viewPrefs: { ...allPrefs(), [viewId]: { ...prefsFor(viewId), ...patch } } });
  render();
}

function currentView(board: BoardState): ProjectView | undefined {
  return board.project.views.find((v) => v.id === board.viewId);
}

function effectiveGroupField(board: BoardState, view: ProjectView | undefined): ProjectField | undefined {
  const chosen = prefsFor(view?.id).groupFieldId;
  const id = chosen !== undefined ? chosen : view?.groupByFieldId;
  return id ? groupableFields(board.project.fields).find((f) => f.id === id) : undefined;
}

function effectiveSort(view: ProjectView | undefined): ViewSort[] | undefined {
  return prefsFor(view?.id).sort ?? view?.sortBy;
}

function dateSource(board: BoardState, view: ProjectView | undefined): DateSource | undefined {
  const prefs = prefsFor(view?.id);
  return resolveDateSource(board.project.fields, {
    ...(prefs.startFieldId ? { startFieldId: prefs.startFieldId } : {}),
    ...(prefs.endFieldId ? { endFieldId: prefs.endFieldId } : {}),
  });
}

/** Header click: ascending, then descending, then back to the view's own sort. */
function toggleSort(view: ProjectView | undefined, fieldId: string): void {
  const primary = effectiveSort(view)?.[0];
  const prefs = prefsFor(view?.id);
  let sort: ViewSort[] | undefined;
  if (primary?.fieldId !== fieldId) sort = [{ fieldId, direction: 'asc' }];
  else if (primary.direction === 'asc') sort = [{ fieldId, direction: 'desc' }];
  else sort = prefs.sort ? undefined : [{ fieldId, direction: 'asc' }];
  if (!view) return;
  const next: ViewPrefs = { ...prefs };
  if (sort) next.sort = sort;
  else delete next.sort;
  updateSaved({ viewPrefs: { ...allPrefs(), [view.id]: next } });
  render();
}

/** Today's local calendar day. */
function today(): number {
  const d = new Date();
  return dayNumber(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

/** The roadmap scrolls to today once per view and zoom level. */
let roadmapScrolledFor: string | undefined;

let bannerTimer: ReturnType<typeof setTimeout> | undefined;

function showBanner(text: string, ms: number): void {
  ui.banner = text;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    delete ui.banner;
    render();
  }, ms);
}

function announce(text: string): void {
  const live = document.getElementById('live');
  if (live) live.textContent = text;
}

/** Writes a field: shown immediately, rolled back if GitHub rejects it. */
function editField(itemId: string, field: ProjectField, input: FieldInput): void {
  const board = ui.board;
  if (!board) return;
  const { requestId, items } = pending.apply(board.items, itemId, field, input);
  ui.board = { ...board, items };
  send({ type: 'setField', requestId, itemId, fieldId: field.id, input });
  render();
}

function openDetail(itemId: string): void {
  ui.detail = { itemId };
  ui.openMenu = undefined;
  send({ type: 'openDetail', itemId });
  render();
  app.querySelector<HTMLElement>('.detail')?.focus();
}

function closeDetail(): void {
  const itemId = ui.detail?.itemId;
  ui.detail = undefined;
  render();
  if (itemId) app.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(itemId)}"][tabindex]`)?.focus();
}

/** Moves a card to a column by setting the grouping field; optimistic, rolled back on failure. */
function moveItem(itemId: string, columnId: string): void {
  const board = ui.board;
  if (!board) return;
  const field = resolveGroupField(board.project.fields, board.project.views.find((v) => v.id === board.viewId), board.groupFieldId);
  const item = board.items.find((i) => i.id === itemId);
  if (!field || !item) return;
  const current = item.fieldValues[field.id];
  const currentColumn = current?.kind === 'singleSelect' ? current.optionId : NO_VALUE_COLUMN;
  if (currentColumn === columnId) return;
  const input: FieldInput = columnId === NO_VALUE_COLUMN ? null : { kind: 'singleSelect', optionId: columnId };
  ui.openMenu = undefined;
  editField(itemId, field, input);
  const target = columnId === NO_VALUE_COLUMN ? `No ${field.name}` : field.options?.find((o) => o.id === columnId)?.name;
  announce(`Moved ${item.title} to ${target ?? columnId}`);
  // Keep keyboard users on the card they moved.
  app.querySelector<HTMLElement>(`.card[data-item-id="${CSS.escape(itemId)}"]`)?.focus();
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'loading':
      ui.loading = { loaded: msg.loaded, total: msg.total };
      delete ui.error;
      break;
    case 'state':
      // Keep optimistic edits that GitHub hasn't confirmed yet on top of the fresh data.
      ui.board = { ...msg.state, items: pending.reapply(msg.state.items) };
      delete ui.loading;
      delete ui.error;
      delete ui.banner;
      break;
    case 'error':
      ui.error = msg.message;
      delete ui.loading;
      break;
    case 'editResult':
      if (msg.ok) pending.confirm(msg.requestId);
      else if (ui.board) {
        ui.board = { ...ui.board, items: pending.revert(ui.board.items, msg.requestId) };
        showBanner(`Could not update the item: ${(msg.message ?? 'unknown error').replace(/\.$/, '')}. The change was reverted.`, 8000);
      }
      break;
    case 'env':
      ui.prExtension = msg.prExtension;
      break;
    case 'detail':
      if (ui.detail?.itemId === msg.itemId) ui.detail = { itemId: msg.itemId, detail: msg.detail };
      break;
    case 'detailError':
      if (ui.detail?.itemId === msg.itemId) ui.detail = { itemId: msg.itemId, error: msg.message };
      break;
    case 'rateLimit': {
      const seconds = Math.ceil(msg.waitMs / 1000);
      ui.banner =
        msg.reason === 'transient'
          ? `GitHub is not responding. Retrying in ${seconds}s…`
          : `GitHub rate limit reached. Retrying in ${seconds}s…`;
      showBanner(ui.banner, msg.waitMs);
      break;
    }
  }
  render();
});

// ---- rendering -----------------------------------------------------------------------------

function render(): void {
  const scroll = app.querySelector('.board')?.scrollLeft ?? 0;
  // Each column scrolls on its own; refreshes must not jump back to the top.
  const columnScroll = new Map<string, number>();
  app.querySelectorAll<HTMLElement>('.column').forEach((c) => {
    const cards = c.querySelector('.cards');
    if (cards && c.dataset.columnId) columnScroll.set(c.dataset.columnId, cards.scrollTop);
  });
  const detailScroll = app.querySelector('.detail')?.scrollTop ?? 0;
  const scrolled = app.querySelector('.table-wrap, .roadmap');
  const layoutScroll = scrolled ? { kind: scrolled.className, top: scrolled.scrollTop, left: scrolled.scrollLeft } : undefined;
  // Re-rendering replaces the DOM: keep keyboard focus and the caret where the user left them.
  const active = document.activeElement as HTMLInputElement | null;
  const focusKey = active?.getAttribute('data-focus-key');
  const selection = active?.type === 'search' ? { start: active.selectionStart, end: active.selectionEnd } : undefined;
  app.replaceChildren(...view());
  app.classList.toggle('with-detail', !!ui.detail);
  app.querySelectorAll<HTMLDetailsElement>('.move-menu[open]').forEach(positionMenu);
  app.setAttribute('aria-busy', String(!!ui.loading));
  const board = app.querySelector('.board');
  if (board) board.scrollLeft = scroll;
  app.querySelectorAll<HTMLElement>('.column').forEach((c) => {
    const top = c.dataset.columnId ? columnScroll.get(c.dataset.columnId) : undefined;
    const cards = c.querySelector('.cards');
    if (cards && top) cards.scrollTop = top;
  });
  const detail = app.querySelector('.detail');
  if (detail) detail.scrollTop = detailScroll;
  const layout = app.querySelector<HTMLElement>('.table-wrap, .roadmap');
  if (layout && layoutScroll?.kind === layout.className) {
    layout.scrollTop = layoutScroll.top;
    layout.scrollLeft = layoutScroll.left;
  }
  if (layout?.classList.contains('roadmap') && ui.board) {
    const key = `${ui.board.viewId}:${prefsFor(ui.board.viewId).zoom ?? 'month'}`;
    if (roadmapScrolledFor !== key) {
      roadmapScrolledFor = key;
      layout.scrollLeft = Math.max(0, Number(layout.dataset.todayX ?? 0) - layout.clientWidth / 3);
    }
  }
  if (focusKey) {
    const el = [...app.querySelectorAll<HTMLInputElement>('[data-focus-key]')].find((e) => e.dataset.focusKey === focusKey);
    el?.focus();
    if (el && selection && selection.start !== null) el.setSelectionRange(selection.start, selection.end ?? selection.start);
  }
}

let filterTimer: ReturnType<typeof setTimeout> | undefined;

function changeFilter(filter: BoardFilter, opts: { debounce?: boolean } = {}): void {
  if (!ui.board) return;
  ui.board.filter = filter;
  clearTimeout(filterTimer);
  const commit = () => {
    send({ type: 'setFilter', filter });
    render();
  };
  if (opts.debounce) filterTimer = setTimeout(commit, 150);
  else commit();
}

// Close an open filter menu when clicking elsewhere or pressing Escape.
document.addEventListener('click', (e) => {
  if (ui.openMenu && !(e.target as Element | null)?.closest('.filter-menu')) {
    ui.openMenu = undefined;
    render();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (ui.openMenu) {
    ui.openMenu = undefined;
    render();
  } else if (ui.detail) closeDetail();
});

function view(): Node[] {
  const nodes: Node[] = [toolbar()];
  if (ui.banner) nodes.push(h('div', { class: 'banner warning', role: 'status' }, ui.banner));
  if (ui.error) {
    nodes.push(
      h(
        'div',
        { class: 'banner error', role: 'alert' },
        h('span', {}, ui.error),
        button('Retry', () => send({ type: 'refresh' })),
      ),
    );
  }
  if (!ui.board) {
    if (!ui.error) nodes.push(h('div', { class: 'placeholder' }, loadingText() ?? 'Loading board…'));
    return nodes;
  }
  const board = ui.board;
  const visible = applyFilter(board.items, board.filter);
  if (board.items.length > 0) {
    nodes.push(
      filterBar({
        filter: board.filter,
        facets: buildFacets(board.items, board.project.fields),
        shown: visible.length,
        total: board.items.length,
        openMenu: ui.openMenu,
        onOpenMenu: (key) => {
          // A re-rendered open <details> fires 'toggle' again: ignore it or we'd render forever.
          if (ui.openMenu === key) return;
          ui.openMenu = key;
          render();
        },
        onChange: changeFilter,
      }),
    );
  }
  nodes.push(layoutView(board, visible));
  const detailItem = ui.detail ? board.items.find((i) => i.id === ui.detail?.itemId) : undefined;
  if (ui.detail && detailItem) {
    const opened = ui.detail;
    nodes.push(
      detailPanel({
        item: detailItem,
        fields: board.project.fields.filter((f) => f.kind !== 'builtin'),
        ...(opened.detail ? { detail: opened.detail } : {}),
        ...(opened.error ? { error: opened.error } : {}),
        prExtension: !!ui.prExtension,
        onClose: closeDetail,
        onEdit: (field, input) => editField(detailItem.id, field, input),
        onOpenExternal: (url) => send({ type: 'openExternal', url }),
        onCopyLink: (url) => send({ type: 'copyLink', url }),
        onOpenInPrExtension: () => send({ type: 'openInPrExtension', itemId: detailItem.id }),
      }),
    );
  }
  return nodes;
}

function layoutView(board: BoardState, visible: ProjectItem[]): HTMLElement {
  const view = currentView(board);
  if (board.items.length === 0 || view?.layout === 'board' || !view) return boardView(board, visible);
  const selectedId = ui.detail?.itemId;
  if (view.layout === 'table') {
    return tableView({
      items: visible,
      fields: board.project.fields,
      view,
      ...withValue('sort', effectiveSort(view)),
      ...withValue('groupField', effectiveGroupField(board, view)),
      ...withValue('selectedId', selectedId),
      onSort: (fieldId) => toggleSort(view, fieldId),
      onOpen: openDetail,
      onOpenExternal: (url) => send({ type: 'openExternal', url }),
    });
  }
  return roadmapView({
    items: visible,
    fields: board.project.fields,
    view,
    ...withValue('source', dateSource(board, view)),
    ...withValue('sort', effectiveSort(view)),
    ...withValue('groupField', effectiveGroupField(board, view)),
    zoom: prefsFor(view.id).zoom ?? 'month',
    today: today(),
    ...withValue('selectedId', selectedId),
    onOpen: openDetail,
  });
}

/** Spreads `{ [key]: value }` only when value is set (exactOptionalPropertyTypes). */
function withValue<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function loadingText(): string | undefined {
  if (!ui.loading) return undefined;
  const { loaded, total } = ui.loading;
  return total > 0 ? `Loading items… ${loaded} of ${total}` : 'Loading board…';
}

function button(label: string, onClick: () => void, opts: { icon?: SVGElement; title?: string; class?: string } = {}) {
  const b = h('button', { type: 'button', class: opts.class ?? 'button', title: opts.title ?? label, 'aria-label': opts.title ?? label });
  if (opts.icon) b.append(opts.icon);
  else b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function toolbar(): HTMLElement {
  const board = ui.board;
  const bar = h('header', { class: 'toolbar' });
  if (!board) {
    bar.append(h('h1', {}, String((persisted.project as { title?: string } | undefined)?.title ?? 'GitHub Project')));
    return bar;
  }
  const { project } = board;
  const currentView = project.views.find((v) => v.id === board.viewId);
  const groupField = resolveGroupField(project.fields, currentView, board.groupFieldId);

  const title = h('h1', {}, project.title);
  const meta = h('span', { class: 'muted' }, `#${project.number} · ${board.items.length} items`);

  const viewSelect = h('select', { 'aria-label': 'View' });
  for (const v of project.views) {
    viewSelect.append(h('option', { value: v.id, selected: v.id === board.viewId }, `${v.name} (${v.layout})`));
  }
  viewSelect.addEventListener('change', () => {
    board.viewId = viewSelect.value;
    delete board.groupFieldId;
    updateSaved({ viewId: viewSelect.value });
    send({ type: 'selectView', viewId: viewSelect.value });
    render();
  });

  const layout = board.items.length === 0 ? 'board' : (currentView?.layout ?? 'board');
  const controls: HTMLElement[] = [];
  if (layout === 'board') {
    const groupSelect = h('select', { 'aria-label': 'Column by' });
    for (const f of project.fields.filter((f) => f.kind === 'singleSelect')) {
      groupSelect.append(h('option', { value: f.id, selected: f.id === groupField?.id }, f.name));
    }
    groupSelect.addEventListener('change', () => {
      board.groupFieldId = groupSelect.value;
      send({ type: 'selectGroupField', fieldId: groupSelect.value });
      render();
    });
    controls.push(h('label', { class: 'field' }, h('span', {}, 'Column by'), groupSelect));
  } else {
    const grouped = effectiveGroupField(board, currentView);
    const groupBy = select(
      'Group by',
      [{ value: '', label: 'None' }, ...groupableFields(project.fields).map((f) => ({ value: f.id, label: f.name }))],
      grouped?.id ?? '',
      (value) => setPrefs(currentView?.id, { groupFieldId: value }),
    );
    controls.push(groupBy);
  }
  if (layout === 'roadmap') {
    const source = dateSource(board, currentView);
    const options = dateFields(project.fields).map((f) => ({ value: f.id, label: f.name }));
    if (source && options.length) {
      controls.push(
        select('Start', options, source.startFieldId, (value) => setPrefs(currentView?.id, { startFieldId: value })),
        select('Target', options, source.endFieldId, (value) => setPrefs(currentView?.id, { endFieldId: value })),
      );
    }
    const zooms: { value: Zoom; label: string }[] = [
      { value: 'month', label: 'Month' },
      { value: 'quarter', label: 'Quarter' },
      { value: 'year', label: 'Year' },
    ];
    controls.push(
      select('Zoom', zooms, prefsFor(currentView?.id).zoom ?? 'month', (value) => {
        if (value in ZOOM_SCALE) setPrefs(currentView?.id, { zoom: value as Zoom });
      }),
    );
  }

  const updated = h('span', { class: 'muted', title: board.loadedAt }, `Updated ${new Date(board.loadedAt).toLocaleTimeString()}`);
  bar.append(
    h('div', { class: 'title' }, title, meta),
    h('label', { class: 'field' }, h('span', {}, 'View'), viewSelect),
    ...controls,
    h('span', { class: 'spacer' }),
    ui.loading ? h('span', { class: 'muted' }, loadingText() ?? '') : updated,
    button('Refresh', () => send({ type: 'refresh' }), { icon: icons.refresh(), class: 'icon-button', title: 'Refresh' }),
    button('Open on GitHub', () => send({ type: 'openExternal', url: project.url }), {
      icon: icons.external(),
      class: 'icon-button',
      title: 'Open project on GitHub',
    }),
  );
  return bar;
}

function select(label: string, options: { value: string; label: string }[], value: string, onChange: (value: string) => void): HTMLElement {
  const el = h('select', { 'aria-label': label });
  for (const o of options) el.append(h('option', { value: o.value, selected: o.value === value }, o.label));
  el.addEventListener('change', () => onChange(el.value));
  return h('label', { class: 'field' }, h('span', {}, label), el);
}

function boardView(board: BoardState, visible: ProjectItem[]): HTMLElement {
  const { project } = board;
  const currentView = project.views.find((v) => v.id === board.viewId);
  const groupField = resolveGroupField(project.fields, currentView, board.groupFieldId);
  if (board.items.length === 0) {
    return h(
      'div',
      { class: 'empty-board' },
      h('h2', {}, 'This project has no items yet'),
      h('p', { class: 'muted' }, 'Add issues, pull requests or drafts on GitHub and refresh.'),
    );
  }
  const fields = cardFields(project.fields, groupField?.id);
  const columns = buildColumns(visible, groupField, { alwaysIncludeNone: !!groupField });
  const ctx: CardContext = { fields, columns, movable: !!groupField };
  return h('main', { class: 'board', 'aria-label': `Board grouped by ${groupField?.name ?? 'nothing'}` }, columns.map((c) => columnView(c, ctx)));
}

interface CardContext {
  fields: ProjectField[];
  columns: Column[];
  /** False when the board has no single-select field to move along. */
  movable: boolean;
}

function columnView(column: Column, ctx: CardContext): HTMLElement {
  const dot = h('span', { class: `dot color-${column.option?.color ?? 'none'}`, 'aria-hidden': 'true' });
  const header = h(
    'header',
    { class: 'column-header' },
    dot,
    h('h2', {}, column.name),
    h('span', { class: 'count', 'aria-label': `${column.items.length} items` }, String(column.items.length)),
  );
  const desc = column.option?.description ? h('p', { class: 'column-desc' }, column.option.description) : null;
  const list =
    column.items.length === 0
      ? h('div', { class: 'column-empty' }, 'No items')
      : h('ol', { class: 'cards' }, column.items.map((item) => cardView(item, column, ctx)));
  const isNone = column.id === NO_VALUE_COLUMN;
  const section = h(
    'section',
    {
      class: `column${isNone ? ' column-none' : ''}${isNone && column.items.length === 0 ? ' only-while-dragging' : ''}`,
      'data-column-id': column.id,
      'aria-label': column.name,
    },
    header,
    desc,
    list,
  );
  if (ctx.movable) {
    section.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      section.classList.add('drop-target');
    });
    section.addEventListener('dragleave', (e) => {
      if (!section.contains(e.relatedTarget as Node | null)) section.classList.remove('drop-target');
    });
    section.addEventListener('drop', (e) => {
      e.preventDefault();
      section.classList.remove('drop-target');
      // The re-render replaces the dragged card, so its 'dragend' may never reach us.
      app.classList.remove('is-dragging');
      const itemId = e.dataTransfer?.getData(DRAG_TYPE);
      if (itemId) moveItem(itemId, column.id);
    });
  }
  return section;
}

/** Move menus live inside scrolling columns, so they are placed with fixed coordinates. */
function positionMenu(details: HTMLDetailsElement): void {
  const summary = details.querySelector('summary');
  const menu = details.querySelector<HTMLElement>('.menu');
  if (!summary || !menu) return;
  const r = summary.getBoundingClientRect();
  menu.style.setProperty('top', `${Math.round(r.bottom + 4)}px`);
  menu.style.setProperty('left', `${Math.round(Math.max(8, r.right - 180))}px`);
}

function moveMenu(item: ProjectItem, column: Column, ctx: CardContext): HTMLElement {
  const key = `move:${item.id}`;
  const details = h('details', { class: 'filter-menu move-menu', open: ui.openMenu === key });
  details.append(h('summary', { title: 'Move to…', 'aria-label': `Move ${item.title} to another column` }, 'Move'));
  details.addEventListener('toggle', () => {
    // 'toggle' is async: ignore it when it lands on a menu that a re-render already replaced.
    if (!details.isConnected) return;
    if (details.open) {
      ui.openMenu = key;
      positionMenu(details);
    } else if (ui.openMenu === key) ui.openMenu = undefined;
  });
  const list = h('ul', { class: 'menu', role: 'menu' });
  for (const target of ctx.columns) {
    const b = h('button', { type: 'button', role: 'menuitem', class: 'menu-item', disabled: target.id === column.id }, target.name);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      moveItem(item.id, target.id);
    });
    list.append(h('li', {}, b));
  }
  details.append(list);
  return details;
}

function cardView(item: ProjectItem, column: Column, ctx: CardContext): HTMLElement {
  const { fields } = ctx;
  const meta = h('div', { class: 'card-meta' }, labelledIcon(item), h('span', { class: 'card-ref', title: item.repository ?? '' }, itemRef(item)));
  if (item.url) {
    const url = item.url;
    meta.append(button('Open on GitHub', () => send({ type: 'openExternal', url }), { icon: icons.external(), class: 'icon-button small', title: 'Open on GitHub' }));
  }

  const labels = labelList(item);

  const values = fields
    .map((f) => [f, item.fieldValues[f.id]] as const)
    .filter((pair): pair is readonly [ProjectField, FieldValue] => pair[1] !== undefined);
  const chips = values.length
    ? h('ul', { class: 'fields', 'aria-label': 'Fields' }, values.map(([f, v]) => fieldChip(f, v)))
    : null;

  const assignees = assigneeList(item);

  if (ctx.movable) meta.append(moveMenu(item, column, ctx));
  const card = h(
    'li',
    {
      class: `card type-${item.type}`,
      tabindex: 0,
      'data-item-id': item.id,
      'aria-label': item.title,
      draggable: ctx.movable ? 'true' : undefined,
      'aria-keyshortcuts': ctx.movable ? 'Alt+ArrowLeft Alt+ArrowRight' : undefined,
    },
    meta,
    h('div', { class: 'card-title' }, item.title),
    labels,
    chips,
    assignees ? h('div', { class: 'card-footer' }, assignees) : null,
  );
  card.addEventListener('click', (e) => {
    // Buttons, links and menus inside the card keep their own behaviour.
    if ((e.target as Element | null)?.closest('button, a, summary, details, input, select')) return;
    openDetail(item.id);
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === card) openDetail(item.id);
  });
  if (ui.detail?.itemId === item.id) card.classList.add('selected');
  if (ctx.movable) {
    // Don't re-render during a drag: it would destroy the element being dragged.
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, item.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
      app.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      app.classList.remove('is-dragging');
      app.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    });
    card.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      const index = ctx.columns.findIndex((c) => c.id === column.id);
      const target = ctx.columns[index + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (target) moveItem(item.id, target.id);
    });
  }
  return card;
}

function fieldChip(field: ProjectField, value: FieldValue): HTMLElement {
  let text: string;
  let color: string | undefined;
  switch (value.kind) {
    case 'singleSelect':
      text = value.name;
      color = field.options?.find((o) => o.id === value.optionId)?.color;
      break;
    case 'iteration':
      text = value.title;
      break;
    case 'number':
      text = String(value.number);
      break;
    case 'date':
      text = formatDate(value.date);
      break;
    case 'text':
      text = value.text.length > 40 ? `${value.text.slice(0, 39)}…` : value.text;
      break;
  }
  return h(
    'li',
    { class: `field-chip kind-${value.kind}`, title: `${field.name}: ${text}` },
    color ? h('span', { class: `dot color-${color}`, 'aria-hidden': 'true' }) : null,
    h('span', { class: 'field-name' }, `${field.name}:`),
    ` ${text}`,
  );
}

render();
send({ type: 'ready' });
