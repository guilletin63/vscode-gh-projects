// Roadmap layout: items as bars on a timeline, placed by a date or iteration field.
import { resolveGroupField } from '../model/board';
import type { DateSource, Span } from '../model/roadmap';
import { buildTimeline, isoDay, itemSpan, iterationSpans, sortBySpan } from '../model/roadmap';
import { groupItems, sortItems } from '../model/table';
import type { ProjectField, ProjectItem, ProjectView, ViewSort } from '../model/types';
import { h } from './dom';
import { formatDate, itemRef, labelledIcon } from './itemParts';

export type Zoom = 'month' | 'quarter' | 'year';

/** Pixels per day for each zoom level. */
export const ZOOM_SCALE: Record<Zoom, number> = { month: 30, quarter: 10, year: 3 };

export interface RoadmapProps {
  items: ProjectItem[];
  fields: ProjectField[];
  view?: ProjectView;
  source?: DateSource;
  sort?: ViewSort[];
  groupField?: ProjectField;
  zoom: Zoom;
  /** Today as a day number (local calendar day). */
  today: number;
  selectedId?: string;
  onOpen: (itemId: string) => void;
}

/** Bars narrower than this get their title next to them instead of inside. */
const MIN_LABELLED_BAR = 90;

export function roadmapView(props: RoadmapProps): HTMLElement {
  const { source } = props;
  if (!source) {
    return h(
      'div',
      { class: 'empty-board' },
      h('h2', {}, 'No dates to plan with'),
      h('p', { class: 'muted' }, 'Add a date or iteration field to the project on GitHub, then refresh to see items on the roadmap.'),
    );
  }
  const px = ZOOM_SCALE[props.zoom];
  const rows = props.sort?.length ? sortItems(props.items, props.sort, props.fields) : sortBySpan(props.items, source);
  const spans = new Map<string, Span>();
  for (const item of rows) {
    const span = itemSpan(item, source);
    if (span) spans.set(item.id, span);
  }
  const timeline = buildTimeline([...spans.values()], props.today);
  const width = (timeline.end - timeline.start + 1) * px;
  const x = (day: number) => (day - timeline.start) * px;
  const status = resolveGroupField(props.fields);

  const months = h(
    'div',
    { class: 'scale-row months' },
    timeline.months.map((m) => {
      const label = new Date(Date.UTC(m.year, m.month, 1)).toLocaleDateString(undefined, {
        month: m.days * px < 70 ? 'narrow' : 'short',
        ...(m.month === 0 || m.start === timeline.start ? { year: 'numeric' } : {}),
        timeZone: 'UTC',
      });
      return positioned(h('div', { class: 'scale-cell' }, h('span', { class: 'scale-label' }, label)), x(m.start), m.days * px);
    }),
  );
  const iterationField = props.fields.find((f) => f.id === source.startFieldId && f.kind === 'iteration');
  const iterations = iterationField
    ? h(
        'div',
        { class: 'scale-row iterations' },
        iterationSpans(iterationField)
          .filter((it) => it.span.end >= timeline.start && it.span.start <= timeline.end)
          .map((it) =>
            positioned(
              h(
                'div',
                { class: 'scale-cell iteration', title: `${it.title}: ${formatDate(isoDay(it.span.start))} – ${formatDate(isoDay(it.span.end))}` },
                h('span', { class: 'scale-label' }, it.title),
              ),
              x(it.span.start),
              (it.span.end - it.span.start + 1) * px,
            ),
          ),
      )
    : null;
  const head = h(
    'div',
    { class: 'roadmap-head' },
    h('div', { class: 'roadmap-title roadmap-corner' }, 'Title'),
    sized(h('div', { class: 'roadmap-scale' }, months, iterations), width),
  );

  const groups = props.groupField ? groupItems(rows, props.groupField) : [{ id: '', name: '', items: rows }];
  const body = h('div', { class: 'roadmap-body', role: 'list' });
  for (const g of groups) {
    if (props.groupField) {
      body.append(
        h(
          'div',
          { class: 'roadmap-group' },
          h(
            'div',
            { class: 'roadmap-title' },
            h('span', { class: `dot color-${'option' in g && g.option ? g.option.color : 'none'}`, 'aria-hidden': 'true' }),
            h('span', { class: 'group-name' }, g.name),
            h('span', { class: 'count' }, String(g.items.length)),
          ),
        ),
      );
    }
    for (const item of g.items) body.append(row(item, spans.get(item.id), { props, width, x, px, status }));
  }
  // Month separators and today's line run through every row.
  const grid = h('div', { class: 'roadmap-grid', 'aria-hidden': 'true' });
  for (const m of timeline.months.slice(1)) grid.append(positioned(h('div', { class: 'month-line' }), x(m.start), 0));
  grid.append(positioned(h('div', { class: 'today-line', title: 'Today' }), x(props.today) + px / 2, 0));
  body.prepend(sized(grid, width));

  const main = h('main', { class: 'roadmap', 'aria-label': `Roadmap by ${dateSourceLabel(props.fields, source)}` }, head, body);
  main.style.setProperty('--track-width', `${width}px`);
  main.dataset.todayX = String(x(props.today));
  if (rows.length === 0) main.append(h('p', { class: 'placeholder' }, 'No items match the filters.'));
  return main;
}

interface RowContext {
  props: RoadmapProps;
  width: number;
  x: (day: number) => number;
  px: number;
  status?: ProjectField;
}

function row(item: ProjectItem, span: Span | undefined, ctx: RowContext): HTMLElement {
  const { props } = ctx;
  const ref = item.number ? `#${item.number}` : itemRef(item);
  const title = h(
    'div',
    { class: 'roadmap-title', title: item.repository ? `${item.title} (${itemRef(item)})` : item.title },
    labelledIcon(item),
    h('span', { class: 'row-title' }, item.title),
    ref ? h('span', { class: 'muted row-ref' }, ref) : null,
  );
  const track = sized(h('div', { class: 'roadmap-track' }), ctx.width);
  const dates = span ? `${formatDate(isoDay(span.start))} – ${formatDate(isoDay(span.end))}` : 'No dates';
  if (span) {
    const value = ctx.status ? item.fieldValues[ctx.status.id] : undefined;
    const color = value?.kind === 'singleSelect' ? (ctx.status?.options?.find((o) => o.id === value.optionId)?.color ?? 'GRAY') : 'GRAY';
    const barWidth = Math.max(ctx.px, (span.end - span.start + 1) * ctx.px);
    const bar = positioned(h('div', { class: `roadmap-bar color-${color}`, title: `${item.title}\n${dates}` }), ctx.x(span.start), barWidth);
    const label = h('span', { class: 'bar-label' }, item.title);
    if (barWidth >= MIN_LABELLED_BAR) bar.append(label);
    else {
      label.classList.add('outside');
      label.style.setProperty('left', `${ctx.x(span.start) + barWidth + 6}px`);
    }
    track.append(bar);
    if (barWidth < MIN_LABELLED_BAR) track.append(label);
  } else {
    title.append(h('span', { class: 'muted no-dates' }, 'No dates'));
  }
  const el = h(
    'div',
    {
      class: `roadmap-row${props.selectedId === item.id ? ' selected' : ''}${span ? '' : ' undated'}`,
      role: 'listitem',
      tabindex: 0,
      'data-item-id': item.id,
      'aria-label': `${item.title}, ${dates}`,
    },
    title,
    track,
  );
  el.addEventListener('click', () => props.onOpen(item.id));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === el) props.onOpen(item.id);
  });
  return el;
}

export function dateSourceLabel(fields: ProjectField[], source: DateSource): string {
  const name = (id: string) => fields.find((f) => f.id === id)?.name ?? '?';
  return source.startFieldId === source.endFieldId ? name(source.startFieldId) : `${name(source.startFieldId)} → ${name(source.endFieldId)}`;
}

function positioned<T extends HTMLElement>(el: T, left: number, width: number): T {
  el.style.setProperty('left', `${left}px`);
  if (width > 0) el.style.setProperty('width', `${width}px`);
  return el;
}

function sized<T extends HTMLElement>(el: T, width: number): T {
  el.style.setProperty('width', `${width}px`);
  return el;
}
