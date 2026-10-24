// Records GraphQL fixtures for the mapper tests from real, READ-ONLY queries and anonymises them:
// logins, people's names, avatars, project titles, repository names, item titles/bodies, text
// values, custom field names, their option names and non-generic label names.
//
//   GHP_FIXTURE_OWNER=<login> GHP_FIXTURE_PROJECT=<number> [GHP_SANDBOX_PROJECT=<number>] \
//     node scripts/record-fixtures.mjs [name ...]          (Node >= 23.6 imports the .ts queries)
//
// GHP_FIXTURE_PROJECT should have more than 100 items so both item pages are meaningful.
// Fields that only exist in the sandbox (iteration, number, date, text) are recorded from it.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import * as q from '../src/api/queries.ts';

const OWNER = required('GHP_FIXTURE_OWNER');
const PROJECT_NUMBER = Number(required('GHP_FIXTURE_PROJECT'));
const SANDBOX_NUMBER = process.env.GHP_SANDBOX_PROJECT ? Number(process.env.GHP_SANDBOX_PROJECT) : undefined;
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`set ${name}`);
  return v;
}

async function gql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body;
}

async function projectId(number) {
  const r = await gql(`query($l:String!,$n:Int!){user(login:$l){projectV2(number:$n){id}}}`, { l: OWNER, n: number });
  return r.data.user.projectV2.id;
}

function sandbox() {
  if (!SANDBOX_NUMBER) throw new Error('set GHP_SANDBOX_PROJECT to the sandbox project number');
  return SANDBOX_NUMBER;
}

const fixtures = {
  viewer: async () => gql(q.VIEWER_QUERY, { cursor: null }),
  projects: async () => gql(q.PROJECTS_QUERY, { login: OWNER, cursor: null }),
  views: async () => gql(q.VIEWS_QUERY, { projectId: await projectId(PROJECT_NUMBER), cursor: null }),
  project: async () => gql(q.PROJECT_DETAILS_QUERY, { projectId: await projectId(PROJECT_NUMBER) }),
  'items-page1': async () => gql(q.PROJECT_ITEMS_QUERY, { projectId: await projectId(PROJECT_NUMBER), cursor: null }),
  'items-page2': async () => {
    const id = await projectId(PROJECT_NUMBER);
    const first = await gql(q.PROJECT_ITEMS_QUERY, { projectId: id, cursor: null });
    return gql(q.PROJECT_ITEMS_QUERY, { projectId: id, cursor: first.data.node.items.pageInfo.endCursor });
  },
  'item-detail-issue': async () => {
    const id = await projectId(PROJECT_NUMBER);
    const first = await gql(q.PROJECT_ITEMS_QUERY, { projectId: id, cursor: null });
    const issue = first.data.node.items.nodes.find((n) => n.type === 'ISSUE');
    return gql(q.ITEM_DETAIL_QUERY, { itemId: issue.id });
  },
  'item-detail-draft': async () => {
    const id = await projectId(sandbox());
    const items = await gql(q.PROJECT_ITEMS_QUERY, { projectId: id, cursor: null });
    const draft = items.data.node.items.nodes.find((n) => n.type === 'DRAFT_ISSUE');
    return gql(q.ITEM_DETAIL_QUERY, { itemId: draft.id });
  },
  'sandbox-project': async () => gql(q.PROJECT_DETAILS_QUERY, { projectId: await projectId(sandbox()) }),
  'sandbox-items': async () => gql(q.PROJECT_ITEMS_QUERY, { projectId: await projectId(sandbox()), cursor: null }),
};

// ---- anonymisation -------------------------------------------------------------------------
// Mappings are shared by every fixture of one run, so ids and names stay consistent across files.

/** Field and label names that are generic and safe to keep (tests rely on them). */
const KEEP_FIELDS = new Set(['Status', 'Priority', 'Size', 'Iteration', 'Sprint', 'Estimate', 'Due', 'Notes']);
const KEEP_LABELS = new Set(['bug', 'feature', 'docs', 'documentation', 'enhancement', 'epic', 'question', 'tech-debt', 'P0', 'P1', 'P2']);
const CONTENT_TYPES = new Set(['Issue', 'PullRequest', 'DraftIssue']);
const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

const logins = new Map([[OWNER.toLowerCase(), 'octo-user']]);
const repos = new Map(); // "owner/name" (lower-case) -> "octo-user/repo-N"
const projectTitles = new Map(); // project id -> title
const fieldNames = new Map(); // field id -> name
const optionNames = new Map(); // option id (per field) -> name
const labelNames = new Map(); // lower-case -> name

const counter = (m) => m.size + 1;
let renamedFields = 0;
const alias = (login) => {
  const key = login.toLowerCase();
  if (!logins.has(key)) logins.set(key, `user-${logins.size}`);
  return logins.get(key);
};

function collect(v, parent) {
  if (Array.isArray(v)) return v.forEach((x) => collect(x, parent));
  if (!v || typeof v !== 'object') return;
  if (typeof v.login === 'string') alias(v.login);
  if (typeof v.nameWithOwner === 'string' && !repos.has(v.nameWithOwner.toLowerCase())) {
    repos.set(v.nameWithOwner.toLowerCase(), `octo-user/repo-${counter(repos)}`);
  }
  // ProjectV2 nodes: id + title + number
  if (typeof v.id === 'string' && v.id.startsWith('PVT_') && typeof v.title === 'string' && !projectTitles.has(v.id)) {
    const others = [...projectTitles.values()].filter((t) => t !== 'Sample project').length;
    projectTitles.set(v.id, v.number === PROJECT_NUMBER ? 'Sample project' : `Other project ${others + 1}`);
  }
  // Project fields: id + name + dataType
  if (typeof v.id === 'string' && typeof v.name === 'string' && typeof v.dataType === 'string' && !fieldNames.has(v.id)) {
    const keep = KEEP_FIELDS.has(v.name) || !['SINGLE_SELECT', 'ITERATION', 'TEXT', 'NUMBER', 'DATE'].includes(v.dataType);
    fieldNames.set(v.id, keep ? v.name : `Custom field ${String.fromCharCode(65 + renamedFields++)}`);
    for (const o of v.options ?? []) {
      optionNames.set(`${v.id}:${o.id}`, keep ? o.name : `Option ${optionNames.size + 1}`);
    }
  }
  if (parent === 'labels' && typeof v.name === 'string' && typeof v.color === 'string') {
    const key = v.name.toLowerCase();
    if (!labelNames.has(key)) labelNames.set(key, KEEP_LABELS.has(v.name) ? v.name : `label-${labelNames.size + 1}`);
  }
  for (const [k, val] of Object.entries(v)) collect(val, k === 'nodes' ? parent : k);
}

function scrubString(s) {
  let out = s;
  for (const [real, fake] of repos) out = out.replace(new RegExp(escapeRe(real), 'gi'), fake);
  for (const [real, fake] of logins) out = out.replace(new RegExp(escapeRe(real), 'gi'), fake);
  // Links to repositories seen only in URLs (parent issues, linked pull requests) keep no name.
  const fakeRepos = new Set(repos.values());
  return out.replace(/github\.com\/([\w.-]+)\/([\w.-]+)/g, (m, owner, name) =>
    owner === 'users' || owner === 'orgs' || fakeRepos.has(`${owner}/${name}`) ? m : 'github.com/octo-user/other-repo',
  );
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

let seq = 0;
function anonymise(v, parent, fieldId) {
  if (Array.isArray(v)) return v.map((x) => anonymise(x, parent, fieldId));
  if (!v || typeof v !== 'object') return typeof v === 'string' ? scrubString(v) : v;
  const out = {};
  const isContent = CONTENT_TYPES.has(v.__typename);
  const isPerson = typeof v.login === 'string';
  const isProject = typeof v.id === 'string' && projectTitles.has(v.id);
  const isField = typeof v.id === 'string' && fieldNames.has(v.id) && typeof v.dataType === 'string';
  const valueFieldId = v.field?.id;
  for (const [k, val] of Object.entries(v)) {
    if (isContent && k === 'title') out[k] = `Sample ${v.__typename} ${v.number ?? ++seq}`;
    else if (isContent && (k === 'body' || k === 'bodyText')) out[k] = LOREM;
    else if (isContent && k === 'bodyHTML') out[k] = `<p>${LOREM}</p>`;
    else if (k === 'milestone' && val) out[k] = { title: 'Sample milestone' };
    else if (k === 'parent' && val) out[k] = { ...anonymise(val, k, fieldId), title: `Sample parent issue ${val.number}` };
    else if (v.__typename === 'ProjectV2ItemFieldTextValue' && k === 'text') out[k] = `Sample text ${++seq}`;
    else if (v.__typename === 'ProjectV2ItemFieldSingleSelectValue' && k === 'name' && valueFieldId) {
      out[k] = optionNames.get(`${valueFieldId}:${v.optionId}`) ?? `Option ?`;
    } else if (isProject && k === 'title') out[k] = projectTitles.get(v.id);
    else if (isField && k === 'name') out[k] = fieldNames.get(v.id);
    else if (isField && k === 'options') {
      const keep = KEEP_FIELDS.has(v.name);
      out[k] = val.map((o) => ({
        ...o,
        name: optionNames.get(`${v.id}:${o.id}`),
        ...(o.description !== undefined ? { description: keep ? o.description : '' } : {}),
      }));
    } else if (parent === 'labels' && k === 'name' && typeof v.color === 'string') out[k] = labelNames.get(val.toLowerCase());
    else if (k === 'name' && parent === 'verticalGroupByFields' && typeof v.id === 'string') out[k] = fieldNames.get(v.id) ?? val;
    else if (isPerson && k === 'name') out[k] = val === null ? null : `Name of ${alias(v.login)}`;
    else if (k === 'avatarUrl') out[k] = 'https://avatars.githubusercontent.com/u/0?v=4';
    else if (k === 'shortDescription' && val) out[k] = 'Sample project description';
    else if (k === 'nameWithOwner') out[k] = repos.get(val.toLowerCase()) ?? val;
    else out[k] = anonymise(val, k === 'nodes' ? parent : k, fieldId);
  }
  return out;
}

const wanted = process.argv.slice(2);
const recorded = {};
for (const [name, record] of Object.entries(fixtures)) {
  if (wanted.length && !wanted.includes(name)) continue;
  recorded[name] = await record();
  collect(recorded[name]);
}
for (const [name, raw] of Object.entries(recorded)) {
  const file = new URL(`../test/fixtures/${name}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(anonymise(raw), null, 2) + '\n');
  console.log(`recorded ${name}`);
}
