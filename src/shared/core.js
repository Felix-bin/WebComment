// Shared by content scripts, popup and the manage page (classic script, no modules).
(() => {
  const WCN = (globalThis.WCN = globalThis.WCN || {});

  const PAGE_PREFIX = 'page:';
  const SETTINGS_KEY = 'settings';
  const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|spm|ref_src|_hsenc|_hsmi)$/i;

  WCN.COLORS = [
    { id: 'yellow', name: '黄色', swatch: '#ffd43b' },
    { id: 'green', name: '绿色', swatch: '#69db7c' },
    { id: 'blue', name: '蓝色', swatch: '#74c0fc' },
    { id: 'pink', name: '粉色', swatch: '#f783ac' },
    { id: 'purple', name: '紫色', swatch: '#b197fc' },
  ];

  WCN.DEFAULT_SETTINGS = {
    defaultColor: 'yellow',
    showToolbar: true,
  };

  WCN.swatch = (colorId) => (WCN.COLORS.find((c) => c.id === colorId) || WCN.COLORS[0]).swatch;

  WCN.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // The same article should map to the same key regardless of tracking params or
  // in-page anchors. Hash routes (#/ or #!) are kept because they identify SPA pages.
  WCN.normalizeUrl = (raw) => {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (!['http:', 'https:', 'file:'].includes(u.protocol)) return null;
    const tracking = [...u.searchParams.keys()].filter((k) => TRACKING_PARAM.test(k));
    tracking.forEach((k) => u.searchParams.delete(k));
    if (!/^#[!/]/.test(u.hash)) u.hash = '';
    return u.toString();
  };

  WCN.pageKey = (url) => PAGE_PREFIX + url;
  WCN.isPageKey = (key) => key.startsWith(PAGE_PREFIX);

  const local = () => chrome.storage.local;

  WCN.store = {
    async getPage(url) {
      const key = WCN.pageKey(url);
      const res = await local().get(key);
      return res[key] || null;
    },

    // A page with no highlights left is removed so the manage page stays clean.
    // page.rev is set synchronously (before any await) so callers can recognise the
    // storage.onChanged echo of their own write.
    async savePage(page) {
      const key = WCN.pageKey(page.url);
      if (!page.highlights.length) {
        await local().remove(key);
        return;
      }
      page.updatedAt = Date.now();
      page.rev = WCN.uid();
      await local().set({ [key]: page });
    },

    async deletePage(url) {
      await local().remove(WCN.pageKey(url));
    },

    async getAllPages() {
      const all = await local().get(null);
      return Object.entries(all)
        .filter(([k]) => WCN.isPageKey(k))
        .map(([, v]) => v)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    async getSettings() {
      const res = await local().get(SETTINGS_KEY);
      return { ...WCN.DEFAULT_SETTINGS, ...(res[SETTINGS_KEY] || {}) };
    },

    async setSettings(patch) {
      const next = { ...(await WCN.store.getSettings()), ...patch };
      await local().set({ [SETTINGS_KEY]: next });
      return next;
    },
  };

  WCN.SETTINGS_KEY = SETTINGS_KEY;
  WCN.UI_HOST_ID = 'wcn-ui-host';

  WCN.sortHighlights = (list) => [...list].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  WCN.displayText = (h) => (h.exact || '').replace(/\s+/g, ' ').trim();

  WCN.formatDate = (ts) => {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  WCN.pageToMarkdown = (page) => {
    const lines = [`## [${page.title || page.url}](${page.url})`, ''];
    for (const h of WCN.sortHighlights(page.highlights)) {
      lines.push(`> ${WCN.displayText(h)}`);
      if (h.note) lines.push('', h.note);
      lines.push('');
    }
    return lines.join('\n');
  };
})();
