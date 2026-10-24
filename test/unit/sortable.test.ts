// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { neighbour } from '../../src/webview/sortable';

/** A list of cards (and a non-draggable placeholder) as the board renders them. */
function list(ids: (string | null)[]): HTMLElement[] {
  const ol = document.createElement('ol');
  return ids.map((id) => {
    const li = document.createElement('li');
    if (id) {
      li.className = 'card';
      li.dataset.itemId = id;
    } else li.className = 'column-empty';
    ol.append(li);
    return li;
  });
}

describe('neighbour', () => {
  it('places a dropped card before the next card, or after the previous one at the end', () => {
    const [a, b, c] = list(['a', 'b', 'c']);
    expect(neighbour(a!, '.card')).toEqual({ targetId: 'b', place: 'before' });
    expect(neighbour(b!, '.card')).toEqual({ targetId: 'c', place: 'before' });
    expect(neighbour(c!, '.card')).toEqual({ targetId: 'b', place: 'after' });
  });

  it('skips elements that are not items and handles a list of one', () => {
    const [placeholder, a, add] = list([null, 'a', null]);
    expect(neighbour(a!, '.card')).toBeUndefined();
    expect(placeholder && add).toBeTruthy();
    const [x, gap, y] = list(['x', null, 'y']);
    expect(neighbour(x!, '.card')).toEqual({ targetId: 'y', place: 'before' });
    expect(gap).toBeTruthy();
    expect(neighbour(y!, '.card')).toEqual({ targetId: 'x', place: 'after' });
  });
});
