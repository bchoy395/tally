import {
  api, state, h, money, fmtDate, fmtDateLong, pageHead, changed, toast, options, accountOptions, field, readFile, catPath, navigate, ACCOUNT_TYPES, plural,
} from '../core.js';

let job = null; // { name, text, account_id, options, preview, result }

const MAP_FIELDS = [['date', 'Date'], ['payee', 'Payee / description'], ['amount', 'Amount'], ['debit', 'Debit (money out)'], ['credit', 'Credit (money in)'], ['memo', 'Memo'], ['category', 'Category'], ['num', 'Check #'], ['type', 'Debit/credit flag']];

async function runPreview() {
  job.preview = await api.post('/import/preview', { text: job.text, filename: job.name, account_id: job.account_id, options: job.options });
  if (job.preview.format !== 'qif') job.options.mapping = job.preview.mapping || job.options.mapping;
  if (job.preview.format === 'qif') {
    job.accountMap = {};
    for (const a of job.preview.accounts) job.accountMap[a.name] = a.target ? String(job.account_id || '') : String(a.existing_account_id || '');
  }
}

async function start(file, accountId) {
  if (!file) return;
  if (file.size > 60 * 1024 * 1024) { toast('That file is too large (60 MB max).', 'error'); return; }
  const text = await readFile(file);
  job = { name: file.name, text, account_id: accountId || '', options: {} };
  try { await runPreview(); }
  catch (e) { toast(e.message, 'error'); if (!/account/i.test(e.message)) job = null; }
  changed();
}

function chooser(el, query) {
  const preset = query.get('account_id') || '';
  const acct = h('select', null, accountOptions(preset, { blank: 'Choose an account…' }));
  const input = h('input', { type: 'file', accept: '.qif,.qfx,.ofx,.csv,.txt,.tsv', class: 'sr-only', id: 'import-file' });
  input.addEventListener('change', () => start(input.files[0], acct.value));
  const drop = h('label', { class: 'dropzone', for: 'import-file' },
    h('div', { style: { fontSize: '16px', fontWeight: 600 } }, 'Choose a file or drop it here'),
    h('div', { class: 'muted', style: { marginTop: '4px' } }, 'QIF (Quicken) · OFX / QFX (bank downloads) · CSV'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); start(e.dataTransfer.files[0], acct.value); });

  el.append(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' }, h('div', { class: 'card-body', style: { paddingTop: '16px' } },
      field('Import into', acct),
      h('p', { class: 'muted small' }, 'Needed for bank files (OFX, QFX, CSV). A full Quicken QIF export brings its own accounts, so you can leave this blank.'),
      drop, input)),
    h('div', { class: 'card' }, h('div', { class: 'card-body', style: { paddingTop: '16px' } },
      h('h2', null, 'Moving from Quicken'),
      h('ol', { class: 'steps' },
        h('li', null, 'Quicken for Windows: ', h('b', null, 'File › Export › QIF File'), '. Choose ', h('b', null, '<All Accounts>'), ', tick Transactions, Account list and Category list, then save.'),
        h('li', null, 'Quicken for Mac: use ', h('b', null, 'File › Export'), ' and pick QIF if your version offers it. Otherwise export each register as CSV and import one account at a time.'),
        h('li', null, 'Drop the file here. You\'ll see every account and can match it to an existing one or create it.')),
      h('p', { class: 'muted small' }, 'Transfers between accounts are linked once (not doubled), splits keep their categories, and opening balances come across. A backup is taken before a Quicken import.'),
      h('h2', { style: { marginTop: '16px' } }, 'From your bank'),
      h('p', { class: 'ink-2', style: { marginTop: '4px' } }, 'Download activity as OFX, QFX ("Quicken"), or CSV. Re-importing an overlapping date range is safe: likely duplicates are found and left unticked.')))));
}

function qifPreview(el) {
  const p = job.preview;
  const accts = state.accounts;
  const rows = p.accounts.map((a) => {
    const sel = h('select', { onchange: (e) => { job.accountMap[a.name] = e.target.value; } },
      a.target ? accountOptions(job.accountMap[a.name], { blank: 'Choose an account…' })
        : options([['', `Create "${a.name}" (${ACCOUNT_TYPES[a.type] || a.type})`], ...accts.map((x) => [x.id, `Add to ${x.name}`])], job.accountMap[a.name]));
    return h('tr', null,
      h('td', null, a.target ? h('em', null, 'Transactions (the file has no account name)') : a.name),
      h('td', { class: 'amt' }, a.count.toLocaleString()),
      h('td', { class: 'ink-2' }, a.from ? `${fmtDateLong(a.from)} – ${fmtDateLong(a.to)}` : '—'),
      h('td', { class: 'amt' }, a.opening ? money(a.opening.amount) : '—'),
      h('td', null, sel));
  });
  el.append(h('div', { class: 'callout', style: { marginBottom: '16px' } },
    h('span', { class: 'grow' }, `${job.name}: ${plural(p.accounts.reduce((s, a) => s + a.count, 0), 'transaction')} in ${plural(p.accounts.length, 'account')}.`)));
  el.append(h('div', { class: 'card', style: { marginBottom: '16px' } },
    h('div', { class: 'card-head' }, h('h2', null, 'Accounts in this file')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, 'Quicken account'), h('th', { class: 'r' }, 'Transactions'), h('th', null, 'Dates'), h('th', { class: 'r' }, 'Opening balance'), h('th', null, 'Import to'))),
      h('tbody', null, rows)))));
  if (p.new_categories.length) {
    el.append(h('details', { class: 'card', style: { marginBottom: '16px' } },
      h('summary', { style: { padding: '12px 16px', cursor: 'pointer' } }, `${plural(p.new_categories.length, 'new category', 'new categories')} will be added`),
      h('div', { class: 'card-body ink-2' }, p.new_categories.join(' · '))));
  }
  if (p.warnings.length) el.append(h('div', { class: 'callout warn', style: { marginBottom: '16px', display: 'block' } }, p.warnings.slice(0, 8).map((w) => h('div', null, w))));
  el.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { job = null; changed(); } }, 'Cancel'), h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary', onclick: async (e) => {
      const target = p.accounts.find((a) => a.target);
      if (target && !job.accountMap[target.name]) { toast('Choose which account the transactions belong to.', 'error'); return; }
      e.target.disabled = true; e.target.textContent = 'Importing…';
      try {
        job.result = await api.post('/import/qif', { text: job.text, options: job.options, target_account_id: target ? job.accountMap[target.name] : null,
          account_map: Object.fromEntries(Object.entries(job.accountMap).filter(([, v]) => v)) });
        await changed();
      } catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = 'Import everything'; }
    } }, 'Import everything')));
}

function bankPreview(el) {
  const p = job.preview;
  const acctName = (state.accounts.find((a) => a.id === Number(job.account_id)) || {}).name || '';
  const dups = p.rows.filter((r) => r.duplicate).length;
  el.append(h('div', { class: 'callout', style: { marginBottom: '16px' } },
    h('span', { class: 'grow' }, `${job.name} → ${acctName}: ${plural(p.rows.length, 'transaction')}`, dups ? `. ${dups} look like ones you already have and are unticked.` : '.',
      p.statement && p.statement.balance !== null ? ` Statement balance ${money(p.statement.balance)}${p.statement.date ? ` on ${fmtDateLong(p.statement.date)}` : ''}.` : '')));
  if (p.errors && p.errors.length) {
    el.append(h('details', { class: 'callout warn', style: { marginBottom: '16px', display: 'block' } },
      h('summary', { style: { cursor: 'pointer' } }, `${p.errors.length} line${p.errors.length === 1 ? '' : 's'} couldn't be read`),
      p.errors.slice(0, 20).map((e) => h('div', { class: 'small' }, e))));
  }
  if (p.format === 'csv') {
    const m = { ...(job.options.mapping || {}) };
    const selects = MAP_FIELDS.map(([k, label]) => field(label, h('select', { onchange: (e) => { if (e.target.value === '') delete m[k]; else m[k] = Number(e.target.value); } },
      options([['', '(none)'], ...p.headers.map((hd, i) => [i, hd || `Column ${i + 1}`])], m[k] ?? '')), 'span-2'));
    const order = h('select', null, options([['auto', 'Detect'], ['MDY', 'Month/Day/Year'], ['DMY', 'Day/Month/Year']], job.options.dateOrder || 'auto'));
    const negate = h('input', { type: 'checkbox', checked: !!job.options.negate });
    el.append(h('details', { class: 'card', style: { marginBottom: '16px' }, open: !p.rows.length },
      h('summary', { style: { padding: '12px 16px', cursor: 'pointer', fontWeight: 600 } }, 'Columns'),
      h('div', { class: 'card-body' },
        h('div', { class: 'form-grid' }, selects, field('Date format', order, 'span-2'),
          h('label', { class: 'check span-4' }, negate, 'Flip signs (use if spending shows up as deposits)')),
        h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: async () => {
          job.options = { mapping: m, dateOrder: order.value, negate: negate.checked };
          try { await runPreview(); } catch (e) { toast(e.message, 'error'); }
          changed();
        } }, 'Update preview')))));
  }
  const dl = h('datalist', { id: 'dl-import-cats' }, state.categories.filter((c) => !c.hidden).map((c) => h('option', { value: c.path })));
  const tb = h('tbody');
  const rows = p.rows.map((r) => {
    const cb = h('input', { type: 'checkbox', checked: r.include });
    const payee = h('input', { type: 'text', value: r.payee, style: { width: '100%' } });
    const cat = h('input', { type: 'text', value: r.category_id ? catPath(r.category_id) : r.category_name || '', placeholder: 'Uncategorized', style: { width: '100%' } });
    cat.setAttribute('list', 'dl-import-cats');
    const known = new Set(state.categories.map((c) => c.path.toLowerCase()));
    const hint = h('div', { class: 'memo' });
    const syncHint = () => { const t = cat.value.trim(); hint.textContent = t && !known.has(t.toLowerCase()) ? 'New category — will be created' : ''; };
    cat.addEventListener('input', syncHint);
    syncHint();
    tb.append(h('tr', { class: r.include ? '' : 'future' },
      h('td', { class: 'w-check' }, cb),
      h('td', { class: 'date' }, fmtDate(r.date)),
      h('td', { style: { minWidth: '200px' } }, payee, r.payee !== r.original_payee ? h('div', { class: 'memo' }, `was ${r.original_payee}`) : r.memo ? h('div', { class: 'memo' }, r.memo) : null),
      h('td', { style: { minWidth: '180px' } }, cat, hint),
      h('td', { class: `amt ${r.amount > 0 ? 'pos' : ''}` }, money(r.amount)),
      h('td', null, r.duplicate ? h('span', { class: `badge ${r.duplicate === 'exact' ? 'bad' : 'warn'}` }, r.duplicate === 'exact' ? 'Already imported' : 'Possible duplicate') : null)));
    cb.addEventListener('change', () => { cb.closest('tr').classList.toggle('future', !cb.checked); updateBtn(); });
    return { r, cb, payee, cat };
  });
  el.append(h('div', { class: 'card', style: { marginBottom: '16px' } }, dl, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Date'), h('th', null, 'Payee'), h('th', null, 'Category'), h('th', { class: 'r' }, 'Amount'), h('th', null, ''))),
    tb))));
  const btn = h('button', { class: 'btn primary' });
  const updateBtn = () => { const n = rows.filter((x) => x.cb.checked).length; btn.textContent = `Import ${n} transaction${n === 1 ? '' : 's'}`; btn.disabled = !n; };
  updateBtn();
  btn.addEventListener('click', async () => {
    const byPath = new Map(state.categories.map((c) => [c.path.toLowerCase(), c.id]));
    const payload = rows.filter((x) => x.cb.checked).map(({ r, payee, cat }) => {
      const text = cat.value.trim();
      const id = byPath.get(text.toLowerCase());
      return { date: r.date, amount: r.amount, payee: payee.value, memo: r.memo, num: r.num, import_id: r.import_id || null, category_id: id || null, category_name: !id && text ? text : '' };
    });
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      job.result = await api.post('/import/commit', { account_id: job.account_id, rows: payload });
      await changed();
    } catch (e) { toast(e.message, 'error'); updateBtn(); }
  });
  el.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { job = null; changed(); } }, 'Cancel'), h('span', { class: 'spacer' }), btn));
}

function result(el) {
  const r = job.result;
  const acct = job.account_id;
  el.append(h('div', { class: 'card', style: { padding: '24px' } },
    h('h2', null, `Imported ${plural(r.imported, 'transaction')}`),
    h('ul', { class: 'steps' },
      r.linked_transfers !== undefined ? h('li', null, `${plural(r.linked_transfers, 'transfer')} matched across accounts`) : null,
      r.duplicates ? h('li', null, `${plural(r.duplicates, 'duplicate')} skipped`) : null,
      r.accounts_created && r.accounts_created.length ? h('li', null, `New accounts: ${r.accounts_created.join(', ')}`) : null,
      ...(r.warnings || []).slice(0, 6).map((w) => h('li', null, w))),
    h('div', { class: 'row', style: { marginTop: '16px' } },
      h('button', { class: 'btn', onclick: () => { job = null; changed(); } }, 'Import another file'),
      h('button', { class: 'btn primary', onclick: () => { job = null; navigate(acct && !r.accounts_created ? `#/account/${acct}` : '#/dashboard'); } }, 'Done'))));
}

export async function render(el, _parts, query) {
  el.append(pageHead('Import', 'Bring in history from Quicken or your bank'));
  if (job && !job.preview) {
    const acct = h('select', { onchange: async (e) => {
      job.account_id = e.target.value;
      try { await runPreview(); } catch (err) { toast(err.message, 'error'); }
      changed();
    } }, accountOptions('', { blank: 'Choose an account…' }));
    el.append(h('div', { class: 'card', style: { padding: '20px', maxWidth: '520px' } },
      h('p', { style: { marginTop: 0 } }, `Which account is ${job.name} for?`), acct,
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => { job = null; changed(); } }, 'Cancel'))));
    return;
  }
  if (!job) return chooser(el, query);
  if (job.result) return result(el);
  if (job.preview.format === 'qif') return qifPreview(el);
  return bankPreview(el);
}

