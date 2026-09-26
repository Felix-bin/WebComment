// Floating UI (selection toolbar, note popover, toast) rendered inside a closed shadow
// root so page CSS can't affect it. Built with DOM APIs + a constructable stylesheet,
// which keeps it working on pages with strict CSP / Trusted Types.
(() => {
  const WCN = globalThis.WCN;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    note: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
    copy: [
      'M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z',
      'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    ],
    trash: ['M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'],
    close: ['M18 6 6 18', 'M6 6l12 12'],
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .layer {
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      color: #1f2328;
      -webkit-font-smoothing: antialiased;
    }
    button { font: inherit; }

    .toolbar {
      position: absolute; display: flex; align-items: center; gap: 4px;
      padding: 5px 6px 5px 10px; background: #25262b; color: #f1f3f5; border-radius: 999px;
      box-shadow: 0 8px 24px rgba(0,0,0,.22), 0 1px 3px rgba(0,0,0,.2);
      user-select: none; animation: pop .12s ease-out;
    }
    .dot {
      width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%;
      cursor: pointer; transition: transform .12s, box-shadow .12s;
    }
    .dot:hover { transform: scale(1.18); }
    .sep { width: 1px; height: 18px; background: rgba(255,255,255,.18); margin: 0 4px; }
    .tbtn {
      display: flex; align-items: center; gap: 4px; height: 28px; padding: 0 9px;
      border: 0; border-radius: 999px; background: transparent; color: inherit; cursor: pointer;
    }
    .tbtn:hover { background: rgba(255,255,255,.12); }
    .tbtn svg { width: 15px; height: 15px; }

    .popover {
      position: absolute; width: 320px; max-width: calc(100vw - 16px);
      background: #fff; border: 1px solid rgba(0,0,0,.08); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,.16), 0 2px 6px rgba(0,0,0,.06);
      padding: 12px; animation: pop .12s ease-out;
    }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .popover .dot { width: 16px; height: 16px; }
    .popover .dot.on { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--c); }
    .spacer { flex: 1; }
    .ibtn {
      width: 28px; height: 28px; display: grid; place-items: center; padding: 0;
      border: 0; border-radius: 8px; background: transparent; color: #6a737d; cursor: pointer;
    }
    .ibtn:hover { background: #f1f3f5; color: #1f2328; }
    .ibtn.danger:hover { background: #fff0f0; color: #e03131; }
    .ibtn svg { width: 16px; height: 16px; }
    .quote {
      font-size: 12px; color: #57606a; border-left: 3px solid var(--c);
      padding: 1px 0 1px 8px; margin-bottom: 10px;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
      word-break: break-word;
    }
    textarea {
      display: block; width: 100%; min-height: 88px; max-height: 260px; resize: vertical;
      border: 1px solid #d0d7de; border-radius: 8px; padding: 8px 10px; margin: 0;
      font: inherit; font-size: 13.5px; color: #1f2328; background: #f6f8fa; outline: none;
      transition: border-color .15s, background .15s, box-shadow .15s;
    }
    textarea:focus { border-color: #4c6ef5; background: #fff; box-shadow: 0 0 0 3px rgba(76,110,245,.15); }
    textarea::placeholder { color: #8c959f; }
    .meta { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: #8c959f; }

    .toast {
      position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
      background: #25262b; color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,.2); animation: fade .15s ease-out;
    }

    @media (prefers-color-scheme: dark) {
      .layer { color: #e6edf3; }
      .popover { background: #1f2328; border-color: rgba(255,255,255,.1); }
      .popover .dot.on { box-shadow: 0 0 0 2px #1f2328, 0 0 0 4px var(--c); }
      .ibtn { color: #9198a1; }
      .ibtn:hover { background: #2d333b; color: #e6edf3; }
      .ibtn.danger:hover { background: #3c1f22; color: #ff8182; }
      .quote { color: #9198a1; }
      textarea { background: #161a1f; border-color: #3d444d; color: #e6edf3; }
      textarea:focus { background: #0d1117; }
    }

    @keyframes pop { from { opacity: 0; transform: translateY(4px) scale(.98); } }
    @keyframes fade { from { opacity: 0; } }
  `;

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...[].concat(children).filter(Boolean));
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const attrs = {
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    for (const d of ICONS[name]) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  let host;
  let handlers;
  let toolbar;
  let popover;
  let toastEl;
  let toastTimer;
  const pop = { id: null, dots: [], quote: null, textarea: null, status: null, date: null, dirty: false, timer: null };

  function init(h) {
    handlers = h;
    host = document.createElement('div');
    host.id = WCN.UI_HOST_ID;
    const hostStyle = { position: 'absolute', top: '0', left: '0', width: '0', height: '0', 'z-index': '2147483647', overflow: 'visible' };
    for (const [k, v] of Object.entries(hostStyle)) host.style.setProperty(k, v, 'important');

    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];

    // Keep typing in the note box from triggering the site's keyboard shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress', 'input']) {
      root.addEventListener(type, (e) => e.stopPropagation());
    }

    toolbar = buildToolbar();
    popover = buildPopover();
    toastEl = el('div', { class: 'toast', hidden: '' });
    root.append(el('div', { class: 'layer' }, [toolbar, popover, toastEl]));
    ensureHost();
  }

  function ensureHost() {
    if (!host.isConnected) document.documentElement.appendChild(host);
  }

  function buildToolbar() {
    const dots = WCN.COLORS.map((c) => {
      const b = el('button', { class: 'dot', title: `${c.name}高亮`, onclick: () => handlers.onHighlight(c.id) });
      b.style.background = c.swatch;
      return b;
    });
    const bar = el('div', { class: 'toolbar', hidden: '' }, [
      ...dots,
      el('div', { class: 'sep' }),
      el('button', { class: 'tbtn', title: '高亮并批注', onclick: () => handlers.onAnnotate() }, [icon('note'), el('span', { text: '批注' })]),
      el('button', { class: 'tbtn', title: '复制', onclick: () => handlers.onCopySelection() }, [icon('copy')]),
    ]);
    // Clicking the toolbar must not clear the page selection it acts on.
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    return bar;
  }

  function buildPopover() {
    pop.dots = WCN.COLORS.map((c) => {
      const b = el('button', { class: 'dot', title: c.name, onclick: () => pop.id && handlers.onColor(pop.id, c.id) });
      b.style.background = c.swatch;
      b.style.setProperty('--c', c.swatch);
      b.dataset.color = c.id;
      return b;
    });
    pop.quote = el('div', { class: 'quote' });
    pop.textarea = el('textarea', { placeholder: '写下你的想法…（Ctrl+Enter 完成）' });
    pop.textarea.addEventListener('input', () => {
      pop.dirty = true;
      pop.status.textContent = '编辑中…';
      clearTimeout(pop.timer);
      pop.timer = setTimeout(flushNote, 500);
    });
    pop.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        hidePopover();
      }
    });
    pop.status = el('span');
    pop.date = el('span');

    const copyBtn = el('button', { class: 'ibtn', title: '复制原文和批注', onclick: () => pop.id && handlers.onCopyHighlight(pop.id) }, [icon('copy')]);
    const delBtn = el('button', {
      class: 'ibtn danger',
      title: '删除高亮',
      onclick: () => {
        const id = pop.id;
        pop.dirty = false;
        hidePopover();
        handlers.onDelete(id);
      },
    }, [icon('trash')]);
    const closeBtn = el('button', { class: 'ibtn', title: '关闭', onclick: () => hidePopover() }, [icon('close')]);

    return el('div', { class: 'popover', hidden: '' }, [
      el('div', { class: 'head' }, [...pop.dots, el('div', { class: 'spacer' }), copyBtn, delBtn, closeBtn]),
      pop.quote,
      pop.textarea,
      el('div', { class: 'meta' }, [pop.date, pop.status]),
    ]);
  }

  // Positions node (in document coordinates) next to a viewport rect.
  function place(node, rect, prefer) {
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = innerHeight;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - w / 2, 8), Math.max(8, vw - w - 8));
    const above = rect.top - h - 10;
    const below = rect.bottom + 10;
    let top;
    if (prefer === 'above') top = above >= 8 ? above : below;
    else top = below + h <= vh - 8 || above < 8 ? below : above;
    node.style.left = `${left + scrollX}px`;
    node.style.top = `${top + scrollY}px`;
  }

  function showToolbar(rect) {
    ensureHost();
    hidePopover();
    toolbar.hidden = false;
    place(toolbar, rect, 'above');
  }

  function hideToolbar() {
    if (toolbar) toolbar.hidden = true;
  }

  function fillPopover(h) {
    const swatch = WCN.swatch(h.color);
    pop.dots.forEach((d) => d.classList.toggle('on', d.dataset.color === h.color));
    pop.quote.style.setProperty('--c', swatch);
    pop.quote.textContent = WCN.displayText(h);
    pop.date.textContent = WCN.formatDate(h.createdAt);
  }

  function showPopover(h, rect, { focusNote = false } = {}) {
    ensureHost();
    hideToolbar();
    if (pop.id && pop.id !== h.id) hidePopover();
    const reopening = pop.id === h.id;
    pop.id = h.id;
    fillPopover(h);
    if (!reopening) {
      pop.textarea.value = h.note || '';
      pop.status.textContent = '';
    }
    popover.hidden = false;
    place(popover, rect, 'below');
    handlers.onPopoverToggle(h.id, true);
    if (focusNote) pop.textarea.focus({ preventScroll: true });
  }

  function flushNote() {
    clearTimeout(pop.timer);
    if (!pop.dirty || !pop.id) return;
    pop.dirty = false;
    handlers.onNote(pop.id, pop.textarea.value.trim());
    pop.status.textContent = '已保存';
  }

  function hidePopover() {
    if (!pop.id) return;
    flushNote();
    const id = pop.id;
    pop.id = null;
    popover.hidden = true;
    handlers.onPopoverToggle(id, false);
  }

  // Called when a highlight changes elsewhere (color change, another tab, the manager).
  function refreshPopover(h) {
    if (pop.id !== h.id) return;
    fillPopover(h);
    if (!pop.dirty && document.activeElement !== host) pop.textarea.value = h.note || '';
  }

  function toast(text) {
    ensureHost();
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 1800);
  }

  WCN.ui = {
    init,
    showToolbar,
    hideToolbar,
    showPopover,
    hidePopover,
    refreshPopover,
    toast,
    get popoverId() {
      return pop.id;
    },
    owns: (e) => !!host && e.composedPath().includes(host),
  };
})();
