// Content-script controller: creates highlights from selections, restores saved ones
// on load, keeps them in sync with storage, and repairs them when the page re-renders.
(() => {
  const WCN = globalThis.WCN;
  if (WCN.contentLoaded || !document.body) return;
  WCN.contentLoaded = true;

  const { anchor, hl, ui, store } = WCN;

  const state = {
    url: null,
    page: null,
    settings: { ...WCN.DEFAULT_SETTINGS },
    anchored: new Map(), // id -> mark elements
    pending: new Set(), // ids whose text isn't (yet) on the page
    ownRevs: new Set(), // revisions we wrote, so our own storage echoes are ignored
  };

  const highlights = () => state.page?.highlights || [];
  const findHighlight = (id) => highlights().find((h) => h.id === id);

  // ---------------------------------------------------------------- anchoring

  function applyOne(h, index) {
    const loc = anchor.locate(h, index);
    const els = loc ? hl.wrap(h, loc.start, loc.end, index) : [];
    if (!els.length) {
      state.pending.add(h.id);
      return false;
    }
    state.anchored.set(h.id, els);
    state.pending.delete(h.id);
    return true;
  }

  // Wrapping splits text nodes, so the index is rebuilt after every successful wrap.
  function applyMany(list) {
    let index = null;
    for (const h of list) {
      index ??= anchor.buildIndex();
      if (applyOne(h, index)) index = null;
    }
  }

  function removeOne(id) {
    const els = state.anchored.get(id);
    if (els) hl.unwrap(els);
    state.anchored.delete(id);
    state.pending.delete(id);
  }

  function clearAll() {
    ui.hidePopover();
    ui.hideToolbar();
    for (const id of [...state.anchored.keys()]) removeOne(id);
    state.pending.clear();
  }

  // Re-anchors highlights the page removed (SPA re-render) or that weren't
  // present yet at load time (lazy-loaded content).
  function repair() {
    for (const [id, els] of state.anchored) {
      if (els.every((el) => el.isConnected)) continue;
      hl.unwrap(els.filter((el) => el.isConnected));
      state.anchored.delete(id);
      state.pending.add(id);
    }
    if (!state.pending.size) return;
    const waiting = [...state.pending].map(findHighlight).filter(Boolean);
    state.pending = new Set(waiting.map((h) => h.id));
    applyMany(waiting);
  }

  let repairTimer = null;
  function scheduleRepair() {
    if (repairTimer) return;
    repairTimer = setTimeout(() => {
      repairTimer = null;
      repair();
    }, 1000);
  }

  // ---------------------------------------------------------------- storage

  async function load() {
    const url = WCN.normalizeUrl(location.href);
    state.url = url;
    state.page = null;
    if (!url) return;
    const saved = await store.getPage(url);
    if (state.url !== url) return; // navigated away while loading
    state.page = saved || { url, title: document.title, highlights: [], createdAt: Date.now() };
    applyMany(WCN.sortHighlights(state.page.highlights));
    updateBadge();
  }

  function persist() {
    const page = state.page;
    page.title = document.title || page.title;
    const saving = store.savePage(page);
    state.ownRevs.add(page.highlights.length ? page.rev : `removed:${page.url}`);
    updateBadge();
    saving.catch(() => ui.toast('保存失败：扩展可能已更新，请刷新页面'));
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    if (changes[WCN.SETTINGS_KEY]) {
      state.settings = { ...WCN.DEFAULT_SETTINGS, ...changes[WCN.SETTINGS_KEY].newValue };
    }
    if (!state.url || !state.page) return;
    const change = changes[WCN.pageKey(state.url)];
    if (!change) return;
    const rev = change.newValue ? change.newValue.rev : `removed:${state.url}`;
    if (state.ownRevs.delete(rev)) return;
    syncFrom(change.newValue);
  }

  // Applies a page version written elsewhere (popup, manager, another tab).
  function syncFrom(next) {
    const list = next?.highlights || [];
    const ids = new Set(list.map((h) => h.id));
    for (const h of highlights()) if (!ids.has(h.id)) removeOne(h.id);
    if (ui.popoverId && !ids.has(ui.popoverId)) ui.hidePopover();

    state.page = next || { url: state.url, title: document.title, highlights: [], createdAt: Date.now() };
    const fresh = [];
    for (const h of list) {
      const els = state.anchored.get(h.id);
      if (els) {
        els.forEach((el) => hl.decorate(el, h));
        ui.refreshPopover(h);
      } else if (!state.pending.has(h.id)) {
        fresh.push(h);
      }
    }
    applyMany(fresh);
    updateBadge();
  }

  function updateBadge() {
    try {
      chrome.runtime.sendMessage({ type: 'badge', count: highlights().length }).catch(() => {});
    } catch {
      // extension context invalidated (extension reloaded) — nothing to update
    }
  }

  // ---------------------------------------------------------------- actions

  function selectionRange() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!sel.toString().trim() || isEditable(range.commonAncestorContainer)) return null;
    return range;
  }

  function isEditable(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!el && (!!el.closest('input, textarea, select') || el.isContentEditable);
  }

  function create(color, { withNote = false } = {}) {
    ui.hideToolbar();
    if (!state.page) return ui.toast('当前页面不支持批注');
    const range = selectionRange();
    if (!range) return ui.toast('请先选中网页中的文字');

    const index = anchor.buildIndex();
    const offsets = anchor.rangeToOffsets(range, index);
    if (!offsets) return ui.toast('这段文字无法高亮');

    const now = Date.now();
    const h = {
      id: WCN.uid(),
      color: color || state.settings.defaultColor,
      note: '',
      ...anchor.describe(offsets.start, offsets.end, index),
      createdAt: now,
      updatedAt: now,
    };
    const els = hl.wrap(h, offsets.start, offsets.end, index);
    if (!els.length) return ui.toast('这段文字无法高亮');

    state.anchored.set(h.id, els);
    state.page.highlights.push(h);
    persist();
    getSelection().removeAllRanges();

    if (color && color !== state.settings.defaultColor) {
      store.setSettings({ defaultColor: color }).catch(() => {});
    }
    if (withNote) openPopover(h.id, { focusNote: true });
  }

  function update(id, patch) {
    const h = findHighlight(id);
    if (!h) return;
    Object.assign(h, patch, { updatedAt: Date.now() });
    (state.anchored.get(id) || []).forEach((el) => hl.decorate(el, h));
    ui.refreshPopover(h);
    persist();
  }

  function remove(id) {
    removeOne(id);
    state.page.highlights = highlights().filter((h) => h.id !== id);
    persist();
    ui.toast('已删除高亮');
  }

  // Rect of the line that was clicked (or the last line of the highlight).
  function rectFor(els, point) {
    const rects = els.flatMap((el) => [...el.getClientRects()]);
    if (!rects.length) return els[0].getBoundingClientRect();
    if (point) {
      const hit = rects.find((r) => point.x >= r.left - 2 && point.x <= r.right + 2 && point.y >= r.top - 2 && point.y <= r.bottom + 2);
      if (hit) return hit;
    }
    return rects[rects.length - 1];
  }

  function openPopover(id, opts = {}, point = null) {
    const h = findHighlight(id);
    const els = state.anchored.get(id);
    if (!h || !els) return;
    ui.showPopover(h, rectFor(els, point), opts);
  }

  function scrollToHighlight(id) {
    const els = state.anchored.get(id);
    if (!els) return false;
    els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    hl.flash(els);
    return true;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    ui.toast('已复制');
  }

  const handlers = {
    onHighlight: (color) => create(color),
    onAnnotate: () => create(state.settings.defaultColor, { withNote: true }),
    onCopySelection: () => {
      const text = getSelection().toString().trim();
      ui.hideToolbar();
      if (text) copyText(text);
    },
    onCopyHighlight: (id) => {
      const h = findHighlight(id);
      if (h) copyText(h.note ? `${WCN.displayText(h)}\n\n批注：${h.note}` : WCN.displayText(h));
    },
    onColor: (id, color) => update(id, { color }),
    onNote: (id, note) => update(id, { note }),
    onDelete: (id) => remove(id),
    onPopoverToggle: (id, open) => {
      (state.anchored.get(id) || []).forEach((el) => el.classList.toggle('wcn-active', open));
    },
  };

  // ---------------------------------------------------------------- events

  function checkSelection() {
    if (!state.settings.showToolbar || !state.page) return;
    const range = selectionRange();
    if (!range) return ui.hideToolbar();
    const rects = range.getClientRects();
    const rect = rects.length ? rects[0] : range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    ui.showToolbar(rect);
  }

  document.addEventListener('mousedown', (e) => {
    if (ui.owns(e)) return;
    ui.hideToolbar();
    ui.hidePopover();
  }, true);

  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || ui.owns(e)) return;
    setTimeout(checkSelection, 0);
  }, true);

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' && !ui.owns(e)) checkSelection();
  }, true);

  document.addEventListener('click', (e) => {
    if (ui.owns(e)) return;
    const mark = e.target.closest?.(hl.SELECTOR);
    if (!mark || !getSelection().isCollapsed) return;
    openPopover(mark.dataset.wcnId, {}, { x: e.clientX, y: e.clientY });
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ui.hideToolbar();
      ui.hidePopover();
    }
  }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'highlight':
        create(msg.color);
        break;
      case 'annotate':
        create(msg.color, { withNote: true });
        break;
      case 'scrollTo':
        sendResponse({ ok: scrollToHighlight(msg.id) });
        break;
      case 'status':
        sendResponse({ url: state.url, pending: [...state.pending] });
        break;
    }
  });

  chrome.storage.onChanged.addListener(onStorageChanged);

  // SPA navigation: pushState doesn't fire events visible to content scripts,
  // so the URL is polled in addition to popstate/hashchange.
  let lastHref = location.href;
  function checkUrl() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (WCN.normalizeUrl(location.href) === state.url) return;
    clearAll();
    load();
  }
  setInterval(checkUrl, 1000);
  addEventListener('popstate', checkUrl);
  addEventListener('hashchange', checkUrl);

  new MutationObserver(scheduleRepair).observe(document.body, { childList: true, subtree: true, characterData: true });

  ui.init(handlers);
  store.getSettings().then((s) => (state.settings = s)).catch(() => {});
  load();
})();
