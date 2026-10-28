import { describe, expect, it } from 'vitest';
import type { GraphQLClient } from '../../src/api/client';
import { mapItemChoices } from '../../src/api/mappers';
import { GitHubProjectsApi } from '../../src/api/projectsApi';
import {
  ADD_ASSIGNEES_MUTATION,
  ADD_LABELS_MUTATION,
  ITEM_CHOICES_QUERY,
  REMOVE_ASSIGNEES_MUTATION,
  REMOVE_LABELS_MUTATION,
  UPDATE_DRAFT_ASSIGNEES_MUTATION,
} from '../../src/api/queries';
import type { RawItemChoicesResponse } from '../../src/api/raw';
import { MAX_ASSIGNEES, planListChange } from '../../src/model/assign';
import { fixture } from './fixtures';

const issue = () => mapItemChoices(fixture<RawItemChoicesResponse>('item-choices-issue'))!;
const draft = () => mapItemChoices(fixture<RawItemChoicesResponse>('item-choices-draft'))!;

describe('mapItemChoices', () => {
  it('offers the repository labels and assignable users of an issue, plus what it already has', () => {
    const c = issue();
    expect(c).toMatchObject({ itemId: 'PVTI_issue', contentId: 'I_issue', contentType: 'Issue', labelable: true });
    expect(c.labels.map((l) => l.name)).toEqual(['bug', 'documentation', 'milestone']);
    expect(c.labels[0]).toEqual({ id: 'LA_bug', name: 'bug', color: 'd73a4a' });
    // Someone who can no longer be assigned can still be removed.
    expect(c.assignees.map((u) => u.login)).toEqual(['former-member', 'Friend', 'octo-user']);
    expect(c.assignees.find((u) => u.login === 'former-member')).toEqual({ id: 'U_former', login: 'former-member' });
    expect(c.current).toEqual({ labels: ['LA_milestone'], assignees: ['U_former'] });
  });

  it('offers drafts the linked repositories, the viewer and no labels', () => {
    const c = draft();
    expect(c).toMatchObject({ itemId: 'PVTI_draft', contentId: 'DI_draft', contentType: 'DraftIssue', labelable: false, labels: [] });
    expect(c.assignees.map((u) => u.login)).toEqual(['build-bot', 'Friend', 'octo-user']);
    expect(c.current).toEqual({ labels: [], assignees: ['U_viewer'] });
  });

  it('returns undefined for items without content', () => {
    expect(mapItemChoices({ viewer: { id: 'U', login: 'u' }, node: null })).toBeUndefined();
    expect(mapItemChoices({ viewer: { id: 'U', login: 'u' }, node: { id: 'PVTI', content: null } })).toBeUndefined();
  });
});

describe('planListChange', () => {
  const choices = issue();
  const byName = (l: { name: string }) => l.name;

  it('lists the ids to add and to remove', () => {
    expect(planListChange(choices.labels, choices.current.labels, ['bug', 'documentation'], byName)).toEqual({
      add: ['LA_bug', 'LA_docs'],
      remove: ['LA_milestone'],
      ids: ['LA_bug', 'LA_docs'],
    });
    expect(planListChange(choices.labels, choices.current.labels, ['milestone'], byName)).toEqual({ add: [], remove: [], ids: ['LA_milestone'] });
  });

  it('rejects unknown values and too many entries', () => {
    expect(planListChange(choices.labels, [], ['nope'], byName)).toEqual({ error: 'Unknown value: nope.' });
    const many = Array.from({ length: MAX_ASSIGNEES + 1 }, (_, i) => ({ id: `U${i}`, login: `u${i}` }));
    expect(planListChange(many, [], many.map((u) => u.login), (u) => u.login, MAX_ASSIGNEES)).toEqual({
      error: `At most ${MAX_ASSIGNEES} can be chosen.`,
    });
  });

  it('matches logins without case and ignores repeats', () => {
    expect(planListChange(choices.assignees, choices.current.assignees, ['friend', 'Friend'], (u) => u.login)).toEqual({
      add: ['U_friend'],
      remove: ['U_former'],
      ids: ['U_friend'],
    });
  });
});

describe('label and assignee mutations', () => {
  function recordingApi(choices: string) {
    const calls: { query: string; vars: unknown; write: boolean | undefined }[] = [];
    const client = {
      request: async (query: string, vars: unknown, opts?: { write?: boolean }) => {
        calls.push({ query, vars, write: opts?.write });
        return query === ITEM_CHOICES_QUERY ? fixture(choices) : {};
      },
    } as unknown as GraphQLClient;
    return { api: new GitHubProjectsApi(client), calls };
  }

  it('adds and removes labels of an issue and returns the result', async () => {
    const { api, calls } = recordingApi('item-choices-issue');
    expect(await api.setLabels('PVTI_issue', ['bug'])).toEqual([{ name: 'bug', color: 'd73a4a' }]);
    expect(calls.slice(1)).toEqual([
      { query: ADD_LABELS_MUTATION, vars: { id: 'I_issue', labelIds: ['LA_bug'] }, write: true },
      { query: REMOVE_LABELS_MUTATION, vars: { id: 'I_issue', labelIds: ['LA_milestone'] }, write: true },
    ]);
    expect(calls[0]).toMatchObject({ query: ITEM_CHOICES_QUERY, vars: { itemId: 'PVTI_issue' } });
  });

  it('sends nothing when the labels do not change, and refuses labels on drafts', async () => {
    const { api, calls } = recordingApi('item-choices-issue');
    expect(await api.setLabels('PVTI_issue', ['milestone'])).toEqual([{ name: 'milestone', color: '5319e7' }]);
    expect(calls).toHaveLength(1);
    await expect(recordingApi('item-choices-draft').api.setLabels('PVTI_draft', ['bug'])).rejects.toThrow(/Drafts have no labels/);
    await expect(api.setLabels('PVTI_issue', ['nope'])).rejects.toThrow(/Unknown value: nope/);
  });

  it('assigns issues one by one and drafts all at once', async () => {
    const one = recordingApi('item-choices-issue');
    expect(await one.api.setAssignees('PVTI_issue', ['octo-user'])).toEqual([{ login: 'octo-user', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=48' }]);
    expect(one.calls.slice(1)).toEqual([
      { query: ADD_ASSIGNEES_MUTATION, vars: { id: 'I_issue', assigneeIds: ['U_viewer'] }, write: true },
      { query: REMOVE_ASSIGNEES_MUTATION, vars: { id: 'I_issue', assigneeIds: ['U_former'] }, write: true },
    ]);
    const all = recordingApi('item-choices-draft');
    expect(await all.api.setAssignees('PVTI_draft', ['Friend', 'octo-user'])).toEqual([
      { login: 'Friend' },
      { login: 'octo-user', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=48' },
    ]);
    expect(all.calls.slice(1)).toEqual([{ query: UPDATE_DRAFT_ASSIGNEES_MUTATION, vars: { id: 'DI_draft', assigneeIds: ['U_friend', 'U_viewer'] }, write: true }]);
  });
});
