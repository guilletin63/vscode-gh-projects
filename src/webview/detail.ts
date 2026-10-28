// Item detail drawer: body, metadata, editable project fields and actions.
import type { FieldInput } from '../model/edits';
import type { ItemDetail, ProjectField, ProjectItem } from '../model/types';
import { h } from './dom';
import { fieldControl } from './fieldControl';
import { sanitizeHtml } from './sanitize';

export interface DetailProps {
  item: ProjectItem;
  fields: ProjectField[];
  detail?: ItemDetail;
  error?: string;
  prExtension: boolean;
  onClose(): void;
  onEdit(field: ProjectField, input: FieldInput): void;
  onOpenExternal(url: string): void;
  onCopyLink(url: string): void;
  onOpenInPrExtension(): void;
  /** "Edit" menus for labels and assignees; null when the item can't take them. */
  labelMenu: HTMLElement | null;
  assigneeMenu: HTMLElement | null;
}

function stateBadge(item: ProjectItem): HTMLElement | null {
  if (item.type === 'DraftIssue') return h('span', { class: 'badge state-draft' }, 'Draft');
  if (!item.state) return null;
  let text: string = item.state.toLowerCase();
  let cls = item.state === 'OPEN' ? 'state-open' : item.state === 'MERGED' ? 'state-merged' : 'state-closed';
  if (item.type === 'PullRequest' && item.isDraftPullRequest && item.state === 'OPEN') {
    text = 'draft';
    cls = 'state-draft';
  }
  if (item.type === 'Issue' && item.state === 'CLOSED') {
    cls = item.stateReason === 'NOT_PLANNED' ? 'state-draft' : 'state-merged';
    if (item.stateReason === 'NOT_PLANNED') text = 'closed as not planned';
  }
  return h('span', { class: `badge ${cls}` }, text);
}

function fieldEditor(field: ProjectField, item: ProjectItem, onEdit: DetailProps['onEdit']): HTMLElement {
  const id = `field-${field.id}`;
  const label = h('label', { for: id }, field.name);
  return h('div', { class: 'detail-field' }, label, fieldControl(field, item, onEdit, { id }));
}

export function detailPanel(props: DetailProps): HTMLElement {
  const { item, detail } = props;
  const close = h('button', { type: 'button', class: 'icon-button', title: 'Close', 'aria-label': 'Close details' }, '×');
  close.addEventListener('click', props.onClose);

  const actions = h('div', { class: 'detail-actions' });
  if (item.url) {
    const url = item.url;
    const open = h('button', { type: 'button', class: 'button' }, 'Open on GitHub');
    open.addEventListener('click', () => props.onOpenExternal(url));
    const copy = h('button', { type: 'button', class: 'button secondary' }, 'Copy link');
    copy.addEventListener('click', () => props.onCopyLink(url));
    actions.append(open, copy);
    if (props.prExtension && item.number && item.repository) {
      const pr = h(
        'button',
        { type: 'button', class: 'button secondary' },
        item.type === 'PullRequest' ? 'Open in GitHub Pull Requests' : 'Open issue in GitHub Pull Requests',
      );
      pr.addEventListener('click', props.onOpenInPrExtension);
      actions.append(pr);
    }
  } else {
    actions.append(h('span', { class: 'muted' }, 'Drafts live only in the project: no link to open or copy.'));
  }

  const ref = item.repository ? `${item.repository}${item.number ? ` #${item.number}` : ''}` : item.type === 'DraftIssue' ? 'Draft issue' : '';
  const meta: (string | Node)[] = [];
  if (detail?.author) meta.push(`by ${detail.author.login}`);
  if (detail?.createdAt) meta.push(`opened ${new Date(detail.createdAt).toLocaleDateString()}`);
  if (detail?.comments !== undefined) meta.push(`${detail.comments} comment${detail.comments === 1 ? '' : 's'}`);
  if (detail?.milestone) meta.push(`milestone ${detail.milestone}`);
  if (detail?.headRef && detail.baseRef) meta.push(`${detail.headRef} → ${detail.baseRef}`);

  const body = h('div', { class: 'detail-body markdown-body' });
  if (props.error) body.append(h('p', { class: 'error-text' }, props.error));
  else if (!detail) body.append(h('p', { class: 'muted' }, 'Loading…'));
  else if (!detail.bodyHTML.trim()) body.append(h('p', { class: 'muted' }, 'No description provided.'));
  else body.append(sanitizeHtml(detail.bodyHTML));
  // Links in the body open outside the webview.
  body.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) props.onOpenExternal(href);
  });

  const labels = item.labels.length
    ? h(
        'ul',
        { class: 'labels' },
        item.labels.map((l) => {
          const chip = h('li', { class: 'label' }, h('span', { class: 'label-dot' }), l.name);
          if (/^[0-9a-f]{6}$/i.test(l.color)) chip.style.setProperty('--label-color', `#${l.color}`);
          return chip;
        }),
      )
    : h('span', { class: 'muted' }, 'None');
  const assignees = item.assignees.length
    ? h(
        'div',
        { class: 'assignees' },
        item.assignees.map((a) =>
          h('span', { class: 'assignee' }, a.avatarUrl ? h('img', { class: 'avatar', src: a.avatarUrl, alt: '' }) : null, a.login),
        ),
      )
    : h('span', { class: 'muted' }, 'No one');

  return h(
    'aside',
    { class: 'detail', role: 'dialog', 'aria-label': `Details of ${item.title}`, tabindex: -1 },
    h('header', { class: 'detail-header' }, h('span', { class: 'muted' }, ref), h('span', { class: 'spacer' }), close),
    h('h2', { class: 'detail-title' }, item.title),
    h('div', { class: 'detail-meta' }, stateBadge(item), meta.length ? h('span', { class: 'muted' }, meta.join(' · ')) : null),
    actions,
    h(
      'section',
      { class: 'detail-section', 'aria-label': 'Project fields' },
      h('h3', {}, 'Fields'),
      props.fields.length ? props.fields.map((f) => fieldEditor(f, item, props.onEdit)) : h('p', { class: 'muted' }, 'This project has no custom fields.'),
    ),
    h('section', { class: 'detail-section' }, h('div', { class: 'detail-section-head' }, h('h3', {}, 'Labels'), props.labelMenu), labels),
    h('section', { class: 'detail-section' }, h('div', { class: 'detail-section-head' }, h('h3', {}, 'Assignees'), props.assigneeMenu), assignees),
    h('section', { class: 'detail-section' }, h('h3', {}, 'Description'), body),
  );
}

