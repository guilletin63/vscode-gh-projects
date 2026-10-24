// Raw GraphQL -> model mapping. Pure functions; each one is covered by a fixture test.
import type {
  FieldKind,
  FieldValue,
  ItemDetail,
  ItemType,
  Iteration,
  OptionColor,
  Owner,
  OwnerKind,
  Page,
  ProjectDetails,
  ProjectField,
  ProjectItem,
  ProjectSummary,
  ProjectView,
  SelectOption,
  ViewLayout,
  ViewSort,
} from '../model/types';
import type {
  RawConnection,
  RawField,
  RawFieldValue,
  RawItem,
  RawItemDetailResponse,
  RawItemsResponse,
  RawIteration,
  RawProjectDetailsResponse,
  RawSelectOption,
  RawOwner,
  RawOwnerLookupResponse,
  RawProject,
  RawProjectsResponse,
  RawView,
  RawViewerResponse,
  RawViewsResponse,
} from './raw';

export function compact<T>(nodes: (T | null)[] | null | undefined): T[] {
  return (nodes ?? []).filter((n): n is T => n !== null && n !== undefined);
}

export function mapPage<R, T>(conn: RawConnection<R> | null | undefined, map: (raw: R) => T): Page<T> {
  if (!conn) return { nodes: [], endCursor: null, hasNextPage: false };
  return {
    nodes: compact(conn.nodes).map(map),
    endCursor: conn.pageInfo.endCursor,
    hasNextPage: conn.pageInfo.hasNextPage,
  };
}

function mapOwner(raw: RawOwner, kind: OwnerKind, isViewer: boolean): Owner {
  return {
    login: raw.login,
    kind,
    ...(raw.name ? { name: raw.name } : {}),
    ...(raw.avatarUrl ? { avatarUrl: raw.avatarUrl } : {}),
    isViewer,
  };
}

export function mapViewer(raw: RawViewerResponse): { viewer: Owner; organizations: Page<Owner> } {
  return {
    viewer: mapOwner(raw.viewer, 'User', true),
    organizations: mapPage(raw.viewer.organizations, (o) => mapOwner(o, 'Organization', false)),
  };
}

export function mapOwnerLookup(raw: RawOwnerLookupResponse): Owner | undefined {
  const o = raw.repositoryOwner;
  if (!o) return undefined;
  return { ...mapOwner(o, o.__typename === 'Organization' ? 'Organization' : 'User', false), isManual: true };
}

export function mapProject(raw: RawProject, ownerLogin: string): ProjectSummary {
  return {
    id: raw.id,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    closed: raw.closed,
    ownerLogin,
    ...(raw.shortDescription ? { shortDescription: raw.shortDescription } : {}),
    itemCount: raw.items.totalCount,
    updatedAt: raw.updatedAt,
  };
}

export function mapProjects(raw: RawProjectsResponse): Page<ProjectSummary> {
  const owner = raw.repositoryOwner;
  if (!owner) return { nodes: [], endCursor: null, hasNextPage: false };
  return mapPage(owner.projectsV2, (p) => mapProject(p, owner.login));
}

const LAYOUTS: Record<RawView['layout'], ViewLayout> = {
  BOARD_LAYOUT: 'board',
  TABLE_LAYOUT: 'table',
  ROADMAP_LAYOUT: 'roadmap',
};

export function mapView(raw: RawView): ProjectView {
  const columnField = compact(raw.verticalGroupByFields?.nodes).find((f) => f.id);
  const groupField = compact(raw.groupByFields?.nodes).find((f) => f.id);
  const visibleFieldIds = compact(raw.fields?.nodes).flatMap((f) => (f.id ? [f.id] : []));
  const sortBy: ViewSort[] = compact(raw.sortByFields?.nodes).flatMap((s) =>
    s.field?.id ? [{ fieldId: s.field.id, direction: s.direction === 'DESC' ? 'desc' : 'asc' }] : [],
  );
  return {
    id: raw.id,
    number: raw.number,
    name: raw.name,
    layout: LAYOUTS[raw.layout] ?? 'table',
    filter: raw.filter ?? '',
    ...(columnField?.id ? { columnFieldId: columnField.id } : {}),
    ...(visibleFieldIds.length ? { visibleFieldIds } : {}),
    ...(sortBy.length ? { sortBy } : {}),
    ...(groupField?.id ? { groupByFieldId: groupField.id } : {}),
  };
}

export function mapViews(raw: RawViewsResponse): Page<ProjectView> {
  return mapPage(raw.node?.views, mapView);
}

// ---- Board ---------------------------------------------------------------------------------

const OPTION_COLORS = new Set<OptionColor>(['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE']);

function mapOption(raw: RawSelectOption): SelectOption {
  const color = OPTION_COLORS.has(raw.color as OptionColor) ? (raw.color as OptionColor) : 'GRAY';
  return { id: raw.id, name: raw.name, color, ...(raw.description ? { description: raw.description } : {}) };
}

function mapIteration(raw: RawIteration, completed: boolean): Iteration {
  return { id: raw.id, title: raw.title, startDate: raw.startDate, duration: raw.duration, completed };
}

const FIELD_KINDS: Record<string, FieldKind> = {
  SINGLE_SELECT: 'singleSelect',
  ITERATION: 'iteration',
  TEXT: 'text',
  NUMBER: 'number',
  DATE: 'date',
};

export function mapField(raw: RawField): ProjectField {
  const kind = FIELD_KINDS[raw.dataType] ?? 'builtin';
  const field: ProjectField = { id: raw.id, name: raw.name, dataType: raw.dataType, kind };
  if (kind === 'singleSelect') field.options = (raw.options ?? []).map(mapOption);
  if (kind === 'iteration') {
    const cfg = raw.configuration;
    // Completed first, then current/upcoming, ordered by start date like GitHub's picker.
    field.iterations = [
      ...(cfg?.completedIterations ?? []).map((i) => mapIteration(i, true)),
      ...(cfg?.iterations ?? []).map((i) => mapIteration(i, false)),
    ].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
  return field;
}

export function mapProjectDetails(raw: RawProjectDetailsResponse): ProjectDetails | undefined {
  const p = raw.node;
  if (!p) return undefined;
  return {
    id: p.id,
    number: p.number,
    title: p.title,
    url: p.url,
    ownerLogin: p.owner?.login ?? '',
    ...(p.shortDescription ? { shortDescription: p.shortDescription } : {}),
    fields: compact(p.fields.nodes).filter((f) => f.id).map(mapField),
    views: compact(p.views.nodes).map(mapView),
  };
}

const ITEM_TYPES: Record<RawItem['type'], ItemType> = {
  ISSUE: 'Issue',
  PULL_REQUEST: 'PullRequest',
  DRAFT_ISSUE: 'DraftIssue',
  REDACTED: 'Redacted',
};

export function mapFieldValue(raw: RawFieldValue): FieldValue | undefined {
  const fieldId = raw.field?.id;
  if (!fieldId) return undefined;
  switch (raw.__typename) {
    case 'ProjectV2ItemFieldSingleSelectValue':
      return raw.optionId ? { kind: 'singleSelect', fieldId, optionId: raw.optionId, name: raw.name ?? '' } : undefined;
    case 'ProjectV2ItemFieldTextValue':
      return typeof raw.text === 'string' ? { kind: 'text', fieldId, text: raw.text } : undefined;
    case 'ProjectV2ItemFieldNumberValue':
      return typeof raw.number === 'number' ? { kind: 'number', fieldId, number: raw.number } : undefined;
    case 'ProjectV2ItemFieldDateValue':
      return raw.date ? { kind: 'date', fieldId, date: raw.date } : undefined;
    case 'ProjectV2ItemFieldIterationValue':
      return raw.iterationId
        ? {
            kind: 'iteration',
            fieldId,
            iterationId: raw.iterationId,
            title: raw.title ?? '',
            startDate: raw.startDate ?? '',
            duration: raw.duration ?? 0,
          }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Maps one item. `customFieldIds` restricts values to the project's custom fields, so the
 * built-in Title (a text value) does not show up as a custom field.
 */
export function mapItem(raw: RawItem, customFieldIds?: ReadonlySet<string>): ProjectItem {
  const c = raw.content;
  const type = ITEM_TYPES[raw.type] ?? 'Redacted';
  const fieldValues: Record<string, FieldValue> = {};
  for (const rv of compact(raw.fieldValues.nodes)) {
    const v = mapFieldValue(rv);
    if (v && (!customFieldIds || customFieldIds.has(v.fieldId))) fieldValues[v.fieldId] = v;
  }
  const state = c?.state === 'OPEN' || c?.state === 'CLOSED' || c?.state === 'MERGED' ? c.state : undefined;
  return {
    id: raw.id,
    type,
    ...(c?.id ? { contentId: c.id } : {}),
    ...(typeof c?.number === 'number' ? { number: c.number } : {}),
    title: c?.title ?? (type === 'Redacted' ? 'Item you do not have access to' : '(untitled)'),
    ...(c?.url ? { url: c.url } : {}),
    ...(state ? { state } : {}),
    ...(c?.stateReason ? { stateReason: c.stateReason } : {}),
    ...(type === 'PullRequest' ? { isDraftPullRequest: c?.isDraft ?? false } : {}),
    ...(c?.repository ? { repository: c.repository.nameWithOwner } : {}),
    ...(c?.milestone ? { milestone: c.milestone.title } : {}),
    ...(c?.parent ? { parent: { number: c.parent.number, title: c.parent.title, ...(c.parent.url ? { url: c.parent.url } : {}) } } : {}),
    ...(c?.subIssuesSummary && c.subIssuesSummary.total > 0
      ? { subIssues: { total: c.subIssuesSummary.total, completed: c.subIssuesSummary.completed } }
      : {}),
    ...(compact(c?.closedByPullRequestsReferences?.nodes).length
      ? { linkedPullRequests: compact(c?.closedByPullRequestsReferences?.nodes).map((pr) => ({ number: pr.number, url: pr.url })) }
      : {}),
    labels: compact(c?.labels?.nodes).map((l) => ({ name: l.name, color: l.color })),
    assignees: compact(c?.assignees?.nodes).map((u) => ({
      login: u.login,
      ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
    })),
    fieldValues,
    ...(c?.createdAt ? { createdAt: c.createdAt } : {}),
    ...(c?.closedAt ? { closedAt: c.closedAt } : {}),
    updatedAt: raw.updatedAt,
  };
}

export function mapItems(raw: RawItemsResponse, customFieldIds?: ReadonlySet<string>): Page<ProjectItem> & { totalCount: number } {
  const conn = raw.node?.items;
  const page = mapPage(
    conn ? { ...conn, nodes: compact(conn.nodes).filter((i) => !i.isArchived) } : undefined,
    (i) => mapItem(i, customFieldIds),
  );
  return { ...page, totalCount: conn?.totalCount ?? page.nodes.length };
}

export function mapItemDetail(raw: RawItemDetailResponse): ItemDetail | undefined {
  const node = raw.node;
  if (!node) return undefined;
  const c = node.content;
  const author = c?.author ?? c?.creator;
  return {
    itemId: node.id,
    bodyHTML: c?.bodyHTML ?? '',
    ...(author ? { author: { login: author.login, ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}) } } : {}),
    ...(c?.createdAt ? { createdAt: c.createdAt } : {}),
    ...(c?.comments ? { comments: c.comments.totalCount } : {}),
    ...(c?.milestone ? { milestone: c.milestone.title } : {}),
    ...(c?.headRefName ? { headRef: c.headRefName } : {}),
    ...(c?.baseRefName ? { baseRef: c.baseRefName } : {}),
  };
}
