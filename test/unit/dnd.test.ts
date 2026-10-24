// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { DRAG_TYPE, makeDraggable } from '../../src/webview/dnd';

describe('makeDraggable', () => {
  it('sets the item id and leaves the DOM alone during dragstart', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const card = document.createElement('div');
    root.append(card);
    makeDraggable(card, 'PVTI_1', root);
    const setData = vi.fn();
    const event = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { setData, effectAllowed: 'all' } });
    card.dispatchEvent(event);
    expect(card.getAttribute('draggable')).toBe('true');
    expect(setData).toHaveBeenCalledWith(DRAG_TYPE, 'PVTI_1');
    // Styling the drag inside 'dragstart' makes Chromium cancel it at once.
    expect(card.className).toBe('');
    expect(root.className).toBe('');
    vi.runAllTimers();
    expect(card.classList.contains('dragging')).toBe(true);
    expect(root.classList.contains('is-dragging')).toBe(true);
    card.dispatchEvent(new Event('dragend'));
    vi.runAllTimers();
    expect(card.className).toBe('');
    expect(root.className).toBe('');
    vi.useRealTimers();
  });
});
