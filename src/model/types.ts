// Pure, JSON-serialisable domain types. No vscode or GraphQL imports here: these objects cross
// the postMessage boundary unchanged.

export type OwnerKind = 'User' | 'Organization';

export interface Owner {
  login: string;
  kind: OwnerKind;
  name?: string;
  avatarUrl?: string;
  /** The signed-in user. */
  isViewer: boolean;
  /** Added by hand with "Add owner…" (e.g. an org not visible through the token). */
  isManual?: boolean;
  /** Owns a project linked to a repository the user collaborates on (found automatically). */
  isShared?: boolean;
}

export interface ProjectSummary {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  ownerLogin: string;
  shortDescription?: string;
  itemCount: number;
  updatedAt: string;
}

export type ViewLayout = 'board' | 'table' | 'roadmap';

export interface ProjectView {
  id: string;
  number: number;
  name: string;
  layout: ViewLayout;
  /** Raw filter string as typed on github.com (informational). */
  filter: string;
  /** Field the board view uses as "Column by" (verticalGroupByFields), if exposed. */
  columnFieldId?: string;
  /** Fields shown in the view, in the view's order (table columns). */
  visibleFieldIds?: string[];
  /** The view's sort, most significant first. */
  sortBy?: ViewSort[];
  /** Field the table or roadmap view is grouped by, if any. */
  groupByFieldId?: string;
}

export interface ViewSort {
  fieldId: string;
  direction: 'asc' | 'desc';
}

/** A page of a cursor-paginated connection, already mapped. */
export interface Page<T> {
  nodes: T[];
  endCursor: string | null;
  hasNextPage: boolean;
}

// ---- Board ---------------------------------------------------------------------------------

/** GitHub's single-select option palette. */
export type OptionColor = 'GRAY' | 'BLUE' | 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'PINK' | 'PURPLE';

export interface SelectOption {
  id: string;
  name: string;
  color: OptionColor;
  description?: string;
}

export interface Iteration {
  id: string;
  title: string;
  startDate: string;
  duration: number;
  completed: boolean;
}

/** Field kinds we can show and edit; everything else is GitHub built-in metadata. */
export type FieldKind = 'singleSelect' | 'iteration' | 'text' | 'number' | 'date' | 'builtin';

export interface ProjectField {
  id: string;
  name: string;
  /** GitHub's ProjectV2FieldType, e.g. SINGLE_SELECT, TITLE, ASSIGNEES. */
  dataType: string;
  kind: FieldKind;
  options?: SelectOption[];
  iterations?: Iteration[];
}

export type FieldValue =
  | { kind: 'singleSelect'; fieldId: string; optionId: string; name: string }
  | { kind: 'text'; fieldId: string; text: string }
  | { kind: 'number'; fieldId: string; number: number }
  | { kind: 'date'; fieldId: string; date: string }
  | { kind: 'iteration'; fieldId: string; iterationId: string; title: string; startDate: string; duration: number };

export type ItemType = 'Issue' | 'PullRequest' | 'DraftIssue' | 'Redacted';

export type ItemState = 'OPEN' | 'CLOSED' | 'MERGED';

export interface Label {
  name: string;
  /** Hex without '#', as GitHub returns it. */
  color: string;
}

export interface User {
  login: string;
  avatarUrl?: string;
}

export interface ProjectItem {
  /** ProjectV2Item id (PVTI_…), used for mutations. */
  id: string;
  type: ItemType;
  /** Issue / PR / DraftIssue node id. */
  contentId?: string;
  number?: number;
  title: string;
  url?: string;
  state?: ItemState;
  /** Issue closed as "not planned" etc. */
  stateReason?: string;
  isDraftPullRequest?: boolean;
  /** owner/name */
  repository?: string;
  milestone?: string;
  /** Parent issue (issues only). */
  parent?: { number: number; title: string; url?: string };
  /** Sub-issues progress (issues with sub-issues only). */
  subIssues?: { total: number; completed: number };
  /** Pull requests that close the issue. */
  linkedPullRequests?: { number: number; url: string }[];
  labels: Label[];
  assignees: User[];
  /** Custom field values keyed by field id. */
  fieldValues: Record<string, FieldValue>;
  createdAt?: string;
  closedAt?: string;
  updatedAt: string;
}

export interface ProjectDetails {
  id: string;
  number: number;
  title: string;
  url: string;
  ownerLogin: string;
  shortDescription?: string;
  fields: ProjectField[];
  views: ProjectView[];
}

/** Extra data shown in the detail panel, fetched on demand. */
export interface ItemDetail {
  itemId: string;
  /** GitHub's server-rendered, sanitised HTML of the body. */
  bodyHTML: string;
  author?: User;
  createdAt?: string;
  comments?: number;
  milestone?: string;
  /** Pull requests only. */
  headRef?: string;
  baseRef?: string;
}
