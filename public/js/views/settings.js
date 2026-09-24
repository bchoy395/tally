import { api, state, h, pageHead, changed, attempt, toast, options, field, openDialog, confirmDialog, readFile, applyTheme } from '../core.js';

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'CHF', 'JPY', 'MXN', 'INR', 'SGD', 'HKD', 'SEK', 'NOK', 'DKK', 'ZAR', 'BRL'];

export async function render(el) {
  const info = await api('/info');
  el.append(pageHead('Settings', null));

  let theme = 'auto';
  try { theme = localStorage.getItem('tally-theme') || 'auto'; } catch {}
  const themeSel = h('select', { onchange: (e) => { try { localStorage.setItem('tally-theme', e.target.value); } catch {} applyTheme(); } },
    options([['auto', 'Match my Mac'], ['light', 'Light'], ['dark', 'Dark']], theme));
  const cur = h('select', { onchange: async (e) => { if (await attempt(() => api.put('/settings', { currency: e.target.value }), 'Currency updated.')) await changed(); } },
    options(CURRENCIES.includes(state.settings.currency) ? CURRENCIES.map((c) => [c, c]) : [[state.settings.currency, state.settings.currency], ...CURRENCIES.map((c) => [c, c])], state.settings.currency));

  el.append(h('div', { class: 'card', style: { marginBottom: '16px' } }, h('div', { class: 'card-head' }, h('h2', null, 'Display')),
    h('div', { class: 'card-body' }, h('div', { class: 'form-grid' }, field('Appearance', themeSel, 'span-3'), field('Currency', cur, 'span-3')))));

  const restoreInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', id: 'restore-file' });
  restoreInput.addEventListener('change', async () => {
    const f = restoreInput.files[0];
    restoreInput.value = '';
    if (!f) return;
    let data;
    try { data = JSON.parse(await readFile(f)); } catch { toast("That file isn't a Tally backup.", 'error'); return; }
    if (!(await confirmDialog(`Replace everything in Tally with the backup "${f.name}"? A copy of your current data is saved first.`, { title: 'Restore backup?', ok: 'Replace my data', danger: true }))) return;
    if (await attempt(() => api.post('/restore', data), 'Backup restored.')) { await changed(); location.hash = '#/dashboard'; }
  });

  el.append(h('div', { class: 'card', style: { marginBottom: '16px' } }, h('div', { class: 'card-head' }, h('h2', null, 'Your data')),
    h('div', { class: 'card-body stack' },
      h('p', { class: 'ink-2', style: { margin: 0 } }, 'Everything lives in one file on this computer. Tally never sends it anywhere.'),
      h('div', null, h('div', { class: 'small muted' }, 'Data file'), h('code', { style: { wordBreak: 'break-all' } }, info.data_file || '(in memory)')),
      info.backups_dir ? h('div', null, h('div', { class: 'small muted' }, `Automatic backups (daily, and before imports, restores and deletes; the last 30 are kept)`),
        h('code', { style: { wordBreak: 'break-all' } }, info.backups_dir),
        info.backups.length ? h('div', { class: 'small ink-2' }, `${info.backups.length} saved · latest ${info.backups[0]}`) : null) : null,
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn', href: '/api/backup', download: '' }, 'Download backup (.json)'),
        h('label', { class: 'btn', for: 'restore-file' }, 'Restore from backup…'), restoreInput,
        h('a', { class: 'btn', href: '/api/export.csv', download: '' }, 'Export all transactions (CSV)')))));

  const danger = h('div', { class: 'card-body stack' });
  if (!state.accounts.length) {
    danger.append(h('div', { class: 'row' }, h('span', { class: 'grow ink-2' }, 'Try Tally with a year of made-up household finances.'),
      h('button', { class: 'btn', onclick: async () => { if (await attempt(() => api.post('/sample'), 'Sample data loaded.')) { await changed(); location.hash = '#/dashboard'; } } }, 'Load sample data')));
  }
  danger.append(h('div', { class: 'row' }, h('span', { class: 'grow ink-2' }, 'Erase all accounts, transactions, budgets and rules and start over. A backup is saved first.'),
    h('button', { class: 'btn danger', onclick: () => {
      const input = h('input', { type: 'text', placeholder: 'ERASE', autocomplete: 'off' });
      openDialog({
        title: 'Erase everything?',
        body: h('div', null, h('p', { style: { marginTop: 0 } }, 'Type ERASE to confirm. You can undo this by restoring the automatic backup.'), input),
        actions: [{ label: 'Cancel' }, { label: 'Erase all data', danger: true, submit: true, onClick: async () => {
          await api.post('/erase', { confirm: input.value.trim() });
          await changed();
          toast('All data erased.');
          location.hash = '#/dashboard';
          return true;
        } }],
      });
    } }, 'Erase all data…')));
  el.append(h('div', { class: 'card', style: { marginBottom: '16px' } }, h('div', { class: 'card-head' }, h('h2', null, 'Start over')), danger));

  el.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Keyboard shortcuts')),
    h('div', { class: 'card-body ink-2' },
      h('div', null, h('kbd', null, 'N'), ' New transaction (in the current account)'),
      h('div', null, h('kbd', null, '/'), ' Search'),
      h('div', null, h('kbd', null, 'Enter'), ' Save the open form · ', h('kbd', null, 'Esc'), ' Close it'),
      h('p', { class: 'small muted' }, `Tally ${info.version || ''}`))));
}
