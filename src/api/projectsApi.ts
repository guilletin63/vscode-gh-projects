// High-level operations used by the views. The only place that combines queries + mappers.
import type { FieldInput } from '../model/edits';
import { toGraphQLValue } from '../model/edits';
import type { ItemDetail, Owner, ProjectDetails, ProjectItem, ProjectSummary, ProjectView } from '../model/types';
import type { GraphQLClient } from './client';
import { GraphQLError } from './client';
import { mapItemDetail, mapItems, mapOwnerLookup, mapProjectDetails, mapProjects, mapViewer, mapViews } from './mappers';
import { paginate } from './paginate';
import {
  ADD_DRAFT_ISSUE_MUTATION,
  CLEAR_FIELD_VALUE_MUTATION,
  ITEM_DETAIL_QUERY,
  OWNER_LOOKUP_QUERY,
  PROJECT_DETAILS_QUERY,
  PROJECT_ITEMS_QUERY,
  PROJECTS_QUERY,
  UPDATE_FIELD_VALUE_MUTATION,
  UPDATE_ITEM_POSITION_MUTATION,
  VIEWER_ONLY_QUERY,
  VIEWER_QUERY,
  VIEWS_QUERY,
} from './queries';
import type {
  RawItemDetailResponse,
  RawItemsResponse,
  RawOwnerLookupResponse,
  RawProjectDetailsResponse,
  RawProjectsResponse,
  RawViewerResponse,
  RawViewsResponse,
} from './raw';

export interface LoadProgress {
  loaded: number;
  total: number;
}

export interface ProjectsApi {
  /** The signed-in user followed by their organizations. */
  getOwners(): Promise<Owner[]>;
  /** Resolves a user or organization login; undefined if it does not exist. */
  lookupOwner(login: string): Promise<Owner | undefined>;
  listProjects(ownerLogin: string): Promise<ProjectSummary[]>;
  listViews(projectId: string): Promise<ProjectView[]>;
  /** Fields and views of a project. */
  getProject(projectId: string): Promise<ProjectDetails>;
  /** Every non-archived item, following cursors 100 at a time. */
  listItems(project: ProjectDetails, onProgress?: (p: LoadProgress) => void): Promise<ProjectItem[]>;
  /** Writes (or clears, with null) one field of one item. Needs the `project` scope. */
  setFieldValue(projectId: string, itemId: string, fieldId: string, input: FieldInput): Promise<void>;
  /** Moves an item right after `afterId`, or to the top without it. Needs the `project` scope. */
  setItemPosition(projectId: string, itemId: string, afterId: string | undefined): Promise<void>;
  /** Adds a draft issue and returns its project item id. Needs the `project` scope. */
  addDraftIssue(projectId: string, title: string): Promise<string>;
  /** Body and metadata of one item for the detail panel. */
  getItemDetail(itemId: string): Promise<ItemDetail>;
}

export class GitHubProjectsApi implements ProjectsApi {
  constructor(private readonly client: GraphQLClient) {}

  async getOwners(): Promise<Owner[]> {
    let viewer: Owner | undefined;
    try {
      const orgs = await paginate(async (cursor) => {
        const mapped = mapViewer(await this.client.request<RawViewerResponse>(VIEWER_QUERY, { cursor }));
        viewer = mapped.viewer;
        return mapped.organizations;
      });
      return viewer ? [viewer, ...orgs] : orgs;
    } catch (err) {
      // Organization fields need read:org; without it GitHub rejects the whole query. Still show
      // the user's own projects (and manually added owners) instead of failing the tree.
      if (!(err instanceof GraphQLError && err.types.includes('INSUFFICIENT_SCOPES'))) throw err;
      return [mapViewer(await this.client.request<RawViewerResponse>(VIEWER_ONLY_QUERY)).viewer];
    }
  }

  async lookupOwner(login: string): Promise<Owner | undefined> {
    return mapOwnerLookup(await this.client.request<RawOwnerLookupResponse>(OWNER_LOOKUP_QUERY, { login }));
  }

  listProjects(ownerLogin: string): Promise<ProjectSummary[]> {
    return paginate(async (cursor) =>
      mapProjects(await this.client.request<RawProjectsResponse>(PROJECTS_QUERY, { login: ownerLogin, cursor })),
    );
  }

  listViews(projectId: string): Promise<ProjectView[]> {
    return paginate(async (cursor) =>
      mapViews(await this.client.request<RawViewsResponse>(VIEWS_QUERY, { projectId, cursor })),
    );
  }

  async getProject(projectId: string): Promise<ProjectDetails> {
    const details = mapProjectDetails(
      await this.client.request<RawProjectDetailsResponse>(PROJECT_DETAILS_QUERY, { projectId }),
    );
    if (!details) throw new Error('Project not found or not accessible.');
    return details;
  }

  listItems(project: ProjectDetails, onProgress?: (p: LoadProgress) => void): Promise<ProjectItem[]> {
    const custom = new Set(project.fields.filter((f) => f.kind !== 'builtin').map((f) => f.id));
    let total = 0;
    return paginate(
      async (cursor) => {
        const page = mapItems(
          await this.client.request<RawItemsResponse>(PROJECT_ITEMS_QUERY, { projectId: project.id, cursor }),
          custom,
        );
        total = page.totalCount;
        return page;
      },
      (loaded) => onProgress?.({ loaded, total }),
    );
  }

  async setFieldValue(projectId: string, itemId: string, fieldId: string, input: FieldInput): Promise<void> {
    if (input === null) {
      await this.client.request(CLEAR_FIELD_VALUE_MUTATION, { projectId, itemId, fieldId }, { write: true });
    } else {
      await this.client.request(
        UPDATE_FIELD_VALUE_MUTATION,
        { projectId, itemId, fieldId, value: toGraphQLValue(input) },
        { write: true },
      );
    }
  }

  async setItemPosition(projectId: string, itemId: string, afterId: string | undefined): Promise<void> {
    await this.client.request(UPDATE_ITEM_POSITION_MUTATION, { projectId, itemId, afterId: afterId ?? null }, { write: true });
  }

  async addDraftIssue(projectId: string, title: string): Promise<string> {
    const r = await this.client.request<{ addProjectV2DraftIssue: { projectItem: { id: string } | null } | null }>(
      ADD_DRAFT_ISSUE_MUTATION,
      { projectId, title },
      { write: true },
    );
    const id = r.addProjectV2DraftIssue?.projectItem?.id;
    if (!id) throw new Error('GitHub did not return the new item.');
    return id;
  }

  async getItemDetail(itemId: string): Promise<ItemDetail> {
    const detail = mapItemDetail(await this.client.request<RawItemDetailResponse>(ITEM_DETAIL_QUERY, { itemId }));
    if (!detail) throw new Error('Item not found or not accessible.');
    return detail;
  }
}
