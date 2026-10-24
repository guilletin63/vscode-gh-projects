// Shapes of the raw GraphQL responses we request (only the fields we select).

export interface RawPageInfo {
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface RawConnection<T> {
  nodes: (T | null)[] | null;
  pageInfo: RawPageInfo;
  totalCount?: number;
}

export interface RawOwner {
  __typename?: string;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface RawViewerResponse {
  viewer: RawOwner & { organizations?: RawConnection<RawOwner> | null };
}

export interface RawSharedOwnersResponse {
  viewer: {
    login: string;
    repositories: {
      pageInfo: RawPageInfo;
      nodes: ({ projectsV2?: { nodes: ({ closed: boolean; owner: (RawOwner & { __typename: string }) | null } | null)[] | null } | null } | null)[] | null;
    };
  };
}

export interface RawOwnerLookupResponse {
  repositoryOwner: (RawOwner & { __typename: string }) | null;
}

export interface RawProject {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  shortDescription?: string | null;
  updatedAt: string;
  items: { totalCount: number };
}

export interface RawProjectsResponse {
  repositoryOwner: { login: string; projectsV2?: RawConnection<RawProject> } | null;
}

export interface RawFieldRef {
  id?: string;
  name?: string;
}

export interface RawView {
  id: string;
  number: number;
  name: string;
  layout: 'BOARD_LAYOUT' | 'TABLE_LAYOUT' | 'ROADMAP_LAYOUT';
  filter: string | null;
  verticalGroupByFields?: RawConnection<RawFieldRef> | null;
  fields?: { nodes: (RawFieldRef | null)[] | null } | null;
  sortByFields?: { nodes: ({ direction: string; field: RawFieldRef | null } | null)[] | null } | null;
  groupByFields?: { nodes: (RawFieldRef | null)[] | null } | null;
}

export interface RawViewsResponse {
  node: { views?: RawConnection<RawView> } | null;
}

export interface RawSelectOption {
  id: string;
  name: string;
  color: string;
  description?: string | null;
}

export interface RawIteration {
  id: string;
  title: string;
  startDate: string;
  duration: number;
}

export interface RawField {
  __typename: 'ProjectV2Field' | 'ProjectV2SingleSelectField' | 'ProjectV2IterationField' | string;
  id: string;
  name: string;
  dataType: string;
  options?: RawSelectOption[];
  configuration?: { iterations: RawIteration[]; completedIterations: RawIteration[] } | null;
}

export interface RawProjectDetailsResponse {
  node:
    | (Omit<RawProject, 'items' | 'closed' | 'updatedAt'> & {
        owner: { login?: string } | null;
        fields: RawConnection<RawField>;
        views: RawConnection<RawView>;
      })
    | null;
}

export interface RawLabel {
  name: string;
  color: string;
}

export interface RawUser {
  login: string;
  avatarUrl?: string | null;
}

export interface RawContent {
  __typename: 'Issue' | 'PullRequest' | 'DraftIssue' | string;
  id?: string;
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  stateReason?: string | null;
  isDraft?: boolean;
  repository?: { nameWithOwner: string } | null;
  labels?: RawConnection<RawLabel> | null;
  assignees?: RawConnection<RawUser> | null;
  milestone?: { title: string } | null;
  createdAt?: string | null;
  closedAt?: string | null;
  parent?: { number: number; title: string; url?: string | null } | null;
  subIssuesSummary?: { total: number; completed: number } | null;
  closedByPullRequestsReferences?: { nodes: ({ number: number; url: string } | null)[] | null } | null;
}

export interface RawFieldValue {
  __typename: string;
  field?: { id?: string } | null;
  optionId?: string | null;
  name?: string | null;
  text?: string | null;
  number?: number | null;
  date?: string | null;
  iterationId?: string | null;
  title?: string | null;
  startDate?: string | null;
  duration?: number | null;
}

export interface RawItem {
  id: string;
  type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE' | 'REDACTED';
  isArchived: boolean;
  updatedAt: string;
  content: RawContent | null;
  fieldValues: RawConnection<RawFieldValue>;
}

export interface RawItemsResponse {
  node: { items?: RawConnection<RawItem> } | null;
}

export interface RawItemDetailResponse {
  node: {
    id: string;
    content:
      | (RawContent & {
          bodyHTML?: string | null;
          author?: RawUser | null;
          creator?: RawUser | null;
          createdAt?: string | null;
          comments?: { totalCount: number } | null;
          milestone?: { title: string } | null;
          headRefName?: string | null;
          baseRefName?: string | null;
        })
      | null;
  } | null;
}
