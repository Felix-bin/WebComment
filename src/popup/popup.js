const WCN = globalThis.WCN;
const $ = (id) => document.getElementById(id);

let tab = null;
let url = null;
let page = null;
let pending = new Set();

function showEmpty(title, text) {
  $('emptyTitle').textContent = title;
  if (text) $('emptyText').textContent = text;
  $('empty').hidden = false;
}

function renderItem(h) {
  const item = document.createElement('div');
  item.className = 'item';
  item.style.setProperty('--c', WCN.swatch(h.color));

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = WCN.displayText(h);
  item.append(text);

  if (h.note) {
    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = h.note;
    item.append(note);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const date = document.createElement('span');
  date.textContent = WCN.formatDate(h.createdAt);
  meta.append(date);
  if (pending.has(h.id)) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = '页面中未找到原文';
    meta.append(tag);
  }
  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '删除';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    page.highlights = page.highlights.filter((x) => x.id !== h.id);
    await WCN.store.savePage(page);
  });
  meta.append(del);
  item.append(meta);

  item.addEventListener('click', () => {
    chrome.tabs.sendMessage(tab.id, { type: 'scrollTo', id: h.id }).catch(() => {});
  });
  return item;
}

async function refresh() {
  page = await WCN.store.getPage(url);
  const list = page ? WCN.sortHighlights(page.highlights) : [];
  $('pageTitle').textContent = page?.title || tab.title || url;
  $('count').textContent = list.length;
  $('count').hidden = !list.length;
  $('copyMd').disabled = !list.length;
  $('list').replaceChildren(...list.map(renderItem));
  $('empty').hidden = list.length > 0;
}

async function init() {
  const settings = await WCN.store.getSettings();
  $('toolbarToggle').checked = settings.showToolbar;
  $('toolbarToggle').addEventListener('change', (e) => WCN.store.setSettings({ showToolbar: e.target.checked }));
  $('openManage').addEventListener('click', () => chrome.runtime.openOptionsPage());

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  url = WCN.normalizeUrl(tab?.url || '');
  if (!url) {
    $('pageTitle').textContent = tab?.title || '';
    showEmpty('此页面不支持批注', '浏览器内置页面、扩展商店等页面无法添加高亮。');
    return;
  }

  const status = await chrome.tabs.sendMessage(tab.id, { type: 'status' }).catch(() => null);
  pending = new Set(status?.pending || []);
  if (!status) {
    $('banner').hidden = false;
    $('reload').addEventListener('click', () => {
      chrome.tabs.reload(tab.id);
      window.close();
    });
  }

  $('copyMd').addEventListener('click', async () => {
    if (!page) return;
    await navigator.clipboard.writeText(WCN.pageToMarkdown(page));
    $('copyMd').textContent = '已复制 ✓';
    setTimeout(() => ($('copyMd').textContent = '复制 Markdown'), 1500);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[WCN.pageKey(url)]) refresh();
  });

  await refresh();
}

init();
