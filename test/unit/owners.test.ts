import { describe, expect, it } from 'vitest';
import type { GraphQLClient } from '../../src/api/client';
import { GraphQLError, HttpError } from '../../src/api/client';
import { GitHubProjectsApi } from '../../src/api/projectsApi';
import { VIEWER_ONLY_QUERY, VIEWER_QUERY } from '../../src/api/queries';

function api(handler: (query: string) => unknown) {
  const queries: string[] = [];
  const client = {
    request: async (query: string) => {
      queries.push(query);
      return handler(query);
    },
  } as unknown as GraphQLClient;
  return { api: new GitHubProjectsApi(client), queries };
}

const viewer = { login: 'me', name: 'Me', avatarUrl: null };

describe('getOwners', () => {
  it('returns the user and their organizations', async () => {
    const { api: a } = api(() => ({
      viewer: { ...viewer, organizations: { nodes: [{ login: 'acme' }], pageInfo: { endCursor: null, hasNextPage: false } } },
    }));
    expect((await a.getOwners()).map((o) => [o.login, o.kind])).toEqual([
      ['me', 'User'],
      ['acme', 'Organization'],
    ]);
  });

  it('falls back to the signed-in user when organizations need a missing scope', async () => {
    const { api: a, queries } = api((q) => {
      if (q === VIEWER_QUERY) {
        throw new GraphQLError("The 'login' field requires one of the following scopes: ['read:org']", [
          { type: 'INSUFFICIENT_SCOPES', message: 'needs read:org' },
        ]);
      }
      return { viewer };
    });
    expect(await a.getOwners()).toEqual([{ login: 'me', name: 'Me', kind: 'User', isViewer: true }]);
    expect(queries).toEqual([VIEWER_QUERY, VIEWER_ONLY_QUERY]);
  });

  it('does not hide other errors', async () => {
    const { api: a } = api(() => {
      throw new HttpError(500, 'boom');
    });
    await expect(a.getOwners()).rejects.toBeInstanceOf(HttpError);
  });
});

describe('getSharedOwners', () => {
  const project = (login: string, typename = 'User', closed = false) => ({ closed, owner: { __typename: typename, login, name: null, avatarUrl: null } });
  const page = (repos: unknown[], endCursor: string | null, hasNextPage: boolean) => ({
    viewer: { login: 'me', repositories: { nodes: repos, pageInfo: { endCursor, hasNextPage } } },
  });

  it("finds the owners of open projects in repositories you collaborate on, once each", async () => {
    const pages = [
      page([{ projectsV2: { nodes: [project('friend'), project('me')] } }, { projectsV2: { nodes: [project('Friend'), project('old', 'User', true)] } }, null], 'c1', true),
      page([{ projectsV2: { nodes: [project('acme', 'Organization')] } }, { projectsV2: null }], 'c2', false),
    ];
    const { api: a } = api(() => pages.shift());
    const owners = await a.getSharedOwners();
    expect(owners.map((o) => [o.login, o.kind, o.isShared, o.isViewer])).toEqual([
      ['friend', 'User', true, false],
      ['acme', 'Organization', true, false],
    ]);
  });

  it('returns nothing when GitHub refuses the query (e.g. no repo scope)', async () => {
    const { api: a } = api(() => {
      throw new GraphQLError('Your token has not been granted the required scopes', [{ message: 'x', type: 'INSUFFICIENT_SCOPES' }]);
    });
    expect(await a.getSharedOwners()).toEqual([]);
  });

  it('still fails on network errors', async () => {
    const { api: a } = api(() => {
      throw new HttpError(502, 'Bad gateway');
    });
    await expect(a.getSharedOwners()).rejects.toBeInstanceOf(HttpError);
  });
});
