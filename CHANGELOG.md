# Changelog

## 1.2.0

- **Drag rows between table groups** to set the group's value (single-select, iteration, number,
  date or text), or press <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>.
- **Reorder** cards inside a board column and rows of an unsorted table, by dragging or with
  <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>. Boards sorted on GitHub now show that order.
- **Edit table cells in place**: click a single-select, iteration, text, number or date cell.
- **Roadmap**: drag a bar to move its dates, or its ends to change the start or target date
  (date fields), also with <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd>.
- **Add items**: "+ Add item" in board columns and table groups creates a draft issue with that
  column's or group's value.
- Column and group headers show the sum of number fields; table and roadmap groups can be folded.
- **View filters**: each view shows the items its GitHub filter selects (`-status:Done`,
  `assignee:@me`, `sprint:@current`…), filtered by GitHub itself. "Show all items" turns it off.
- **Swimlanes**: boards with a "Group by" field (or one picked in the toolbar) show a lane per
  value; dropping a card in another lane sets that field as well. Lanes fold.

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
