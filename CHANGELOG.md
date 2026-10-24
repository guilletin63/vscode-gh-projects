# Changelog

## 1.1.0

- **Table views** open as tables: the fields the view shows on GitHub, in the same order, with
  the view's sort and group-by. Click a column header to sort; change the grouping from the
  toolbar. Shows parent issue, sub-issues progress, linked pull requests, milestone and
  created / updated / closed dates too.
- **Roadmap views** open as a timeline: bars placed by an iteration field or start / target date
  fields (chosen in the toolbar), colored by Status, with month and iteration headers, a line for
  today and Month / Quarter / Year zoom. Items without dates are listed at the end.
- Board views work as before; "Column by" now only shows on boards.

## 1.0.1

- Fix: the Projects tree showed "Your GitHub session is missing a scope" after signing in. Listing
  your organizations needs the `read:org` scope, which is now requested (VS Code asks you to sign in
  once more). If organizations still can't be read, the tree shows your own projects anyway.

## 1.0.0

First release on the Visual Studio Marketplace.

- The extension is now called **GitHub Projects in VS Code** (it was "GitHub Projects Boards").
  Same features, settings and commands.
- Icons are PNG files (the Marketplace does not accept SVG images in extensions).

## 0.1.0

First release.

- Projects tree: signed-in user, organizations and manually added owners, with projects and views.
- Board grouped by the view's "Column by" field (or Status), with cursor pagination for large projects.
- Drag & drop, Move menu and Alt+←/→ to move cards, with optimistic updates and rollback.
- Text search and label / assignee / single-select filters, remembered per project.
- Item detail panel: rendered body, editable project fields, Open on GitHub, Copy link and
  GitHub Pull Requests integration.
- Refresh command, optional polling and an "in progress" status bar counter.
