// Pieces of an item shared by board cards, table rows and roadmap bars.
import type { ProjectItem } from '../model/types';
import { h, icons } from './dom';

export function itemIcon(item: ProjectItem): SVGElement {
  switch (item.type) {
    case 'PullRequest': {
      const i = icons.pr();
      i.classList.add(item.state === 'MERGED' ? 'state-merged' : item.state === 'CLOSED' ? 'state-closed' : item.isDraftPullRequest ? 'state-draft' : 'state-open');
      return i;
    }
    case 'Issue': {
      const closed = item.state === 'CLOSED';
      const notPlanned = closed && item.stateReason === 'NOT_PLANNED';
      const i = notPlanned ? icons.issueNotPlanned() : closed ? icons.issueClosed() : icons.issueOpen();
      i.classList.add(notPlanned ? 'state-draft' : closed ? 'state-merged' : 'state-open');
      return i;
    }
    default: {
      const i = icons.draft();
      i.classList.add('state-draft');
      return i;
    }
  }
}

export function itemKindLabel(item: ProjectItem): string {
  if (item.type === 'DraftIssue') return 'Draft';
  if (item.type === 'Redacted') return 'Private item';
  const kind = item.type === 'PullRequest' ? (item.isDraftPullRequest ? 'Draft pull request' : 'Pull request') : 'Issue';
  return `${kind}${item.state ? `, ${item.state.toLowerCase()}` : ''}`;
}

/** Item icon with an accessible name. */
export function labelledIcon(item: ProjectItem): SVGElement {
  const icon = itemIcon(item);
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', itemKindLabel(item));
  return icon;
}

/** "repo #12", "Draft" or ''. */
export function itemRef(item: ProjectItem): string {
  if (item.repository) return `${item.repository.split('/')[1] ?? item.repository}${item.number ? ` #${item.number}` : ''}`;
  return item.type === 'DraftIssue' ? 'Draft' : '';
}

export function labelList(item: ProjectItem): HTMLElement | null {
  if (!item.labels.length) return null;
  return h(
    'ul',
    { class: 'labels', 'aria-label': 'Labels' },
    item.labels.map((l) => {
      const chip = h('li', { class: 'label' }, h('span', { class: 'label-dot', 'aria-hidden': 'true' }), l.name);
      if (/^[0-9a-f]{6}$/i.test(l.color)) chip.style.setProperty('--label-color', `#${l.color}`);
      return chip;
    }),
  );
}

export function assigneeList(item: ProjectItem, opts: { names?: boolean } = {}): HTMLElement | null {
  if (!item.assignees.length) return null;
  return h(
    'div',
    { class: 'assignees', 'aria-label': `Assignees: ${item.assignees.map((a) => a.login).join(', ')}` },
    item.assignees.slice(0, 4).map((a) =>
      a.avatarUrl
        ? h('img', { class: 'avatar', src: a.avatarUrl, alt: a.login, title: a.login, width: 20, height: 20 })
        : h('span', { class: 'avatar initials', title: a.login }, a.login.slice(0, 2).toUpperCase()),
    ),
    item.assignees.length > 4 ? h('span', { class: 'muted' }, `+${item.assignees.length - 4}`) : null,
    opts.names ? h('span', { class: 'assignee-names' }, item.assignees.map((a) => a.login).join(', ')) : null,
  );
}

export function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
