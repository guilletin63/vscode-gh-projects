import { describe, expect, it } from 'vitest';
import { parseWebviewMessage } from '../../src/shared/protocol';

describe('parseWebviewMessage', () => {
  it('accepts well-formed messages', () => {
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseWebviewMessage({ type: 'selectView', viewId: 'V' })).toEqual({ type: 'selectView', viewId: 'V' });
    expect(parseWebviewMessage({ type: 'openExternal', url: 'https://github.com/o/r/issues/1' })).toBeDefined();
  });

  it('rejects malformed messages and non-http(s) URLs', () => {
    expect(parseWebviewMessage(null)).toBeUndefined();
    expect(parseWebviewMessage({ type: 'selectView' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'nope' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'openExternal', url: 'vscode://some.ext/run' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'openExternal', url: 'javascript:alert(1)' })).toBeUndefined();
  });

  it('validates position and draft messages', () => {
    expect(parseWebviewMessage({ type: 'setPosition', requestId: 'r', itemId: 'I', afterId: 'A' })).toEqual({ type: 'setPosition', requestId: 'r', itemId: 'I', afterId: 'A' });
    expect(parseWebviewMessage({ type: 'setPosition', requestId: 'r', itemId: 'I' })).toEqual({ type: 'setPosition', requestId: 'r', itemId: 'I' });
    expect(parseWebviewMessage({ type: 'setPosition', requestId: 'r', itemId: 'I', afterId: 3 })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: '  Idea  ' })).toEqual({ type: 'addDraft', requestId: 'r', title: 'Idea' });
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: '   ' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: 'x'.repeat(300) })).toMatchObject({ title: 'x'.repeat(256) });
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: 'T', fieldId: 'F', input: { kind: 'singleSelect', optionId: 'o' } })).toEqual({
      type: 'addDraft',
      requestId: 'r',
      title: 'T',
      fieldId: 'F',
      input: { kind: 'singleSelect', optionId: 'o' },
    });
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: 'T', fieldId: 'F', input: { kind: 'bogus' } })).toBeUndefined();
  });
});
