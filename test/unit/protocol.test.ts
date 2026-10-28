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

  it('validates label and assignee messages', () => {
    expect(parseWebviewMessage({ type: 'loadChoices', itemId: 'I' })).toEqual({ type: 'loadChoices', itemId: 'I' });
    expect(parseWebviewMessage({ type: 'setLabels', requestId: 'r', itemId: 'I', names: ['bug'] })).toEqual({ type: 'setLabels', requestId: 'r', itemId: 'I', names: ['bug'] });
    expect(parseWebviewMessage({ type: 'setAssignees', requestId: 'r', itemId: 'I', logins: [] })).toEqual({ type: 'setAssignees', requestId: 'r', itemId: 'I', logins: [] });
    expect(parseWebviewMessage({ type: 'setLabels', requestId: 'r', itemId: 'I', names: [1] })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'setLabels', requestId: 'r', itemId: 'I', names: 'bug' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'setLabels', requestId: 'r', itemId: 'I', names: Array(101).fill('x') })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'setAssignees', requestId: 'r', itemId: 'I', logins: ['x'.repeat(300)] })).toBeUndefined();
  });

  it('validates position and draft messages', () => {
    expect(parseWebviewMessage({ type: 'setPosition', requestId: 'r', itemId: 'I', afterId: 'A' })).toEqual({ type: 'setPosition', requestId: 'r', itemId: 'I', afterId: 'A' });
    expect(parseWebviewMessage({ type: 'setPosition', requestId: 'r', itemId: 'I' })).toEqual({ type: 'setPosition', requestId: 'r', itemId: 'I' });
    expect(parseWebviewMessage({ type: 'setPosition', requestId: 'r', itemId: 'I', afterId: 3 })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: '  Idea  ' })).toEqual({ type: 'addDraft', requestId: 'r', title: 'Idea', values: [] });
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: '   ' })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: 'x'.repeat(300) })).toMatchObject({ title: 'x'.repeat(256) });
    const values = [
      { fieldId: 'F', input: { kind: 'singleSelect', optionId: 'o' } },
      { fieldId: 'G', input: { kind: 'number', number: 2 } },
    ];
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: 'T', values })).toEqual({ type: 'addDraft', requestId: 'r', title: 'T', values });
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: 'T', values: [{ fieldId: 'F', input: { kind: 'bogus' } }] })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: 'T', values: [{ fieldId: 'F', input: null }] })).toBeUndefined();
    expect(parseWebviewMessage({ type: 'addDraft', requestId: 'r', title: 'T', values: Array(6).fill(values[0]) })).toBeUndefined();
  });
});
