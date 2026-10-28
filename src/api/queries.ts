// GraphQL documents. Plain strings (no imports) so scripts/record-fixtures.mjs can load them.

export const VIEWER_QUERY = /* GraphQL */ `
  query Viewer($cursor: String) {
    viewer {
      login
      name
      avatarUrl
      organizations(first: 100, after: $cursor) {
        nodes { login name avatarUrl }
        pageInfo { endCursor hasNextPage }
      }
    }
  }
`;

/** Signed-in user only: used when the session can't read organizations (no read:org). */
export const VIEWER_ONLY_QUERY = /* GraphQL */ `
  query ViewerOnly {
    viewer { login name avatarUrl }
  }
`;

export const OWNER_LOOKUP_QUERY = /* GraphQL */ `
  query OwnerLookup($login: String!) {
    repositoryOwner(login: $login) {
      __typename
      login
      avatarUrl
      ... on User { name }
      ... on Organization { name }
    }
  }
`;

/**
 * Owners of the projects linked to repositories the viewer collaborates on (someone else's
 * repositories), so projects shared with the user show up without "Add owner…".
 */
export const SHARED_OWNERS_QUERY = /* GraphQL */ `
  query SharedOwners($cursor: String) {
    viewer {
      login
      repositories(first: 100, after: $cursor, affiliations: [COLLABORATOR]) {
        pageInfo { endCursor hasNextPage }
        nodes {
          projectsV2(first: 20) {
            nodes {
              closed
              owner {
                __typename
                ... on User { login name avatarUrl }
                ... on Organization { login name avatarUrl }
              }
            }
          }
        }
      }
    }
  }
`;

export const PROJECTS_QUERY = /* GraphQL */ `
  query Projects($login: String!, $cursor: String) {
    repositoryOwner(login: $login) {
      login
      ... on ProjectV2Owner {
        projectsV2(first: 100, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            id
            number
            title
            url
            closed
            shortDescription
            updatedAt
            items { totalCount }
          }
          pageInfo { endCursor hasNextPage }
        }
      }
    }
  }
`;

const VIEW_FIELDS = /* GraphQL */ `
  id
  number
  name
  layout
  filter
  verticalGroupByFields(first: 1) {
    nodes { ... on ProjectV2FieldCommon { id name } }
    pageInfo { endCursor hasNextPage }
  }
  fields(first: 50) { nodes { ... on ProjectV2FieldCommon { id } } }
  sortByFields(first: 5) { nodes { direction field { ... on ProjectV2FieldCommon { id } } } }
  groupByFields(first: 1) { nodes { ... on ProjectV2FieldCommon { id } } }
`;

export const VIEWS_QUERY = /* GraphQL */ `
  query Views($projectId: ID!, $cursor: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        views(first: 100, after: $cursor) {
          nodes {
            ${VIEW_FIELDS}
          }
          pageInfo { endCursor hasNextPage }
        }
      }
    }
  }
`;

export const PROJECT_DETAILS_QUERY = /* GraphQL */ `
  query ProjectDetails($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        id
        number
        title
        url
        shortDescription
        owner {
          ... on User { login }
          ... on Organization { login }
        }
        fields(first: 100) {
          nodes {
            __typename
            ... on ProjectV2FieldCommon { id name dataType }
            ... on ProjectV2SingleSelectField { options { id name color description } }
            ... on ProjectV2IterationField {
              configuration {
                iterations { id title startDate duration }
                completedIterations { id title startDate duration }
              }
            }
          }
          pageInfo { endCursor hasNextPage }
        }
        views(first: 100) {
          nodes {
            ${VIEW_FIELDS}
          }
          pageInfo { endCursor hasNextPage }
        }
      }
    }
  }
`;

const ITEM_CONTENT_FIELDS = /* GraphQL */ `
  labels(first: 20) { nodes { name color } pageInfo { endCursor hasNextPage } }
  assignees(first: 10) { nodes { login avatarUrl(size: 48) } pageInfo { endCursor hasNextPage } }
  milestone { title }
  createdAt
  closedAt
`;

export const PROJECT_ITEMS_QUERY = /* GraphQL */ `
  query ProjectItems($projectId: ID!, $cursor: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100, after: $cursor) {
          totalCount
          pageInfo { endCursor hasNextPage }
          nodes {
            id
            type
            isArchived
            updatedAt
            content {
              __typename
              ... on Issue {
                id number title url state stateReason
                repository { nameWithOwner }
                ${ITEM_CONTENT_FIELDS}
                parent { number title url }
                subIssuesSummary { total completed }
                closedByPullRequestsReferences(first: 5, includeClosedPrs: true) { nodes { number url } }
              }
              ... on PullRequest {
                id number title url state isDraft
                repository { nameWithOwner }
                ${ITEM_CONTENT_FIELDS}
              }
              ... on DraftIssue {
                id title createdAt
                assignees(first: 10) { nodes { login avatarUrl(size: 48) } pageInfo { endCursor hasNextPage } }
              }
            }
            fieldValues(first: 50) {
              pageInfo { endCursor hasNextPage }
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue { optionId name field { ... on ProjectV2FieldCommon { id } } }
                ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id } } }
                ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id } } }
                ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id } } }
                ... on ProjectV2ItemFieldIterationValue {
                  iterationId title startDate duration
                  field { ... on ProjectV2FieldCommon { id } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** Ids of the items matching a view filter; GitHub parses the filter syntax itself. */
export const PROJECT_ITEM_IDS_QUERY = /* GraphQL */ `
  query ProjectItemIds($projectId: ID!, $cursor: String, $query: String!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100, after: $cursor, query: $query) {
          pageInfo { endCursor hasNextPage }
          nodes { id }
        }
      }
    }
  }
`;

export const UPDATE_FIELD_VALUE_MUTATION = /* GraphQL */ `
  mutation UpdateFieldValue($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
      projectV2Item { id }
    }
  }
`;

export const CLEAR_FIELD_VALUE_MUTATION = /* GraphQL */ `
  mutation ClearFieldValue($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
    clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) {
      projectV2Item { id }
    }
  }
`;

export const UPDATE_ITEM_POSITION_MUTATION = /* GraphQL */ `
  mutation UpdateItemPosition($projectId: ID!, $itemId: ID!, $afterId: ID) {
    updateProjectV2ItemPosition(input: { projectId: $projectId, itemId: $itemId, afterId: $afterId }) {
      items(first: 1) { totalCount }
    }
  }
`;

export const ADD_DRAFT_ISSUE_MUTATION = /* GraphQL */ `
  mutation AddDraftIssue($projectId: ID!, $title: String!) {
    addProjectV2DraftIssue(input: { projectId: $projectId, title: $title }) {
      projectItem { id }
    }
  }
`;

const PERSON = 'id login avatarUrl(size: 48)';
const LABELABLE_CHOICES = `
  id
  assignees(first: 20) { nodes { ${PERSON} } }
  labels(first: 100) { nodes { id name color } }
  repository {
    assignableUsers(first: 100) { nodes { ${PERSON} } }
    labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { id name color } }
  }
`;

/** Labels and people an item can take; drafts offer the users of the project's linked repositories. */
export const ITEM_CHOICES_QUERY = /* GraphQL */ `
  query ItemChoices($itemId: ID!) {
    viewer { ${PERSON} }
    node(id: $itemId) {
      ... on ProjectV2Item {
        id
        project { repositories(first: 10) { nodes { assignableUsers(first: 100) { nodes { ${PERSON} } } } } }
        content {
          __typename
          ... on Issue { ${LABELABLE_CHOICES} }
          ... on PullRequest { ${LABELABLE_CHOICES} }
          ... on DraftIssue { id assignees(first: 20) { nodes { ${PERSON} } } }
        }
      }
    }
  }
`;

export const ADD_LABELS_MUTATION = /* GraphQL */ `
  mutation AddLabels($id: ID!, $labelIds: [ID!]!) {
    addLabelsToLabelable(input: { labelableId: $id, labelIds: $labelIds }) { clientMutationId }
  }
`;

export const REMOVE_LABELS_MUTATION = /* GraphQL */ `
  mutation RemoveLabels($id: ID!, $labelIds: [ID!]!) {
    removeLabelsFromLabelable(input: { labelableId: $id, labelIds: $labelIds }) { clientMutationId }
  }
`;

export const ADD_ASSIGNEES_MUTATION = /* GraphQL */ `
  mutation AddAssignees($id: ID!, $assigneeIds: [ID!]!) {
    addAssigneesToAssignable(input: { assignableId: $id, assigneeIds: $assigneeIds }) { clientMutationId }
  }
`;

export const REMOVE_ASSIGNEES_MUTATION = /* GraphQL */ `
  mutation RemoveAssignees($id: ID!, $assigneeIds: [ID!]!) {
    removeAssigneesFromAssignable(input: { assignableId: $id, assigneeIds: $assigneeIds }) { clientMutationId }
  }
`;

/** Drafts replace their whole assignee list. */
export const UPDATE_DRAFT_ASSIGNEES_MUTATION = /* GraphQL */ `
  mutation UpdateDraftAssignees($id: ID!, $assigneeIds: [ID!]!) {
    updateProjectV2DraftIssue(input: { draftIssueId: $id, assigneeIds: $assigneeIds }) { draftIssue { id } }
  }
`;

export const ITEM_DETAIL_QUERY = /* GraphQL */ `
  query ItemDetail($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        id
        content {
          __typename
          ... on Issue {
            bodyHTML
            createdAt
            author { login avatarUrl(size: 48) }
            comments { totalCount }
            milestone { title }
          }
          ... on PullRequest {
            bodyHTML
            createdAt
            author { login avatarUrl(size: 48) }
            comments { totalCount }
            milestone { title }
            headRefName
            baseRefName
          }
          ... on DraftIssue {
            bodyHTML
            createdAt
            creator { login avatarUrl(size: 48) }
          }
        }
      }
    }
  }
`;
