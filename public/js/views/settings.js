import { api, state, h, pageHead, changed, attempt, toast, options, field, openDialog, confirmDialog, readFile, setTheme, loadVersion, versionLabel, fmtDateLong } from '../core.js';

const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'CHF', 'JPY', 'MXN', 'INR', 'SGD', 'HKD', 'SEK', 'NOK', 'DKK', 'ZAR', 'BRL'];

export async function render(el) {
  const [info] = await Promise.all([api('/info'), loadVersion().catch(() => null)]);
  el.append(pageHead('Settings', null));

  let theme = 'auto';
  try { theme = localStorage.getItem('tally-theme') || 'auto'; } catch {}
  const themeSel = h('select', { onchange: (e) => setTheme(e.target.value) },
    options([['auto', 'Match my computer'], ['light', 'Light'], ['dark', 'Dark']], theme));
  // Keep this in step when the sidebar button is used while Settings is open.
  const syncSel = () => { if (!themeSel.isConnected) { document.removeEventListener('tally-theme', syncSel); return; } try { themeSel.value = localStorage.getItem('tally-theme') || 'auto'; } catch {} };
  document.addEventListener('tally-theme', syncSel);
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

  el.append(h('div', { class: 'card', style: { marginBottom: '16px' } }, h('div', { class: 'card-head' }, h('h2', null, 'Version')), versionCard()));

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
      h('div', null, h('kbd', null, 'Enter'), ' Save the open form · ', h('kbd', null, 'Esc'), ' Close it'))));
}

// Which build this is, and whether GitHub has a newer one. Redraws when the server's startup check comes in.
function versionCard() {
  const body = h('div', { class: 'card-body stack' });
  const draw = () => {
    if (!body.isConnected && body.parentNode) { document.removeEventListener('tally-version', draw); return; }
    const v = state.version;
    if (!v) { body.replaceChildren(h('p', { class: 'ink-2', style: { margin: 0 } }, "Couldn't read the version.")); return; }
    const check = h('button', { class: 'btn', onclick: async () => {
      check.disabled = true;
      check.textContent = 'Checking…';
      if (await attempt(() => api.post('/version/check'))) await loadVersion().catch(() => null);
      else { check.disabled = false; check.textContent = 'Check for updates'; }
    } }, 'Check for updates');
    body.replaceChildren(
      h('div', null, h('div', { style: { fontWeight: 600 } }, `Tally ${versionLabel(v)}`),
        v.commit
          ? h('div', { class: 'small ink-2' }, `Latest change: ${v.subject} · ${fmtDateLong(v.date.slice(0, 10))}`)
          : h('div', { class: 'small ink-2' }, "This copy wasn't downloaded with Git, so it has no build number."),
        v.changed_files ? h('div', { class: 'small muted' }, `Plus ${v.changed_files} changed file${v.changed_files === 1 ? '' : 's'} not committed yet.`) : null),
      updateStatus(v.update),
      h('div', { class: 'row wrap' }, check,
        v.update?.checked_at ? h('span', { class: 'small muted' }, `Last checked ${new Date(v.update.checked_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`) : null));
  };
  document.addEventListener('tally-version', draw);
  draw();
  return body;
}

function updateStatus(u) {
  const p = (text) => h('p', { class: 'ink-2', style: { margin: 0 } }, text);
  if (!u) return p('Checking GitHub for a newer version…');
  if (!u.ok) return h('div', { class: 'callout warn' }, "Couldn't reach GitHub to check for a newer version. The internet may be off. Tally works fine either way.");
  const unpushed = u.ahead ? h('div', { class: 'small muted' }, `${u.ahead} commit${u.ahead === 1 ? '' : 's'} on this computer ${u.ahead === 1 ? "isn't" : "aren't"} on GitHub yet.`) : null;
  if (!u.behind) return h('div', null, p('This is the newest version on GitHub.'), unpushed);
  return h('div', null, h('div', { class: 'callout' }, h('div', null,
    h('b', null, 'A newer version of Tally is ready'), ` (build ${u.latest_build}, ${u.latest_commit}). To get it, close Tally, run git pull, then start Tally again. `,
    h('a', { href: '/help#update', target: '_blank', rel: 'noopener' }, 'Show me how'))), unpushed);
}
