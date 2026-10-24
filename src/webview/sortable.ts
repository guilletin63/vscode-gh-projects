// Drag & drop of board cards and table rows, with SortableJS in pointer mode. Native HTML5 drag
// & drop is unreliable inside VS Code webviews (cross-origin iframes: on recent VS Code / macOS
// the browser cancels the drag), so `forceFallback` makes SortableJS follow pointer events and
// move a floating copy instead. It also works with touch.
import Sortable from 'sortablejs';

export type Place = 'before' | 'after';

export interface DropTarget {
  targetId: string;
  place: Place;
}

let dragging = 0;
let dropAt = 0;

/** True while an item is being dragged; the panel must not re-render meanwhile. */
export function isSorting(): boolean {
  return dragging > 0;
}

/** The click that ends a drag is not a request to open the item. */
export function justDropped(): boolean {
  return Date.now() - dropAt < 400;
}

export interface SortableListOptions {
  /** Lists with the same group exchange items; without one, items stay in their list. */
  group?: string;
  /** Items can be reordered inside the list (false for sorted views). */
  sort: boolean;
  /** Selector of the draggable items (cards, rows). */
  draggable: string;
  /** Gets `is-dragging` during a drag. */
  root: HTMLElement;
  /** An item was dropped in `to` (maybe the same list), next to the item it now sits by. */
  onDrop: (itemId: string, to: HTMLElement, next: DropTarget | undefined) => void;
  /** A drag ended without moving anything. */
  onSettled: () => void;
}

/** Makes the items of `list` draggable. */
export function sortableList(list: HTMLElement, opts: SortableListOptions): Sortable {
  return Sortable.create(list, {
    ...(opts.group ? { group: opts.group } : {}),
    sort: opts.sort,
    draggable: opts.draggable,
    // Controls inside cards and rows keep working; a drag starts anywhere else.
    filter: 'button, a, summary, details, input, select, textarea',
    preventOnFilter: false,
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: 4,
    emptyInsertThreshold: 24,
    animation: 120,
    ghostClass: 'drag-ghost',
    chosenClass: 'drag-chosen',
    fallbackClass: 'drag-floating',
    onStart: () => {
      dragging++;
      opts.root.classList.add('is-dragging');
    },
    onEnd: (evt) => {
      dragging = Math.max(0, dragging - 1);
      dropAt = Date.now();
      opts.root.classList.remove('is-dragging');
      const itemId = evt.item.dataset.itemId;
      if (!itemId || (evt.from === evt.to && evt.oldIndex === evt.newIndex)) opts.onSettled();
      else opts.onDrop(itemId, evt.to, neighbour(evt.item, opts.draggable));
    },
  });
}

/** The item a dropped element now sits before (or, at the end of its list, after). */
export function neighbour(item: HTMLElement, selector: string): DropTarget | undefined {
  const sibling = (dir: 'nextElementSibling' | 'previousElementSibling') => {
    let el = item[dir];
    while (el && !(el instanceof HTMLElement && el.matches(selector) && el.dataset.itemId)) el = el[dir];
    return el instanceof HTMLElement ? el.dataset.itemId : undefined;
  };
  const next = sibling('nextElementSibling');
  if (next) return { targetId: next, place: 'before' };
  const previous = sibling('previousElementSibling');
  return previous ? { targetId: previous, place: 'after' } : undefined;
}
