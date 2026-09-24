# Tally

> **Using Tally on the Windows computer?** Read **[HOW-TO-USE.md](HOW-TO-USE.md)**: a step-by-step guide to starting Tally, using it, and getting updates.

A private, local personal-finance manager — a Quicken replacement that keeps everything in one SQLite file on your own computer. No account, no cloud, no subscription, no dependencies beyond Node.js.

## Run it

Double-click **`Tally.command`**, or:

```bash
npm start
```

Tally opens at <http://localhost:4280>. Requires Node.js 22.13+ (it uses Node's built-in SQLite).

Your data lives in `~/Library/Application Support/Tally/tally.db` (macOS). Override with `--data=/some/folder` or `TALLY_DATA`. The port can be changed with `--port=` or `TALLY_PORT`.

## What it does

| Area | Features |
|---|---|
| **Accounts** | Checking, savings, cash, credit cards, loans, property, investment/retirement. Balance today vs. after future-dated entries, cleared balance, open/closed. |
| **Registers** | Payment/Deposit columns, running balance, cleared status (click to toggle), search by payee/memo/amount, date and status filters, CSV export. |
| **Transactions** | QuickFill from a payee's last transaction, categories or `[Account]` transfers, **splits** (including split lines that transfer — e.g. mortgage principal), math in amount fields (`12.40+3`). |
| **Reconcile** | Enter statement date and balance, tick items off, finish at $0 difference or with an adjustment. |
| **Budget** | Monthly targets per category and subcategory, spent/left with over-budget meters, copy last month, fill from 3-month averages. |
| **Reports** | Spending and income by category or payee, income vs. spending by month, net worth over time. Click through to the transactions behind any number. |
| **Bills & recurring** | Weekly to yearly schedules, upcoming list with Enter/Skip, optional auto-enter (paychecks, autopay). |
| **Import** | Quicken **QIF** (multi-account migration with categories, splits, linked transfers, opening balances), **OFX/QFX**, and **CSV** (auto-detected columns, debit/credit or signed amounts, day-first dates). Duplicate detection by FITID and date/amount. |
| **Rules** | “Payee contains X” → rename and/or categorize. Imports also reuse the category you last used for the same payee. |
| **Safety** | Daily automatic backups (last 30 kept) plus a snapshot before any import, restore, account delete or erase. JSON backup/restore and full CSV export. |

## Moving from Quicken

- **Quicken for Windows:** File › Export › QIF File → `<All Accounts>`, tick Transactions, Account list and Category list.
- **Quicken for Mac:** File › Export — choose QIF if your version offers it; otherwise export registers to CSV and import them one account at a time.

Then open **Import** in Tally and drop the file in. You can map each Quicken account to a new or existing Tally account.

## Not included (yet)

- Investment holdings, lots, and prices. Investment accounts track value with **Update balance**, and contributions via transfers.
- Direct bank connections. Import OFX/QFX/CSV downloads instead.
- Online bill pay, tax schedules, and multi-currency accounts. One currency is set in Settings.

## Development

```bash
npm test
```

- `lib/` — database schema, ledger logic, importers, sample data
- `server.js` — the HTTP API. It binds to 127.0.0.1 only, checks the Host header, and requires an `X-Tally` header on every write.
- `public/` — the UI (plain ES modules, no build step)

## Keeping several computers up to date

The app code is in Git. Your financial data is stored outside this folder and is never committed.

- **After changing the code:** `git add -A && git commit -m "…" && git push`
- **On every other computer:** stop Tally, run `git pull` in the Tally folder, then start it again.

To move your data between computers, use **Settings › Download backup** on one and **Restore from backup** on the other.
