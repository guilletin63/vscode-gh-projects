// Editor for one project field of one item: a select for single-select and iteration fields,
// an input for text, number and date. Used by the detail panel and table cells.
import type { FieldInput } from '../model/edits';
import type { ProjectField, ProjectItem } from '../model/types';
import { h } from './dom';

export function fieldControl(
  field: ProjectField,
  item: ProjectItem,
  onEdit: (field: ProjectField, input: FieldInput) => void,
  opts: { id: string; label?: string },
): HTMLElement {
  const value = item.fieldValues[field.id];
  const id = opts.id;
  let control: HTMLElement;
  switch (field.kind) {
    case 'singleSelect':
    case 'iteration': {
      const select = h('select', { id, 'data-focus-key': id });
      select.append(h('option', { value: '' }, '—'));
      if (field.kind === 'singleSelect') {
        for (const o of field.options ?? []) {
          select.append(h('option', { value: o.id, selected: value?.kind === 'singleSelect' && value.optionId === o.id }, o.name));
        }
      } else {
        for (const it of field.iterations ?? []) {
          const selected = value?.kind === 'iteration' && value.iterationId === it.id;
          if (it.completed && !selected) continue;
          select.append(h('option', { value: it.id, selected }, `${it.title}${it.completed ? ' (completed)' : ''}`));
        }
      }
      select.addEventListener('change', () => {
        if (!select.value) onEdit(field, null);
        else if (field.kind === 'singleSelect') onEdit(field, { kind: 'singleSelect', optionId: select.value });
        else onEdit(field, { kind: 'iteration', iterationId: select.value });
      });
      control = select;
      break;
    }
    case 'text':
    case 'number':
    case 'date': {
      const current =
        value?.kind === 'text' ? value.text : value?.kind === 'number' ? String(value.number) : value?.kind === 'date' ? value.date : '';
      const input = h('input', {
        id,
        type: field.kind === 'text' ? 'text' : field.kind,
        value: current,
        step: field.kind === 'number' ? 'any' : undefined,
        'data-focus-key': id,
      });
      const commit = () => {
        const raw = input.value.trim();
        if (raw === current) return;
        if (raw === '') onEdit(field, null);
        else if (field.kind === 'text') onEdit(field, { kind: 'text', text: raw });
        else if (field.kind === 'number') {
          const n = Number(raw);
          if (Number.isFinite(n)) onEdit(field, { kind: 'number', number: n });
        } else onEdit(field, { kind: 'date', date: raw });
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
      control = input;
      break;
    }
    default:
      control = h('span', {}, '');
  }
  if (opts.label) control.setAttribute('aria-label', opts.label);
  return control;
}
