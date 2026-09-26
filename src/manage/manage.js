const WCN = globalThis.WCN;
const $ = (id) => document.getElementById(id);

const state = {
  pages: [],
  query: '',
  colors: new Set(),
  notesOnly: false,
  editing: null, // highlight id whose note is being edited
  staleWhileEditing: false,
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...[].concat(children).filter((c) => c != null && c !== false));
  return node;
}

let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 2000);
}

// Text with every occurrence of the search query wrapped in <mark>.
function withMatches(text, query) {
  if (!query) return [text];
  const out = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let i = lower.indexOf(query); i !== -1; i = lower.indexOf(query, from)) {
    out.push(text.slice(from, i), el('mark', { class: 'match', text: text.slice(i, i + query.length) }));
    from = i + query.length;
  }
  out.push(text.slice(from));
  return out;
}

function hostOf(url) {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function faviconUrl(pageUrl) {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`);
}

// Two-click confirmation instead of window.confirm.
function confirmButton(label, confirmLabel, onConfirm) {
  let timer;
  const btn = el('button', { class: 'link-btn danger', text: label });
  btn.addEventListener('click', () => {
    if (btn.classList.contains('confirm')) {
      clearTimeout(timer);
      onConfirm();
      return;
    }
    btn.classList.add('confirm');
    btn.textContent = confirmLabel;
    timer = setTimeout(() => {
      btn.classList.remove('confirm');
      btn.textContent = label;
    }, 3000);
  });
  return btn;
}

async function copy(text) {
  await navigator.clipboard.writeText(text);
  toast('已复制');
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ data

async function reload() {
  state.pages = await WCN.store.getAllPages();
  render();
}

function filtered() {
  const q = state.query;
  return state.pages
    .map((page) => {
      const pageHit = !!q && ((page.title || '').toLowerCase().includes(q) || page.url.toLowerCase().includes(q));
      const highlights = WCN.sortHighlights(page.highlights).filter((h) => {
        if (state.colors.size && !state.colors.has(h.color)) return false;
        if (state.notesOnly && !h.note) return false;
        if (!q || pageHit) return true;
        return WCN.displayText(h).toLowerCase().includes(q) || (h.note || '').toLowerCase().includes(q);
      });
      return { page, highlights };
    })
    .filter((x) => x.highlights.length);
}

async function mutatePage(page, fn) {
  fn(page);
  await WCN.store.savePage(page);
}

// ------------------------------------------------------------------ render

function renderStats() {
  const total = state.pages.reduce((n, p) => n + p.highlights.length, 0);
  const notes = state.pages.reduce((n, p) => n + p.highlights.filter((h) => h.note).length, 0);
  $('stats').textContent = `${state.pages.length} 个网页 · ${total} 条高亮 · ${notes} 条批注`;
}

function renderNoteEditor(page, h) {
  const textarea = el('textarea', { placeholder: '写下你的想法…' });
  textarea.value = h.note || '';
  const finish = () => {
    state.editing = null;
    if (state.staleWhileEditing) {
      state.staleWhileEditing = false;
      reload();
    } else {
      render();
    }
  };
  const save = async () => {
    const note = textarea.value.trim();
    state.editing = null;
    await mutatePage(page, () => Object.assign(h, { note, updatedAt: Date.now() }));
    toast('批注已保存');
  };
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
    if (e.key === 'Escape') finish();
  });
  setTimeout(() => textarea.focus(), 0);
  return el('div', { class: 'hl-edit' }, [
    textarea,
    el('div', { class: 'row' }, [
      el('button', { class: 'btn', text: '取消', onclick: finish }),
      el('button', { class: 'btn save', text: '保存', onclick: save }),
    ]),
  ]);
}

function renderHighlight(page, h) {
  const q = state.query;
  const editing = state.editing === h.id;
  const node = el('div', { class: 'hl' }, [
    el('div', { class: 'hl-text' }, withMatches(WCN.displayText(h), q)),
    editing ? renderNoteEditor(page, h) : h.note && el('div', { class: 'hl-note' }, withMatches(h.note, q)),
    el('div', { class: 'hl-meta' }, [
      el('span', { text: WCN.formatDate(h.createdAt) }),
      el('span', { class: 'spacer' }),
      !editing &&
        el('div', { class: 'hl-actions' }, [
          el('button', {
            class: 'link-btn',
            text: h.note ? '编辑批注' : '添加批注',
            onclick: () => {
              state.editing = h.id;
              render();
            },
          }),
          el('button', {
            class: 'link-btn',
            text: '复制',
            onclick: () => copy(h.note ? `${WCN.displayText(h)}\n\n批注：${h.note}` : WCN.displayText(h)),
          }),
          confirmButton('删除', '确认删除', () =>
            mutatePage(page, (p) => (p.highlights = p.highlights.filter((x) => x.id !== h.id))),
          ),
        ]),
    ]),
  ]);
  node.style.setProperty('--c', WCN.swatch(h.color));
  return node;
}

function renderCard({ page, highlights }) {
  const q = state.query;
  const title = page.title || page.url;
  const shown = highlights.length === page.highlights.length
    ? `${highlights.length} 条`
    : `${highlights.length} / ${page.highlights.length} 条`;

  return el('section', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'card-title' }, [
        el('a', { href: page.url, target: '_blank', rel: 'noopener' }, [
          el('img', { src: faviconUrl(page.url), alt: '' }),
          el('span', {}, withMatches(title, q)),
        ]),
        el('div', { class: 'card-sub', text: `${hostOf(page.url)} · ${WCN.formatDate(page.updatedAt)} · ${shown}` }),
      ]),
      el('div', { class: 'card-actions' }, [
        el('button', { class: 'link-btn', text: '复制 Markdown', onclick: () => copy(WCN.pageToMarkdown(page)) }),
        confirmButton('删除网页', '确认删除全部', async () => {
          await WCN.store.deletePage(page.url);
          toast('已删除');
        }),
      ]),
    ]),
    ...highlights.map((h) => renderHighlight(page, h)),
  ]);
}

function render() {
  renderStats();
  const results = filtered();
  $('pages').replaceChildren(...results.map(renderCard));
  const filtering = state.query || state.colors.size || state.notesOnly;
  $('empty').hidden = results.length > 0;
  $('emptyTitle').textContent = filtering ? '没有匹配的笔记' : '还没有任何笔记';
  $('emptyText').textContent = filtering
    ? '换个关键词或清除筛选试试。'
    : '在网页上选中文字即可高亮和批注，它们会汇总到这里。';
}

function renderChips() {
  const chips = WCN.COLORS.map((c) => {
    const chip = el('button', { class: 'chip', title: `只看${c.name}` });
    chip.style.setProperty('--c', c.swatch);
    chip.addEventListener('click', () => {
      if (state.colors.has(c.id)) state.colors.delete(c.id);
      else state.colors.add(c.id);
      syncChips();
      render();
    });
    chip.dataset.color = c.id;
    return chip;
  });
  $('colorChips').replaceChildren(...chips);
  syncChips();
}

// With no color filter every chip is shown as active.
function syncChips() {
  for (const chip of $('colorChips').children) {
    chip.classList.toggle('on', !state.colors.size || state.colors.has(chip.dataset.color));
  }
}

// ------------------------------------------------------------------ import / export

function exportJson() {
  const data = { app: 'WebComment', version: 1, exportedAt: new Date().toISOString(), pages: state.pages };
  download(`webcomment-backup-${dateStamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function exportMarkdown() {
  const results = filtered();
  if (!results.length) return toast('没有可导出的笔记');
  const body = results
    .map(({ page, highlights }) => WCN.pageToMarkdown({ ...page, highlights }))
    .join('\n');
  download(`webcomment-notes-${dateStamp()}.md`, `# WebComment 笔记\n\n${body}`, 'text/markdown');
}

// Merges by highlight id: existing highlights are overwritten by imported ones only
// if the imported copy is newer.
async function importJson(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast('文件不是有效的 JSON');
  }
  const pages = Array.isArray(data?.pages) ? data.pages : null;
  if (!pages) return toast('不是 WebComment 的备份文件');

  let added = 0;
  for (const incoming of pages) {
    if (typeof incoming?.url !== 'string' || !Array.isArray(incoming.highlights)) continue;
    const page = (await WCN.store.getPage(incoming.url)) || { ...incoming, highlights: [] };
    const byId = new Map(page.highlights.map((h) => [h.id, h]));
    for (const h of incoming.highlights) {
      if (!h?.id || typeof h.exact !== 'string') continue;
      const existing = byId.get(h.id);
      if (!existing) added++;
      if (!existing || (h.updatedAt || 0) > (existing.updatedAt || 0)) byId.set(h.id, h);
    }
    page.highlights = [...byId.values()];
    page.title ||= incoming.title;
    await WCN.store.savePage(page);
  }
  toast(`导入完成，新增 ${added} 条高亮`);
}

// ------------------------------------------------------------------ init

let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  }, 150);
});
$('notesOnly').addEventListener('change', (e) => {
  state.notesOnly = e.target.checked;
  render();
});
$('exportJson').addEventListener('click', exportJson);
$('exportMd').addEventListener('click', exportMarkdown);
$('importJson').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (file) await importJson(file);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some(WCN.isPageKey)) return;
  if (state.editing) state.staleWhileEditing = true;
  else reload();
});

renderChips();
reload();
