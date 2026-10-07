# Tally — notes for Claude

Tally is a local, private personal-finance app (a Quicken replacement). It is a Node.js server that uses the built-in `node:sqlite`, plus a vanilla-JS single-page app. It has **no dependencies and no build step**. Read `README.md` for the feature list.

## People and machines

- **Brianna (the developer)** builds Tally and pushes it to GitHub. She started on a Mac and may now develop on Windows. Git identity: `Brianna Choy <hello@briannachoy.dev>`.
- **Brianna's mom (the end user)** runs Tally on a Windows PC, from a clone in `Desktop\tally`. That PC is **pull-only**: she closes Tally, runs `git pull` in PowerShell, and starts Tally again. She isn't technical. Never ask her to edit files, resolve merges or run anything beyond `git pull`. Anything that would need more is a call to Brianna.
- **Repo:** `https://github.com/bchoy395/tally` (private). It is cloned over HTTPS with the username in the URL (`https://bchoy395@github.com/...`), so it uses the **bchoy395** login rather than Brianna's work account, fincen-brianna, which uses SSH. Don't switch this repo to SSH.
- **Workflow:** Claude makes the change, verifies it and runs tests. **Brianna usually commits and pushes herself.** At the end of a change, give her a one-line `git add -A && git commit -m "…" && git push` command rather than committing unprompted. If she works on two machines, she should `git pull` before starting.

## Hard rules

- **Never touch the real data folder while testing.** It's `~/Library/Application Support/Tally` on the Mac and `%APPDATA%\Tally` on Windows. For browser testing, start a separate server with throwaway data:
  `node --disable-warning=ExperimentalWarning server.js --no-open --port=4281 --data=<scratch dir>`
  Then load sample data with `POST /api/sample` (it only works on an empty file).
- **Financial data never goes in the repo.** `.gitignore` blocks `*.db`, backups and CSV exports. Keep it that way.
- **Any user-facing change must also update `HOW-TO-USE.html`,** the beginner guide. Mom reads it, and it opens from the **Help** link at the bottom of the sidebar or by double-clicking. Write for someone who doesn't know what a menu or a terminal is: numbered steps, exact button names, what she'll see. It's HTML on purpose: Markdown was hard for her to read.
- **Keep `Tally.bat` in CRLF** (`.gitattributes` enforces it). Watch for shells rewriting `>nul` as `>/dev/null`.
- **Run `npm test` before handing back** (26 tests: importers, ledger, server). Verify UI changes in the browser pane against the throwaway server, and check `read_console_messages` for errors.

## Architecture

- `server.js`: an HTTP server that listens on 127.0.0.1 only. The default port is 4280; `--port=`, `--data=` and `--no-open` override it.
  - It rejects any request whose Host header isn't localhost.
  - Every non-GET request needs the `X-Tally: 1` header (CSRF guard).
  - `/help` serves `HOW-TO-USE.html`.
  - It takes a daily automatic backup, and a snapshot before imports, restores, erases and account deletes (`VACUUM INTO`, last 30 kept).
- `lib/db.js` holds the schema and seeds the default categories. `lib/ledger.js` holds all business logic in the `Ledger` class. `lib/importers.js` parses QIF, OFX/QFX and CSV with no database access. `lib/util.js` has the date and money helpers. `lib/sample.js` generates a year of sample data.
- **Money is always integer cents.** Negative means money leaving the account.
  - Liability accounts (`credit`, `loan`) hold negative balances, and the UI shows them as positive "owed" amounts.
- **Transfers** are two transactions linked by `transfer_id`.
  - **Splits** live in the `splits` table. A split line can itself be a transfer: its counterpart's `transfer_id` points at the parent. `split_parent_id` in queries marks such counterparts, which are edited through the parent.
  - Reports exclude transfers (see the `LINES` query).
  - Categories have a `kind` (`income`, `expense` or `other`); `other`, such as Balance Adjustment, is left out of reports. Category names can't contain `:` because it separates `Parent:Child`.
- **Frontend** (`public/`): ES modules, no framework.
  - `core.js` has `h()` for DOM building (use it; never use `innerHTML` with data), `api()`, `state`, formatting, dialogs, `sortableTable`, `editButton` and the theme helpers.
  - `changed()` reloads accounts and categories and re-renders the current view. View state that must survive re-renders lives in module-level variables. Routes are hash-based (`#/account/3`, `#/transactions?...`).

## UI conventions (decided with Brianna, keep them)

- **Rows select on click; editing is a separate per-row Edit button.** The register and the Transactions page show a bulk bar (`views/bulk.js`) once rows are selected.
- **Every table header sorts** through `sortableTable` (ascending, then descending; blanks last; sort remembered per table id). It sorts the full list and then pages, so the top results are always right. Budget and Categories are grouped, so they don't sort.
- **Amount colors:** deposits are green (`pos`). In Bills & recurring and Home's upcoming bills, payments are red (`neg`).
- **Light/dark:** the sun/moon button next to the brand; Settings › Appearance offers "Match my computer", Light or Dark. Colors are CSS tokens on `:root`, with dark values under both `prefers-color-scheme` and `[data-theme="dark"]`.
- **Sidebar:** ACCOUNTS and group headings (Banking, Credit cards, …) are bold and dark; account rows are indented under them.
- **New transactions open with focus on the Date field.** QuickFill fills the amount and category from the payee's last transaction.
- **The account page button is "Edit account"**, not "Settings", because "Settings" read as app-wide.
- **Use `minmax(0, 1fr)` for grid tracks** so charts and tables can't push the page wider than a phone screen.
- **Charts** (`charts.js`) follow the dataviz rules: thin marks, 4px rounded data ends, hover tooltips, a single y-axis, and series colors from the tokens.
- **Spreadsheet import template:** `public/tally-import-template.csv` has the columns Date, Payee, Money Out, Money In, Category, Memo and Check Number. It downloads from the Import page. Mom uses it, and `HOW-TO-USE.html#spreadsheet` explains it.

## Ideas not built yet

- A double-click "Update Tally" file so mom doesn't need PowerShell. Offered, not requested.
- Investment holdings, lots and prices (investment accounts use "Update balance" for now). Bank sync. Syncing data between computers (today: Settings › Download backup, then Restore on the other machine).
