// Drag & drop helpers shared by board cards and table rows. Items travel as their id under a
// private MIME type so drops from elsewhere (files, text) are ignored.

export const DRAG_TYPE = 'application/x-ghp-item';

export type Place = 'before' | 'after';

/** Whether an item from this panel is being dragged. */
export function isItemDrag(e: DragEvent): boolean {
  return !!e.dataTransfer?.types.includes(DRAG_TYPE);
}

/** Top or bottom half of `el`, and marks it so the drop position is visible. */
export function markDropPlace(e: DragEvent, el: HTMLElement): Place {
  const r = el.getBoundingClientRect();
  const place: Place = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  el.classList.toggle('drop-before', place === 'before');
  el.classList.toggle('drop-after', place === 'after');
  return place;
}

export function clearDropMarks(root: ParentNode): void {
  root.querySelectorAll('.drop-before, .drop-after, .drop-target').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-target'));
}

/**
 * Makes `el` draggable as item `itemId`. `root` gets `is-dragging` meanwhile (re-renders are
 * avoided during a drag: they would destroy the element being dragged).
 */
export function makeDraggable(el: HTMLElement, itemId: string, root: HTMLElement): void {
  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', (e) => {
    if ((e.target as Element | null)?.closest('input, select, textarea')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer?.setData(DRAG_TYPE, itemId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    // Changing styles during 'dragstart' makes Chromium cancel the drag right away (dragend
    // follows at once), so the dragging look is applied on the next tick.
    setTimeout(() => {
      el.classList.add('dragging');
      root.classList.add('is-dragging');
    }, 0);
  });
  el.addEventListener('dragend', () => {
    // After the deferred 'dragging' classes, even for a drag that ends at once.
    setTimeout(() => clearDragging(el, root), 0);
  });
}

function clearDragging(el: HTMLElement, root: HTMLElement): void {
  {
    el.classList.remove('dragging');
    root.classList.remove('is-dragging');
    clearDropMarks(root);
  }
}

/** The item element (card or row) under a drop, if any. */
export function itemUnder(e: DragEvent): HTMLElement | null {
  return (e.target as Element | null)?.closest<HTMLElement>('[data-item-id][draggable="true"]') ?? null;
}
