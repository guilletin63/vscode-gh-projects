# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

Requires Node.js 22 and VS Code ≥ 1.99.

```bash
npm ci
npm run lint          # eslint
npm run typecheck     # tsc --noEmit (extension + webview + tests)
npm test              # vitest unit tests (fixtures in test/fixtures)
npm run build         # esbuild -> dist/extension.js + dist/webview.js
npm run test:integration   # @vscode/test-electron (needs a display; CI uses xvfb-run)
npm run package       # vsce package -> vscode-gh-projects-<version>.vsix
```

Press <kbd>F5</kbd> ("Run Extension") to start an Extension Development Host.
Install a build with `code --install-extension vscode-gh-projects-<version>.vsix`.

## Workflow

- Branch from `main` (`feat/<issue>-<slug>` or `fix/<issue>-<slug>`) and open a pull request.
- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`,
  `chore:`, `ci:`, `refactor:`.
- CI (lint, typecheck, unit and integration tests, `.vsix` packaging) must be green. PRs are
  squash-merged.
- Describe in the PR how you verified the change; include a screenshot for UI changes.

## Architecture

```
src/
  extension.ts        activate(): wires auth, api, tree, board panels, status bar, polling
  auth/               GitHub session via vscode.authentication (read scopes, write upgrade)
  api/                The ONLY layer that knows GraphQL
    client.ts           fetch-based GraphQL client: rate-limit detection + exponential backoff
    queries.ts          query/mutation documents
    raw.ts              types of the raw GraphQL responses
    mappers.ts          raw -> model (pure, unit-tested against recorded fixtures)
    projectsApi.ts      high-level operations used by the views (cursor pagination, first: 100)
  model/              Pure types and logic, no vscode / no GraphQL imports
    types.ts            Owner, ProjectSummary, ProjectView, Field, Item, ...
    board.ts            group-by field resolution + columns
    table.ts            table columns from the view's fields, sort and group-by
    roadmap.ts          roadmap date sources, item spans and the timeline scale
    filter.ts           text / label / assignee / field filters
    edits.ts            field inputs, optimistic edits and rollback
    stats.ts            status bar counter
  shared/protocol.ts  Typed postMessage protocol, imported by BOTH extension and webview
  views/              VS Code UI (tree, webview host, status bar, poller)
  webview/            Browser-side code of the panel (vanilla TS + CSS, bundled by esbuild):
                      main.ts (board, toolbar, state), tableView.ts, roadmapView.ts, detail.ts
test/
  unit/               vitest
  fixtures/           recorded GraphQL responses (anonymised)
  integration/        mocha suites run inside VS Code by @vscode/test-electron
  live/               real writes against a throw-away project (not in CI)
  harness/            dev-only helper extension for screenshots
scripts/              build, fixture recording, screenshot harness
```

Dependency direction: `views` → `api` → `model`; `webview` → `shared` → `model`. The UI never
builds GraphQL; it calls `ProjectsApi` methods that return model types.

### Key decisions

- **Auth scopes**: reads use `['read:project', 'read:org', 'repo']` (organization fields need
  `read:org`). The first write asks for `['project', 'read:org', 'repo']` (`createIfNone`); from
  then on that session is preferred for reads too. If organizations still can't be read, the tree
  falls back to the signed-in user.
- **Group-by field**: the view's `verticalGroupByFields` ("Column by") when it is single-select,
  else the field named `Status`, else the first single-select field. Items without a value go to
  a "No <field>" column.
- **Webview security**: CSP `default-src 'none'`, scripts only with a per-load nonce, styles from
  `webview.cspSource`, images from `https:`. Issue bodies are GitHub's sanitised `bodyHTML`, run
  through `webview/sanitize.ts` as well. Every message from the webview is validated by
  `parseWebviewMessage`.
- **Rate limits**: `client.ts` retries secondary limits, 403/429 and `RATE_LIMITED` using
  `retry-after` or `x-ratelimit-reset` when present, else exponential backoff with jitter, and
  reports each wait so the UI can warn. A mutation that returns GraphQL errors always fails.
- **Testing hooks**: `activate()` returns `__api` / `__setApiFactory` / `__setTokenProvider` /
  `__treeChildren` / `__boards` / `__statusText` so integration tests and the screenshot harness
  can drive the extension. Never used in product code.

## Tests

- Every GraphQL → model mapper has a unit test against a fixture in `test/fixtures/`. To record
  fixtures from your own projects (read-only queries; the script anonymises logins, titles,
  repository, field, option and label names):

  ```bash
  GHP_FIXTURE_OWNER=<login> GHP_FIXTURE_PROJECT=<project with >100 items> \
  GHP_SANDBOX_PROJECT=<throw-away project> node scripts/record-fixtures.mjs
  ```

- `npm run test:live` writes to a throw-away project. Point `SANDBOX_ID` / `SANDBOX_TITLE` in
  `test/live/sandbox.live.test.ts` at a project of your own; it refuses to run against any other.
- `npm run screenshot -- --scenario <name>` opens the extension in an Extension Development Host
  and captures it over the Chrome DevTools Protocol. Scenarios live in `scripts/scenarios.mjs` and
  use the `SANDBOX` project defined there.
- `npm run demo -- --demo open|move|filter|detail|all` records the README GIFs into `docs/media`
  (needs `ffmpeg` and Python with Pillow). `move` and `detail` change a Status and a Priority in
  the sandbox; set them back before recording again.
- `npm run drag-check -- "<card title>" "<column>" [--table]` drags a card (or a table row) with
  real mouse input and checks where it lands. Run it after touching drag & drop: tests that fire
  DOM drag events can't see a drag that Chromium cancels by itself (for example when the page
  changes styles inside `dragstart`). It moves one sandbox item; drag it back afterwards. If the
  first press misses (`drag started: false`, no events), run it again.

## Publishing

The extension is published as `guilletin63.vscode-gh-projects` on the Visual Studio Marketplace.

1. Bump `version` in `package.json` and add the entry to `CHANGELOG.md`.
2. `npm run package` and upload the `.vsix` from the publisher page
   (**⋮ → Update**), or `npx vsce publish`.
3. Attach the same `.vsix` to a GitHub release (`v<version>`).

Marketplace upload rules learned the hard way (its only error is a generic "suspicious content"):

- No SVG files in the package (icons are PNG; `media/projects-*.png` are the Activity Bar and
  panel icons).
- `CHANGELOG.md` is kept out of the package (`.vscodeignore`); uploads that included it were rejected.
- Nothing in `package.json` that reads credentials (`$(gh auth token)` lives in `scripts/test-live.mjs`).

## Conventions

- TypeScript `strict`, no `any` (use `unknown` + narrowing).
- Model types are plain, JSON-serialisable data so they can cross `postMessage` as-is.
- Webview styles only use `--vscode-*` variables so light, dark and high-contrast themes work.
- No telemetry. Never log tokens or request headers.
- User-facing strings and code comments are in English.
