// Board webview. Renders the BoardState sent by the extension; never talks to the network.
import { NO_VALUE_COLUMN, buildColumns, cardFields, resolveGroupField } from '../model/board';
import type { Column } from '../model/board';
import type { FieldInput } from '../model/edits';
import { PendingEdits, afterIdFor, isSameValue } from '../model/edits';
import type { BoardFilter } from '../model/filter';
import { applyFilter, buildFacets } from '../model/filter';
import { canDragDates, dateEdits, dateFields, dayNumber, isoDay, resolveDateSource } from '../model/roadmap';
import type { DateSource, Span } from '../model/roadmap';
import { fieldSum, groupInput, groupItems, groupableFields, sortItems } from '../model/table';
import type { FieldValue, ItemDetail, ProjectField, ProjectItem, ProjectView, ViewSort } from '../model/types';
import type { BoardState, HostMessage, WebviewMessage } from '../shared/protocol';
import { h, icons } from './dom';
import { detailPanel } from './detail';
import { filterBar } from './filterBar';
import { assigneeList, formatDate, itemRef, labelList, labelledIcon } from './itemParts';
import type { Zoom } from './roadmapView';
import { ZOOM_SCALE, isBarDragging, roadmapView } from './roadmapView';
import type { DropTarget } from './sortable';
import { isSorting, justDropped, sortableList } from './sortable';
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
  /** Table cell being edited in place; `focus` asks the next render to focus its editor. */
  editing?: { itemId: string; fieldId: string; focus?: boolean };
  /** "Add item" input being typed into (board column or table group), and its request. */
  adding?: { key: string; pending?: boolean; requestId?: string };
}
const ui: UiState = {};
const pending = new PendingEdits();
let addSeq = 0;

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
  /** Folded groups (table, roadmap) and swimlanes. */
  collapsed?: string[];
  /** Show every item even though the view has a filter on GitHub. */
  ignoreFilter?: boolean;
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

function collapsedGroups(view: ProjectView | undefined): Set<string> {
  return new Set(prefsFor(view?.id).collapsed ?? []);
}

function toggleGroup(view: ProjectView | undefined, groupId: string): void {
  const collapsed = collapsedGroups(view);
  if (collapsed.has(groupId)) collapsed.delete(groupId);
  else collapsed.add(groupId);
  setPrefs(view?.id, { collapsed: [...collapsed] });
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

/** Moves an item in the project order: shown immediately, rolled back if GitHub rejects it. */
function setPosition(itemId: string, afterId: string | undefined): void {
  const board = ui.board;
  if (!board) return;
  const { requestId, items } = pending.applyPosition(board.items, itemId, afterId);
  ui.board = { ...board, items };
  send({ type: 'setPosition', requestId, itemId, ...(afterId ? { afterId } : {}) });
}

interface FieldChange {
  field: ProjectField;
  input: FieldInput;
}

/**
 * An item dropped into a column, group or swimlane (sets each field that changes) and/or next to
 * another item (changes its position).
 */
function dropItem(itemId: string, changes: FieldChange[], next?: DropTarget): void {
  const item = ui.board?.items.find((i) => i.id === itemId);
  if (!ui.board || !item) return;
  ui.openMenu = undefined;
  const applied = changes.filter((c) => !isSameValue(item.fieldValues[c.field.id], c.input));
  for (const { field, input } of applied) {
    const { requestId, items } = pending.apply(ui.board.items, itemId, field, input);
    ui.board = { ...ui.board, items };
    send({ type: 'setField', requestId, itemId, fieldId: field.id, input });
  }
  const regroup = applied.length > 0;
  if (regroup) {
    announce(`Moved ${item.title} to ${applied.map(({ field, input }) => (input === null ? `No ${field.name}` : groupLabel(field, input))).join(', ')}`);
  }
  if (next && ui.board) {
    const afterId = afterIdFor(ui.board.items, itemId, next.targetId, next.place);
    if (afterId !== null) {
      setPosition(itemId, afterId);
      if (!regroup) announce(`Moved ${item.title}`);
    }
  }
  render();
  app.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(itemId)}"][tabindex]`)?.focus();
}

function groupLabel(field: ProjectField, input: Exclude<FieldInput, null>): string {
  switch (input.kind) {
    case 'singleSelect':
      return field.options?.find((o) => o.id === input.optionId)?.name ?? '';
    case 'iteration':
      return field.iterations?.find((i) => i.id === input.iterationId)?.title ?? '';
    case 'number':
      return String(input.number);
    case 'date':
      return formatDate(input.date);
    case 'text':
      return input.text;
  }
}

function startAdd(key: string): void {
  ui.adding = { key };
  render();
  app.querySelector<HTMLInputElement>('.add-input')?.focus();
}

function cancelAdd(): void {
  if (ui.adding?.pending) return;
  ui.adding = undefined;
  render();
}

/** Adds a draft issue with the values of the column, group or swimlane it was typed into. */
function addDraft(key: string, title: string, changes: FieldChange[]): void {
  const requestId = `add-${++addSeq}`;
  ui.adding = { key, pending: true, requestId };
  const values = changes.flatMap(({ field, input }) => (input === null ? [] : [{ fieldId: field.id, input }]));
  send({ type: 'addDraft', requestId, title, values });
  render();
}

/** Writes a roadmap bar's new dates (one or two date fields). */
function setSpan(itemId: string, span: Span, source: DateSource): void {
  const board = ui.board;
  const item = board?.items.find((i) => i.id === itemId);
  if (!board || !item) return;
  for (const edit of dateEdits(item, source, span)) {
    const field = board.project.fields.find((f) => f.id === edit.fieldId);
    if (field) {
      const { requestId, items } = pending.apply(ui.board!.items, itemId, field, { kind: 'date', date: edit.date });
      ui.board = { ...ui.board!, items };
      send({ type: 'setField', requestId, itemId, fieldId: field.id, input: { kind: 'date', date: edit.date } });
    }
  }
  announce(`${item.title}: ${formatDate(isoDay(span.start))} to ${formatDate(isoDay(span.end))}`);
  render();
  app.querySelector<HTMLElement>(`.roadmap-row[data-item-id="${CSS.escape(itemId)}"]`)?.focus();
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

/**
 * Moves a card to a column by setting the grouping field, and next to another card when
 * dropped on one; optimistic, rolled back on failure.
 */
function moveItem(itemId: string, columnId: string, next?: DropTarget, lane?: FieldChange): void {
  const board = ui.board;
  if (!board) return;
  const field = resolveGroupField(board.project.fields, currentView(board), board.groupFieldId);
  if (!field) {
    if (next) dropItem(itemId, lane ? [lane] : [], next);
    return;
  }
  const input: FieldInput = columnId === NO_VALUE_COLUMN ? null : { kind: 'singleSelect', optionId: columnId };
  dropItem(itemId, [{ field, input }, ...(lane ? [lane] : [])], next);
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
    case 'addResult':
      if (ui.adding?.requestId !== msg.requestId) break;
      if (msg.ok) ui.adding = undefined;
      else {
        ui.adding = { key: ui.adding.key };
        showBanner(`Could not add the item: ${(msg.message ?? 'unknown error').replace(/\.$/, '')}.`, 8000);
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

let renderPending = false;

function render(): void {
  // Re-rendering would destroy the bar or card being dragged; render once the drag ends.
  if (isBarDragging() || isSorting()) {
    renderPending = true;
    return;
  }
  renderPending = false;
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
  if (ui.editing?.focus) {
    ui.editing.focus = false;
    app.querySelector<HTMLElement>('.cell-editor')?.focus();
  } else if (focusKey) {
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
  const scope = viewScope(board);
  const visible = applyFilter(scope.items, board.filter);
  if (board.items.length > 0) {
    nodes.push(
      filterBar({
        filter: board.filter,
        facets: buildFacets(scope.items, board.project.fields),
        shown: visible.length,
        total: scope.items.length,
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
  if (scope.filter) nodes.push(viewFilterBar(board, scope.filter));
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

interface ViewFilterInfo {
  query: string;
  state: 'on' | 'off' | 'loading' | 'error';
  error?: string;
}

/**
 * Items of the current view: those matching the view's own GitHub filter, unless the user
 * chose to see every item (or GitHub couldn't apply it).
 */
function viewScope(board: BoardState): { items: ProjectItem[]; filter?: ViewFilterInfo } {
  const view = currentView(board);
  const query = view?.filter.trim();
  if (!view || !query) return { items: board.items };
  if (prefsFor(view.id).ignoreFilter) return { items: board.items, filter: { query, state: 'off' } };
  const matches = board.viewMatches?.viewId === view.id ? board.viewMatches : undefined;
  if (!matches) return { items: board.items, filter: { query, state: 'loading' } };
  if ('error' in matches) return { items: board.items, filter: { query, state: 'error', error: matches.error } };
  const ids = new Set(matches.itemIds);
  return { items: board.items.filter((i) => ids.has(i.id)), filter: { query, state: 'on' } };
}

function viewFilterBar(board: BoardState, info: ViewFilterInfo): HTMLElement {
  const view = currentView(board);
  const toggle = (ignore: boolean) => setPrefs(view?.id, { ignoreFilter: ignore });
  const text: Record<ViewFilterInfo['state'], string> = {
    on: 'View filter',
    off: 'View filter off',
    loading: 'Applying view filter',
    error: 'Could not apply the view filter',
  };
  return h(
    'div',
    { class: `view-filter state-${info.state}`, role: 'status' },
    h('span', { class: 'muted' }, `${text[info.state]}:`),
    h('code', { title: info.error ?? 'Filter saved with this view on GitHub' }, info.query),
    info.state === 'on' ? button('Show all items', () => toggle(true), { class: 'link-button' }) : null,
    info.state === 'off' ? button('Apply it', () => toggle(false), { class: 'link-button' }) : null,
  );
}

function layoutView(board: BoardState, visible: ProjectItem[]): HTMLElement {
  const view = currentView(board);
  if (board.items.length === 0 || view?.layout === 'board' || !view) return boardView(board, visible);
  const selectedId = ui.detail?.itemId;
  const groupField = effectiveGroupField(board, view);
  if (view.layout === 'table') {
    return tableView({
      items: visible,
      fields: board.project.fields,
      view,
      ...withValue('sort', effectiveSort(view)),
      ...withValue('groupField', groupField),
      ...withValue('selectedId', selectedId),
      ...withValue('editing', ui.editing),
      ...withValue('adding', ui.adding),
      collapsed: collapsedGroups(view),
      root: app,
      onSort: (fieldId) => toggleSort(view, fieldId),
      onOpen: openDetail,
      onOpenExternal: (url) => send({ type: 'openExternal', url }),
      onToggleGroup: (groupId) => toggleGroup(view, groupId),
      onStartEdit: (itemId, fieldId) => {
        ui.editing = { itemId, fieldId, focus: true };
        render();
      },
      onStopEdit: () => {
        if (!ui.editing) return;
        ui.editing = undefined;
        // Blur fires while the editor is being replaced: render after the current event.
        setTimeout(render, 0);
      },
      onEdit: (itemId, field, input) => {
        const item = board.items.find((i) => i.id === itemId);
        ui.editing = undefined;
        if (item && !isSameValue(item.fieldValues[field.id], input)) editField(itemId, field, input);
        else render();
      },
      onDrop: (itemId, groupId, next) => {
        const input = groupField && groupId !== undefined ? groupInput(groupField, groupId) : undefined;
        dropItem(itemId, groupField && input !== undefined ? [{ field: groupField, input }] : [], next);
      },
      onSettled: render,
      onStartAdd: startAdd,
      onCancelAdd: cancelAdd,
      onAdd: (key, title, groupId) => {
        const input = groupField && groupId !== undefined ? groupInput(groupField, groupId) : undefined;
        addDraft(key, title, groupField && input !== undefined ? [{ field: groupField, input }] : []);
      },
    });
  }
  const source = dateSource(board, view);
  return roadmapView({
    items: visible,
    fields: board.project.fields,
    view,
    ...withValue('source', source),
    ...withValue('sort', effectiveSort(view)),
    ...withValue('groupField', groupField),
    zoom: prefsFor(view.id).zoom ?? 'month',
    today: today(),
    ...withValue('selectedId', selectedId),
    collapsed: collapsedGroups(view),
    draggable: canDragDates(board.project.fields, source),
    onOpen: openDetail,
    onToggleGroup: (groupId) => toggleGroup(view, groupId),
    onSpan: (itemId, span) => {
      if (source) setSpan(itemId, span, source);
    },
    onSettled: () => {
      if (renderPending) render();
    },
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
    const lanes = effectiveGroupField(board, currentView);
    controls.push(
      select(
        'Swimlanes',
        [{ value: '', label: 'None' }, ...groupableFields(project.fields).filter((f) => f.id !== groupField?.id).map((f) => ({ value: f.id, label: f.name }))],
        lanes && lanes.id !== groupField?.id ? lanes.id : '',
        (value) => setPrefs(currentView?.id, { groupFieldId: value }),
      ),
    );
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
  const view = currentView(board);
  const groupField = resolveGroupField(project.fields, view, board.groupFieldId);
  if (board.items.length === 0) {
    return h(
      'div',
      { class: 'empty-board' },
      h('h2', {}, 'This project has no items yet'),
      h('p', { class: 'muted' }, 'Add issues, pull requests or drafts on GitHub and refresh.'),
    );
  }
  // A board sorted on GitHub shows its cards in that order and has no manual order.
  const sort = view?.sortBy;
  const sorted = sortItems(visible, sort, project.fields);
  const laneField = effectiveGroupField(board, view);
  const fields = cardFields(project.fields, groupField?.id).filter((f) => f.id !== laneField?.id);
  const base = {
    fields,
    movable: !!groupField,
    orderable: !sort?.length,
    numberFields: project.fields.filter((f) => f.kind === 'number'),
  };
  const label = `Board grouped by ${groupField?.name ?? 'nothing'}`;
  if (!laneField || laneField.id === groupField?.id) {
    const columns = boardColumns(sorted, groupField);
    const ctx: CardContext = { ...base, columns };
    return h('main', { class: 'board', 'aria-label': label }, columns.map((c) => columnView(c, ctx)));
  }
  // Swimlanes: one row of columns per value of the view's "Group by" field.
  const collapsed = collapsedGroups(view);
  const lanes = groupItems(sorted, laneField).map((lane) => {
    const columns = boardColumns(lane.items, groupField);
    const input = groupInput(laneField, lane.id);
    const ctx: CardContext = { ...base, columns, laneId: lane.id, ...(input !== undefined ? { lane: { field: laneField, input } } : {}) };
    const folded = collapsed.has(lane.id);
    const sums = base.numberFields.flatMap((f) => {
      const sum = fieldSum(lane.items, f);
      return sum === undefined ? [] : [`${f.name}: ${sum}`];
    });
    const toggle = h(
      'button',
      { type: 'button', class: 'group-toggle', 'aria-expanded': String(!folded), title: folded ? 'Expand swimlane' : 'Collapse swimlane' },
      h('span', { class: 'chevron', 'aria-hidden': 'true' }, folded ? '▸' : '▾'),
      h('span', { class: `dot color-${lane.option?.color ?? 'none'}`, 'aria-hidden': 'true' }),
      h('span', { class: 'group-name' }, lane.name),
      h('span', { class: 'count' }, String(lane.items.length)),
      sums.length ? h('span', { class: 'muted field-sums' }, sums.join(' · ')) : null,
    );
    toggle.addEventListener('click', () => toggleGroup(view, lane.id));
    return h(
      'section',
      { class: 'lane', 'data-lane-id': lane.id, 'aria-label': `${laneField.name}: ${lane.name}` },
      h('header', { class: 'lane-header' }, toggle),
      folded ? null : h('div', { class: 'lane-columns' }, columns.map((c) => columnView(c, ctx))),
    );
  });
  return h('main', { class: 'board with-lanes', 'aria-label': `${label}, swimlanes by ${laneField.name}` }, lanes);
}

/**
 * Columns of a board. An empty "No <field>" column only shows while dragging, as a drop target;
 * it goes last so its appearance doesn't shift the columns under the pointer.
 */
function boardColumns(items: ProjectItem[], groupField: ProjectField | undefined): Column[] {
  const columns = buildColumns(items, groupField, { alwaysIncludeNone: !!groupField });
  const first = columns[0];
  if (first?.id === NO_VALUE_COLUMN && first.items.length === 0 && groupField) columns.push(columns.shift()!);
  return columns;
}

interface CardContext {
  fields: ProjectField[];
  columns: Column[];
  /** False when the board has no single-select field to move along. */
  movable: boolean;
  /** Cards keep the project's manual order (the view isn't sorted), so they can be reordered. */
  orderable: boolean;
  /** Number fields summed in column headers. */
  numberFields: ProjectField[];
  /** Swimlane the columns belong to, and the value a card dropped in it gets. */
  laneId?: string;
  lane?: FieldChange;
}

function columnView(column: Column, ctx: CardContext): HTMLElement {
  const dot = h('span', { class: `dot color-${column.option?.color ?? 'none'}`, 'aria-hidden': 'true' });
  const sums = ctx.numberFields.flatMap((f) => {
    const sum = fieldSum(column.items, f);
    return sum === undefined ? [] : [`${f.name}: ${sum}`];
  });
  const header = h(
    'header',
    { class: 'column-header' },
    dot,
    h('h2', {}, column.name),
    h('span', { class: 'count', 'aria-label': `${column.items.length} items` }, String(column.items.length)),
    sums.length ? h('span', { class: 'muted field-sums', title: 'Sum of number fields' }, sums.join(' · ')) : null,
  );
  const desc = column.option?.description ? h('p', { class: 'column-desc' }, column.option.description) : null;
  // The list is always there (even empty) so cards can be dropped into it.
  const list = h(
    'ol',
    { class: 'cards' },
    column.items.length === 0 ? h('li', { class: 'column-empty' }, 'No items') : column.items.map((item) => cardView(item, column, ctx)),
    addCard(column, ctx),
  );
  const isNone = column.id === NO_VALUE_COLUMN;
  const section = h(
    'section',
    {
      class: `column${isNone ? ' column-none' : ''}${isNone && column.items.length === 0 ? ' only-while-dragging' : ''}`,
      'data-column-id': ctx.laneId !== undefined ? `${ctx.laneId}:${column.id}` : column.id,
      'aria-label': column.name,
    },
    header,
    desc,
    list,
  );
  if (ctx.movable || ctx.orderable) {
    sortableList(list, {
      // Cards travel between columns (and swimlanes) only when there is a field to set.
      ...(ctx.movable ? { group: 'board-cards' } : {}),
      sort: ctx.orderable,
      draggable: '.card',
      root: app,
      onDrop: (itemId, to, next) => {
        const target = listColumns.get(to) ?? { column, ctx };
        const place = target.ctx.orderable ? next : undefined;
        if (target.ctx.movable) moveItem(itemId, target.column.id, place, target.ctx.lane);
        else if (place) dropItem(itemId, target.ctx.lane ? [target.ctx.lane] : [], place);
        else render();
      },
      onSettled: render,
    });
    listColumns.set(list, { column, ctx });
  }
  return section;
}

/** Column (and swimlane) of each rendered card list, to resolve where a card was dropped. */
const listColumns = new WeakMap<HTMLElement, { column: Column; ctx: CardContext }>();

/** "+ Add item" at the bottom of a column: a draft issue with that column's (and lane's) value. */
function addCard(column: Column, ctx: CardContext): HTMLElement {
  const key = `board:${ctx.laneId ?? ''}:${column.id}`;
  const adding = ui.adding?.key === key ? ui.adding : undefined;
  if (!adding) {
    const b = h('button', { type: 'button', class: 'add-button' }, '+ Add item');
    b.addEventListener('click', () => startAdd(key));
    return h('li', { class: 'column-add' }, b);
  }
  const input = h('input', {
    type: 'text',
    class: 'add-input',
    placeholder: 'Draft title, then Enter',
    'aria-label': `Title of the new draft in ${column.name}`,
    'data-focus-key': `add-${key}`,
    disabled: !!adding.pending,
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') cancelAdd();
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const board = ui.board;
    const field = board ? resolveGroupField(board.project.fields, currentView(board), board.groupFieldId) : undefined;
    const changes: FieldChange[] = field && column.id !== NO_VALUE_COLUMN ? [{ field, input: { kind: 'singleSelect', optionId: column.id } }] : [];
    addDraft(key, input.value.trim(), ctx.lane ? [...changes, ctx.lane] : changes);
  });
  input.addEventListener('blur', () => {
    if (!input.value.trim()) cancelAdd();
  });
  return h('li', { class: 'column-add' }, input, adding.pending ? h('span', { class: 'muted' }, 'Adding…') : null);
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
      'aria-keyshortcuts':
        [ctx.movable ? 'Alt+ArrowLeft Alt+ArrowRight' : '', ctx.orderable ? 'Alt+ArrowUp Alt+ArrowDown' : ''].join(' ').trim() || undefined,
    },
    meta,
    h('div', { class: 'card-title' }, item.title),
    labels,
    chips,
    assignees ? h('div', { class: 'card-footer' }, assignees) : null,
  );
  card.addEventListener('click', (e) => {
    // Buttons, links and menus inside the card keep their own behaviour.
    if (justDropped() || (e.target as Element | null)?.closest('button, a, summary, details, input, select')) return;
    openDetail(item.id);
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === card) openDetail(item.id);
  });
  if (ui.detail?.itemId === item.id) card.classList.add('selected');
  card.addEventListener('keydown', (e) => {
    if (!e.altKey || e.target !== card) return;
    if (ctx.movable && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const index = ctx.columns.findIndex((c) => c.id === column.id);
      const target = ctx.columns[index + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (target) moveItem(item.id, target.id);
    }
    // Alt+↑/↓ reorders the card inside its column.
    if (ctx.orderable && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const index = column.items.findIndex((i) => i.id === item.id);
      const neighbour = column.items[index + (e.key === 'ArrowUp' ? -1 : 1)];
      if (neighbour) dropItem(item.id, [], { targetId: neighbour.id, place: e.key === 'ArrowUp' ? 'before' : 'after' });
    }
  });
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
