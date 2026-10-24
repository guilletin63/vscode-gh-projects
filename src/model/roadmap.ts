import type { ProjectField, ProjectItem } from './types';

// Dates are handled as UTC day numbers (days since 1970-01-01) so time zones never move a bar.

const MS_PER_DAY = 86_400_000;

export function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / MS_PER_DAY);
}

export function isoDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Fields a roadmap can take its dates from. */
export function dateFields(fields: ProjectField[]): ProjectField[] {
  return fields.filter((f) => f.kind === 'date' || f.kind === 'iteration');
}

/**
 * Where bars start and end. GitHub's API doesn't say which fields a roadmap view uses, so the
 * user picks them; each end can be a date or an iteration field (possibly the same one).
 */
export interface DateSource {
  startFieldId: string;
  endFieldId: string;
}

/**
 * A sensible default: the first iteration field (bars span whole iterations), else date fields
 * named like "Start" and "Target"/"Due"/"End", else the first date field alone.
 */
export function defaultDateSource(fields: ProjectField[]): DateSource | undefined {
  const iteration = fields.find((f) => f.kind === 'iteration');
  if (iteration) return { startFieldId: iteration.id, endFieldId: iteration.id };
  const dates = fields.filter((f) => f.kind === 'date');
  const start = dates.find((f) => /start|begin/i.test(f.name)) ?? dates[0];
  if (!start) return undefined;
  const end = dates.find((f) => f.id !== start.id && /target|end|due|finish|deadline/i.test(f.name)) ?? start;
  return { startFieldId: start.id, endFieldId: end.id };
}

/** Keeps a remembered source only while its fields still exist. */
export function resolveDateSource(fields: ProjectField[], saved?: Partial<DateSource>): DateSource | undefined {
  const ids = new Set(dateFields(fields).map((f) => f.id));
  const fallback = defaultDateSource(fields);
  const start = saved?.startFieldId && ids.has(saved.startFieldId) ? saved.startFieldId : fallback?.startFieldId;
  const end = saved?.endFieldId && ids.has(saved.endFieldId) ? saved.endFieldId : fallback?.endFieldId;
  return start && end ? { startFieldId: start, endFieldId: end } : undefined;
}

/** Inclusive range of days. */
export interface Span {
  start: number;
  end: number;
}

function boundary(item: ProjectItem, fieldId: string, edge: 'start' | 'end'): number | undefined {
  const v = item.fieldValues[fieldId];
  if (v?.kind === 'date') return dayNumber(v.date);
  if (v?.kind === 'iteration' && v.startDate) {
    const start = dayNumber(v.startDate);
    return edge === 'start' ? start : start + Math.max(1, v.duration) - 1;
  }
  return undefined;
}

/**
 * The days an item covers. With only one end set the bar falls back to the other end's field
 * (a whole iteration, or a single day). Undefined when the item has no dates at all.
 */
export function itemSpan(item: ProjectItem, source: DateSource): Span | undefined {
  const start = boundary(item, source.startFieldId, 'start');
  const end = boundary(item, source.endFieldId, 'end');
  const s = start ?? boundary(item, source.endFieldId, 'start');
  const e = end ?? boundary(item, source.startFieldId, 'end');
  if (s === undefined || e === undefined) return undefined;
  return { start: Math.min(s, e), end: Math.max(s, e) };
}

export interface Month {
  year: number;
  /** 0-11 */
  month: number;
  /** First day (day number) and length. */
  start: number;
  days: number;
}

export interface Timeline {
  start: number;
  /** Inclusive. */
  end: number;
  months: Month[];
}

/**
 * Whole months covering every span and today, with a little room before and after so bars at
 * the edges stay readable.
 */
export function buildTimeline(spans: Span[], today: number): Timeline {
  const first = Math.min(today, ...spans.map((s) => s.start)) - 7;
  const last = Math.max(today, ...spans.map((s) => s.end)) + 14;
  const startDate = new Date(first * MS_PER_DAY);
  let y = startDate.getUTCFullYear();
  let m = startDate.getUTCMonth();
  const months: Month[] = [];
  for (;;) {
    const start = Math.floor(Date.UTC(y, m, 1) / MS_PER_DAY);
    if (start > last) break;
    const next = Math.floor(Date.UTC(y, m + 1, 1) / MS_PER_DAY);
    months.push({ year: y, month: m, start, days: next - start });
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  const lastMonth = months[months.length - 1];
  return { start: months[0]?.start ?? first, end: lastMonth ? lastMonth.start + lastMonth.days - 1 : last, months };
}

/** Iterations of a field as spans, for the timeline's header markers. */
export function iterationSpans(field: ProjectField | undefined): { title: string; span: Span }[] {
  return (field?.iterations ?? [])
    .map((it) => {
      const start = dayNumber(it.startDate);
      return { title: it.title, span: { start, end: start + Math.max(1, it.duration) - 1 } };
    })
    .sort((a, b) => a.span.start - b.span.start);
}

/** Items in timeline order: by start date, then end date, undated last; ties keep their order. */
export function sortBySpan(items: ProjectItem[], source: DateSource): ProjectItem[] {
  return items
    .map((item, index) => ({ item, index, span: itemSpan(item, source) }))
    .sort((a, b) => {
      if (!a.span || !b.span) return a.span ? -1 : b.span ? 1 : a.index - b.index;
      return a.span.start - b.span.start || a.span.end - b.span.end || a.index - b.index;
    })
    .map((r) => r.item);
}
