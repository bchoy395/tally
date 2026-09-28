// Row selection + the action bar shared by the register and the Transactions list.
import { api, h, changed, attempt, toast, confirmDialog, categoryOptions } from '../core.js';
import { openTxnEditor } from '../editor.js';

export function bulkBar(selection) {
  const count = h('strong');
  const edit = h('button', { class: 'btn primary', onclick: () => openTxnEditor({ id: [...selection][0] }) }, 'Edit');
  const cat = h('select', { 'aria-label': 'Category for selected' }, categoryOptions('', { blank: 'Uncategorized' }));
  const run = async (body, msg) => {
    const r = await attempt(() => api.post('/transactions/bulk', { ids: [...selection], ...body }));
    if (!r) return;
    selection.clear();
    await changed();
    toast(`${msg(r.changed)}${r.skipped ? ` (${r.skipped} skipped — transfers and splits are edited one at a time)` : ''}`);
  };
  const bar = h('div', { class: 'bulkbar hidden' },
    count, edit,
    h('span', { class: 'spacer' }),
    cat, h('button', { class: 'btn', onclick: () => run({ action: 'category', value: cat.value || null }, (n) => `Categorized ${n}.`) }, 'Set category'),
    h('button', { class: 'btn', onclick: () => run({ action: 'status', value: 'c' }, (n) => `Marked ${n} cleared.`) }, 'Mark cleared'),
    h('button', { class: 'btn', onclick: () => run({ action: 'status', value: '' }, (n) => `Marked ${n} uncleared.`) }, 'Mark uncleared'),
    h('button', { class: 'btn danger', onclick: async () => {
      if (!(await confirmDialog(`Delete ${selection.size} transaction${selection.size === 1 ? '' : 's'}? Matching transfers in other accounts are removed too.`, { title: 'Delete transactions?', ok: 'Delete', danger: true }))) return;
      run({ action: 'delete' }, (n) => `Deleted ${n}.`);
    } }, 'Delete'),
    h('button', { class: 'btn ghost', onclick: () => { selection.clear(); changed(); } }, 'Clear selection'));
  bar.refresh = () => {
    bar.classList.toggle('hidden', selection.size === 0);
    count.textContent = `${selection.size} selected`;
    edit.classList.toggle('hidden', selection.size !== 1);
  };
  bar.refresh();
  return bar;
}

// Clicking anywhere on the row (except its buttons, links and inputs) toggles selection.
export function selectable(tr, cb, id, selection, bar) {
  tr.dataset.id = id;
  const sync = () => { cb.checked = selection.has(id); tr.classList.toggle('sel', cb.checked); bar.refresh(); };
  tr.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, select')) return;
    if (selection.has(id)) selection.delete(id); else selection.add(id);
    sync();
  });
  cb.addEventListener('change', () => { if (cb.checked) selection.add(id); else selection.delete(id); sync(); });
  sync();
}

// Works on whatever rows are on screen, so it stays right after the table is re-sorted.
export function selectAllBox(selection, bar, root) {
  const box = h('input', { type: 'checkbox', 'aria-label': 'Select all shown' });
  const rows = () => [...root.querySelectorAll('tbody tr[data-id]')];
  box.sync = () => { const r = rows(); box.checked = r.length > 0 && r.every((tr) => selection.has(Number(tr.dataset.id))); };
  box.addEventListener('change', () => {
    for (const tr of rows()) {
      const id = Number(tr.dataset.id);
      if (box.checked) selection.add(id); else selection.delete(id);
      tr.querySelector('input[type=checkbox]').checked = box.checked;
      tr.classList.toggle('sel', box.checked);
    }
    bar.refresh();
  });
  return box;
}
