// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { ChoiceMenuProps } from '../../src/webview/choiceMenu';
import { choiceMenu, toggleValue, visibleChoices } from '../../src/webview/choiceMenu';

const options = [
  { value: 'bug', label: 'bug', color: 'd73a4a' },
  { value: 'documentation', label: 'documentation', color: '0075ca' },
  { value: 'enhancement', label: 'enhancement', color: 'a2eeef' },
];

function props(patch: Partial<ChoiceMenuProps> = {}): ChoiceMenuProps & { toggled: string[]; queries: string[] } {
  const toggled: string[] = [];
  const queries: string[] = [];
  return {
    menuKey: 'choices:labels',
    title: 'Labels',
    open: true,
    options,
    selected: ['enhancement'],
    query: '',
    onOpen: () => undefined,
    onQuery: (q) => queries.push(q),
    onToggle: (v) => toggled.push(v),
    toggled,
    queries,
    ...patch,
  };
}

describe('visibleChoices', () => {
  it('puts the chosen values first and filters by the query, ignoring case', () => {
    expect(visibleChoices(options, ['enhancement'], '').map((o) => o.value)).toEqual(['enhancement', 'bug', 'documentation']);
    expect(visibleChoices(options, ['enhancement'], 'DOC').map((o) => o.value)).toEqual(['documentation']);
  });

  it('toggles a value in a list', () => {
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('choiceMenu', () => {
  it('renders a checkbox per choice, checked when chosen, and reports toggles', () => {
    const p = props();
    const el = choiceMenu(p);
    const boxes = [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false]);
    expect(el.querySelector('summary')?.getAttribute('aria-label')).toBe('Edit labels');
    boxes[1]!.dispatchEvent(new Event('change'));
    expect(p.toggled).toEqual(['bug']);
  });

  it('toggles the first match on Enter in the search box', () => {
    const p = props({ query: 'doc' });
    const search = choiceMenu(p).querySelector<HTMLInputElement>('input[type=search]')!;
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(p.toggled).toEqual(['documentation']);
  });

  it('shows loading, errors and empty results', () => {
    const loading: ChoiceMenuProps = props();
    delete loading.options;
    expect(choiceMenu(loading).textContent).toContain('Loading…');
    expect(choiceMenu(props({ error: 'No access' })).textContent).toContain('No access');
    expect(choiceMenu(props({ query: 'zzz' })).textContent).toContain('No matches');
  });

  it('stops offering more once the maximum is chosen', () => {
    const boxes = [...choiceMenu(props({ max: 1 })).querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    expect(boxes.map((b) => b.disabled)).toEqual([false, true, true]);
  });

  it('shows untrusted names as text', () => {
    const el = choiceMenu(props({ options: [{ value: '<img src=x>', label: '<img src=x>' }], selected: [] }));
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x>');
  });
});
