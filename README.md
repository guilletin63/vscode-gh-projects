# GitHub Projects Boards for VS Code

Work with **GitHub Projects (v2)** boards without leaving the editor: the same board you see at
`github.com/users/<owner>/projects/<n>`, with columns by Status and cards you can move.

![Board](docs/screenshots/board.png)

## Features

- **Projects tree** in the Activity Bar: your user, your organizations and any owner you add,
  with their open projects and views.
- **Board** grouped by the view's "Column by" field (or `Status`, or the first single-select
  field). Cards show number, title, repository, labels, assignees and custom fields
  (single-select, iteration, number, date, text). Works with projects of any size: items are
  loaded 100 at a time.
- **Move cards** by drag & drop, with the **Move** menu or with <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd>.
  The card moves at once; if GitHub rejects the change it goes back and you get a warning.
- **Filters and search**: free text (`#123`, repository, labels…) plus label, assignee and any
  single-select field. Filters are remembered per project and workspace.
- **Item details**: the issue or pull request body, its project fields (editable), labels and
  assignees, with **Open on GitHub**, **Copy link** and, if the
  [GitHub Pull Requests](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github)
  extension is installed, **Open in GitHub Pull Requests**.
- **Refresh** on demand, optional polling and a status bar counter of the items assigned to you
  that are "In progress".
- Follows your VS Code theme (light, dark and high contrast).

## Installation

Download `vscode-gh-projects-<version>.vsix` from the latest
[CI run](https://github.com/guilletin63/vscode-gh-projects/actions/workflows/ci.yml?query=branch%3Amain)
(artifact **vsix**; GitHub asks you to sign in to download artifacts) or build it yourself (`npm ci && npm run package`), then:

```bash
code --install-extension vscode-gh-projects-0.1.0.vsix
```

## How to use

### 1. Sign in

Open the **GitHub Projects** view in the Activity Bar and choose **Sign in to GitHub**. The
extension uses the GitHub account VS Code already knows; nothing to configure.

<img src="docs/screenshots/sign-in.png" alt="Sign in" width="420">

### 2. Open a board

Your user and organizations are listed with their open projects. Click a project to open its
board, or expand it and pick one of its views. Use **Add Owner…** (＋ in the view title) for an
organization that doesn't show up on its own.

![Open a board](docs/media/open-board.gif)

### 3. Move cards

Drag a card to another column. It moves immediately and GitHub is updated in the background; if
the update fails, the card goes back and you get a warning. Without a mouse: focus a card and use
the **Move** menu or <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd>. The status bar counter
("1 in progress") follows your own items.

![Move a card](docs/media/move-card.gif)

### 4. Filter and search

Type in the search box (`#123`, words from titles, repository, labels…) or pick values in the
**Label**, **Assignee** and field menus. Values inside a menu are combined with OR, menus with
AND. Filters are remembered per project.

![Filters](docs/media/filters.gif)

### 5. Item details

Click a card to read its description and edit its project fields. **Open on GitHub** and
**Copy link** are one click away.

![Item details](docs/media/item-detail.gif)

### Light theme

![Board in the light theme](docs/screenshots/board-light.png)

## Permissions and privacy

- Sign-in goes through VS Code's built-in GitHub authentication. Reading asks for the
  `read:project` and `repo` scopes. The first time you move a card or edit a field, VS Code asks
  for the `project` scope.
- Tokens are never written to settings, disk or logs by this extension.
- No telemetry. The extension only talks to `api.github.com`.
- The board runs in a webview with a strict Content Security Policy and no remote scripts.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `ghProjects.refreshInterval` | `0` | Seconds between automatic refreshes of visible boards and the counter. `0` disables polling; the minimum is 30. Polling pauses while the window is not focused and slows down when GitHub rate-limits. |
| `ghProjects.inProgressColumn` | `In progress` | Column counted in the status bar for items assigned to you (case-insensitive). |

## Commands

- **GitHub Projects: Sign in to GitHub**
- **GitHub Projects: Refresh** (tree and open boards)
- **GitHub Projects: Add Owner…**
- **GitHub Projects: Open Last Board**

## Known limitations

- The view's own GitHub filter (`is:open label:bug …`) is not applied; use the board's filters.
- Moving a card changes its column only; the order inside a column follows the project.
- Organizations whose membership is private may not be listed automatically; add them with
  **Add Owner…**.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture, commands and tests.

## License

[MIT](LICENSE)
