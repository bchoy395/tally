import { api, state, h, pageHead, icon, changed, toast, options, categoryOptions, field, openDialog, qs } from '../core.js';

const KINDS = [['expense', 'Expense'], ['income', 'Income'], ['other', 'Other (not in reports)']];

function openCategoryDialog(c = null, { parent_id = '', kind = 'expense' } = {}) {
  const name = h('input', { type: 'text', value: c ? c.name : '', maxlength: 100 });
  const exclude = c ? new Set(state.categories.filter((x) => x.path === c.path || x.path.startsWith(`${c.path}:`)).map((x) => x.id)) : new Set();
  const parent = h('select', null, options([['', '(Top level)'], ...state.categories.filter((x) => !exclude.has(x.id)).map((x) => [x.id, `${' '.repeat(x.depth)}${x.name}`])], c ? c.parent_id ?? '' : parent_id));
  const kindSel = h('select', null, options(KINDS, c ? c.kind : kind));
  const hidden = h('input', { type: 'checkbox', checked: c ? !!c.hidden : false });
  const syncKind = () => { kindSel.disabled = !!parent.value; if (parent.value) kindSel.value = state.catById.get(Number(parent.value)).kind; };
  parent.addEventListener('change', syncKind);
  syncKind();
  openDialog({
    title: c ? 'Edit category' : 'New category',
    body: h('div', { class: 'form-grid' },
      field('Name', name, 'span-6'), field('Inside', parent, 'span-3'), field('Type', kindSel, 'span-3'),
      c ? h('label', { class: 'check span-6' }, hidden, 'Hide from pickers (keeps history)') : null),
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, submit: true, onClick: async () => {
      const body = { name: name.value, parent_id: parent.value || null, kind: kindSel.value, hidden: hidden.checked };
      if (c) await api.put(`/categories/${c.id}`, body); else await api.post('/categories', body);
      await changed();
      return true;
    } }],
  });
}

function openDeleteDialog(c) {
  const target = h('select', null, categoryOptions('', { blank: 'Leave them uncategorized' }));
  for (const o of [...target.options]) {
    const x = state.catById.get(Number(o.value));
    if (x && (x.id === c.id || x.path.startsWith(`${c.path}:`))) o.remove();
  }
  const kids = state.categories.filter((x) => x.parent_id === c.id).length;
  openDialog({
    title: `Delete "${c.name}"`,
    body: h('div', null,
      h('p', { style: { marginTop: 0 } }, c.txn_count ? `${c.txn_count} transactions use this category. Move them to:` : 'No transactions use this category.',
        kids ? ` Its ${kids} subcategories move up a level.` : ''),
      c.txn_count ? field('Replacement', target) : null),
    actions: [{ label: 'Cancel' }, { label: 'Delete category', danger: true, submit: true, onClick: async () => {
      await api.del(`/categories/${c.id}${qs({ reassign_to: target.value })}`);
      await changed();
      toast(`Deleted ${c.name}.`);
      return true;
    } }],
  });
}

export async function render(el) {
  el.append(pageHead('Categories', 'Organize income and spending. Use Parent:Child for subcategories.',
    h('button', { class: 'btn primary', onclick: () => openCategoryDialog() }, icon('plus'), 'New category')));
  const cols = h('div', { class: 'grid cols-2' });
  for (const [kind, label] of [['expense', 'Spending'], ['income', 'Income'], ['other', 'Other']]) {
    const list = state.categories.filter((c) => c.kind === kind);
    if (!list.length && kind === 'other') continue;
    const tree = h('div', { class: 'cat-tree card-body' });
    for (const c of list) {
      tree.append(h('div', { class: `cat-row depth-${Math.min(c.depth, 3)}` },
        h('span', { class: `grow ${c.depth === 0 ? 'top' : ''} ${c.hidden ? 'muted' : ''}` }, c.name, c.hidden ? ' (hidden)' : ''),
        c.txn_count ? h('a', { class: 'muted small', href: `#/transactions${qs({ category_id: c.id, include_sub: 0 })}` }, `${c.txn_count.toLocaleString()}`) : null,
        h('span', { class: 'actions' },
          h('button', { class: 'btn sm ghost', title: 'Add subcategory', onclick: () => openCategoryDialog(null, { parent_id: c.id, kind: c.kind }) }, '+ Sub'),
          h('button', { class: 'btn sm ghost', onclick: () => openCategoryDialog(c) }, 'Edit'),
          h('button', { class: 'btn sm ghost danger', onclick: () => openDeleteDialog(c) }, 'Delete'))));
    }
    cols.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, label), h('button', { class: 'btn sm', onclick: () => openCategoryDialog(null, { kind }) }, '+ Add')),
      list.length ? tree : h('div', { class: 'empty' }, 'None yet.')));
  }
  el.append(cols);
}

export { openCategoryDialog };
