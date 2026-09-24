import { api, h, pageHead, icon, changed, attempt, toast, categoryOptions, field, openDialog, confirmDialog, catPath } from '../core.js';

function openRuleDialog(r = null) {
  const match = h('input', { type: 'text', value: r ? r.match : '', placeholder: 'e.g. AMZN MKTP' });
  const payee = h('input', { type: 'text', value: r ? r.payee : '', placeholder: 'Leave blank to keep the bank\'s name' });
  const cat = h('select', null, categoryOptions(r ? r.category_id : '', { blank: '(Don\'t change)' }));
  const left = r ? [h('button', { type: 'button', class: 'btn danger', onclick: async () => {
    if (!(await confirmDialog('Delete this rule? Transactions it already changed stay as they are.', { title: 'Delete rule?', ok: 'Delete', danger: true }))) return;
    await attempt(() => api.del(`/rules/${r.id}`)); dlg.close(); await changed();
  } }, 'Delete')] : [];
  const dlg = openDialog({
    title: r ? 'Edit rule' : 'New rule',
    left,
    body: h('div', { class: 'form-grid' },
      field('When the payee contains', match, 'span-6'),
      field('Rename the payee to', payee, 'span-6'),
      field('Set the category to', cat, 'span-6'),
      h('p', { class: 'muted small span-6', style: { margin: 0 } }, 'Matching ignores upper/lower case. Rules run when you import, top to bottom; the first match wins.')),
    actions: [{ label: 'Cancel' }, { label: 'Save rule', primary: true, submit: true, onClick: async () => {
      const body = { match: match.value, payee: payee.value, category_id: cat.value || null };
      if (r) await api.put(`/rules/${r.id}`, body); else await api.post('/rules', body);
      await changed();
      return true;
    } }],
  });
}

export async function render(el) {
  const rules = await api('/rules');
  el.append(pageHead('Rules', 'Clean up payee names and categorize imported transactions automatically',
    h('button', { class: 'btn', onclick: async () => {
      const r = await attempt(() => api.post('/rules/apply'));
      if (r) { toast(r.changed ? `Updated ${r.changed} uncategorized transactions.` : 'No uncategorized transactions matched.'); await changed(); }
    } }, 'Apply to uncategorized'),
    h('button', { class: 'btn primary', onclick: () => openRuleDialog() }, icon('plus'), 'New rule')));
  el.append(h('div', { class: 'callout', style: { marginBottom: '16px' } },
    h('span', null, 'Even without rules, imports reuse the category you last gave the same payee (like Quicken\'s memorized payees). Rules are for messy bank names.')));
  const card = h('div', { class: 'card' });
  if (!rules.length) card.append(h('div', { class: 'empty' }, 'No rules yet.'));
  else {
    card.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, 'If payee contains'), h('th', null, 'Rename to'), h('th', null, 'Category'))),
      h('tbody', null, rules.map((r) => h('tr', { class: 'click', onclick: () => openRuleDialog(r) },
        h('td', null, h('code', null, r.match)),
        h('td', { class: r.payee ? '' : 'muted' }, r.payee || '—'),
        h('td', { class: `cat ${r.category_id ? '' : 'uncat'}` }, r.category_id ? catPath(r.category_id) : '—')))))));
  }
  el.append(card);
}
