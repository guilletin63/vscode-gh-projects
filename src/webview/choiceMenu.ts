// "Edit" menu of the item details for labels and assignees: a search box and a checkbox per
// choice. Pure rendering: the choices, what is chosen and the query come in through props.
import { h } from './dom';

export interface ChoiceOption {
  value: string;
  label: string;
  /** Label color, hex without '#'. */
  color?: string;
  avatarUrl?: string;
}

export interface ChoiceMenuProps {
  /** Identifies the menu across re-renders (`ui.openMenu`, focus keys). */
  menuKey: string;
  title: string;
  open: boolean;
  /** Undefined while loading. */
  options?: ChoiceOption[];
  error?: string;
  selected: string[];
  query: string;
  /** No more can be chosen once this many are. */
  max?: number;
  onOpen(open: boolean): void;
  onQuery(query: string): void;
  onToggle(value: string): void;
}

export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** Chosen values first, then the rest, keeping those whose label contains the query. */
export function visibleChoices(options: ChoiceOption[], selected: string[], query: string): ChoiceOption[] {
  const q = query.trim().toLowerCase();
  const matching = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  return [...matching.filter((o) => selected.includes(o.value)), ...matching.filter((o) => !selected.includes(o.value))];
}

export function choiceMenu(props: ChoiceMenuProps): HTMLElement {
  const key = props.menuKey;
  const details = h('details', { class: 'filter-menu choice-menu', 'data-menu': key, open: props.open });
  details.append(h('summary', { 'aria-label': `Edit ${props.title.toLowerCase()}`, title: `Edit ${props.title.toLowerCase()}` }, 'Edit'));
  details.addEventListener('toggle', () => {
    // 'toggle' is async: ignore it when it lands on a menu that a re-render already replaced.
    if (details.isConnected && details.open !== props.open) props.onOpen(details.open);
  });

  const menu = h('div', { class: 'menu' });
  const list = h('ul', { class: 'choice-list', role: 'group', 'aria-label': props.title });
  const visible = props.options ? visibleChoices(props.options, props.selected, props.query) : [];
  if (props.error) list.append(h('li', { class: 'error-text' }, props.error));
  else if (!props.options) list.append(h('li', { class: 'muted' }, 'Loading…'));
  else if (visible.length === 0) list.append(h('li', { class: 'muted' }, props.options.length ? 'No matches' : 'Nothing to choose from'));
  const full = props.max !== undefined && props.selected.length >= props.max;
  for (const o of visible) {
    const checked = props.selected.includes(o.value);
    const input = h('input', { type: 'checkbox', checked, disabled: full && !checked, 'data-focus-key': `${key}:${o.value}` });
    input.addEventListener('change', () => props.onToggle(o.value));
    let swatch: HTMLElement | null = null;
    if (o.avatarUrl) swatch = h('img', { class: 'avatar', src: o.avatarUrl, alt: '' });
    else if (o.color && /^[0-9a-f]{6}$/i.test(o.color)) {
      swatch = h('span', { class: 'label-dot', 'aria-hidden': 'true' });
      swatch.style.setProperty('--label-color', `#${o.color}`);
    }
    list.append(h('li', {}, h('label', {}, input, swatch, h('span', { class: 'menu-label' }, o.label))));
  }

  if (props.options && props.options.length > 0) {
    const search = h('input', {
      type: 'search',
      class: 'search',
      placeholder: `Filter ${props.title.toLowerCase()}`,
      'aria-label': `Filter ${props.title.toLowerCase()}`,
      value: props.query,
      'data-focus-key': `${key}:search`,
    });
    search.addEventListener('input', () => props.onQuery(search.value));
    search.addEventListener('keydown', (e) => {
      // Enter picks the first match, so a label can be added without leaving the keyboard.
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = visible.find((o) => !(full && !props.selected.includes(o.value)));
      if (first) props.onToggle(first.value);
    });
    menu.append(search);
  }
  menu.append(list);
  if (full) menu.append(h('p', { class: 'muted choice-note' }, `At most ${props.max} can be chosen.`));
  details.append(menu);
  return details;
}
