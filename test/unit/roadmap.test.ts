import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  dayNumber,
  defaultDateSource,
  isoDay,
  itemSpan,
  iterationSpans,
  resolveDateSource,
  sortBySpan,
} from '../../src/model/roadmap';
import type { FieldValue, ProjectField, ProjectItem } from '../../src/model/types';

const date = (id: string, name: string): ProjectField => ({ id, name, dataType: 'DATE', kind: 'date' });
const sprint: ProjectField = {
  id: 'SP',
  name: 'Sprint',
  dataType: 'ITERATION',
  kind: 'iteration',
  iterations: [
    { id: 'i2', title: 'Sprint 2', startDate: '2026-10-26', duration: 14, completed: false },
    { id: 'i1', title: 'Sprint 1', startDate: '2026-10-12', duration: 14, completed: false },
  ],
};
const start = date('ST', 'Start date');
const due = date('DU', 'Due');

function item(id: string, values: FieldValue[] = []): ProjectItem {
  return { id, type: 'Issue', title: id, labels: [], assignees: [], updatedAt: '', fieldValues: Object.fromEntries(values.map((v) => [v.fieldId, v])) };
}
const d = (fieldId: string, value: string): FieldValue => ({ kind: 'date', fieldId, date: value });
const iter = (id: string, startDate: string): FieldValue => ({ kind: 'iteration', fieldId: 'SP', iterationId: id, title: id, startDate, duration: 14 });

describe('day numbers', () => {
  it('round-trips ISO dates without time zone drift', () => {
    expect(isoDay(dayNumber('2026-10-24'))).toBe('2026-10-24');
    expect(dayNumber('2026-10-25') - dayNumber('2026-10-24')).toBe(1);
    expect(dayNumber('2026-10-24T23:30:00Z')).toBe(dayNumber('2026-10-24'));
  });
});

describe('date sources', () => {
  it('prefers an iteration field, then start/target date fields, then one date field', () => {
    expect(defaultDateSource([due, sprint])).toEqual({ startFieldId: 'SP', endFieldId: 'SP' });
    expect(defaultDateSource([due, start])).toEqual({ startFieldId: 'ST', endFieldId: 'DU' });
    expect(defaultDateSource([due])).toEqual({ startFieldId: 'DU', endFieldId: 'DU' });
    expect(defaultDateSource([])).toBeUndefined();
  });

  it('keeps a remembered source while its fields exist', () => {
    expect(resolveDateSource([due, sprint], { startFieldId: 'DU', endFieldId: 'DU' })).toEqual({ startFieldId: 'DU', endFieldId: 'DU' });
    expect(resolveDateSource([due, sprint], { startFieldId: 'gone', endFieldId: 'DU' })).toEqual({ startFieldId: 'SP', endFieldId: 'DU' });
  });
});

describe('itemSpan', () => {
  it('spans a whole iteration', () => {
    const span = itemSpan(item('a', [iter('i1', '2026-10-12')]), { startFieldId: 'SP', endFieldId: 'SP' });
    expect(span && [isoDay(span.start), isoDay(span.end)]).toEqual(['2026-10-12', '2026-10-25']);
  });

  it('goes from the start date to the target date', () => {
    const span = itemSpan(item('a', [d('ST', '2026-10-01'), d('DU', '2026-10-10')]), { startFieldId: 'ST', endFieldId: 'DU' });
    expect(span && [isoDay(span.start), isoDay(span.end)]).toEqual(['2026-10-01', '2026-10-10']);
  });

  it('falls back to a single day when only one end is set, and to nothing without dates', () => {
    const source = { startFieldId: 'ST', endFieldId: 'DU' };
    const only = itemSpan(item('a', [d('DU', '2026-10-10')]), source);
    expect(only && [isoDay(only.start), isoDay(only.end)]).toEqual(['2026-10-10', '2026-10-10']);
    expect(itemSpan(item('b'), source)).toBeUndefined();
  });

  it('mixes an iteration start with a target date and fixes reversed ranges', () => {
    const span = itemSpan(item('a', [iter('i2', '2026-10-26'), d('DU', '2026-10-20')]), { startFieldId: 'SP', endFieldId: 'DU' });
    expect(span && [isoDay(span.start), isoDay(span.end)]).toEqual(['2026-10-20', '2026-10-26']);
  });
});

describe('buildTimeline', () => {
  it('covers every span and today in whole months', () => {
    const t = buildTimeline([{ start: dayNumber('2026-10-12'), end: dayNumber('2026-11-08') }], dayNumber('2026-10-24'));
    expect(t.months.map((m) => `${m.year}-${m.month + 1}`)).toEqual(['2026-10', '2026-11']);
    expect(isoDay(t.start)).toBe('2026-10-01');
    expect(isoDay(t.end)).toBe('2026-11-30');
    expect(t.months[0]?.days).toBe(31);
  });

  it('pads the edges and crosses years', () => {
    const t = buildTimeline([{ start: dayNumber('2026-12-28'), end: dayNumber('2027-01-03') }], dayNumber('2026-12-30'));
    expect(t.months.map((m) => `${m.year}-${m.month + 1}`)).toEqual(['2026-12', '2027-1']);
  });

  it('shows the current month when nothing has dates', () => {
    const t = buildTimeline([], dayNumber('2026-10-24'));
    expect(t.months[0]?.month).toBe(9);
  });
});

describe('ordering and iterations', () => {
  it('orders by start then end, undated last', () => {
    const source = { startFieldId: 'ST', endFieldId: 'DU' };
    const items = [item('none'), item('late', [d('ST', '2026-11-01')]), item('early', [d('ST', '2026-10-01'), d('DU', '2026-10-30')]), item('early-short', [d('ST', '2026-10-01')])];
    expect(sortBySpan(items, source).map((i) => i.id)).toEqual(['early-short', 'early', 'late', 'none']);
  });

  it('lists iterations by start date', () => {
    expect(iterationSpans(sprint).map((i) => [i.title, isoDay(i.span.start), isoDay(i.span.end)])).toEqual([
      ['Sprint 1', '2026-10-12', '2026-10-25'],
      ['Sprint 2', '2026-10-26', '2026-11-08'],
    ]);
  });
});
