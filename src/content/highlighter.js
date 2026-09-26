// Wraps/unwraps text ranges in <mark class="wcn-hl"> elements.
(() => {
  const WCN = globalThis.WCN;

  const SELECTOR = 'mark.wcn-hl';
  // Whitespace text nodes directly inside these can't hold an inline element.
  const NO_INLINE_PARENT = new Set([
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'ul', 'ol', 'dl', 'select', 'optgroup', 'datalist',
  ]);

  function decorate(el, h) {
    el.dataset.wcnColor = h.color;
    if (h.note) {
      el.dataset.wcnNote = '';
      el.title = h.note;
    } else {
      delete el.dataset.wcnNote;
      el.removeAttribute('title');
    }
  }

  function wrap(h, start, end, index) {
    const { nodes, starts } = index;
    const targets = [];
    for (let i = WCN.anchor.nodeAt(index, start); i < nodes.length && starts[i] < end; i++) {
      const node = nodes[i];
      const s = Math.max(start - starts[i], 0);
      const e = Math.min(end - starts[i], node.data.length);
      if (s >= e) continue;
      if (!node.data.slice(s, e).trim() && NO_INLINE_PARENT.has(node.parentNode?.localName)) continue;
      targets.push({ node, s, e });
    }

    const els = targets.map(({ node, s, e }) => {
      let target = node;
      if (e < target.data.length) target.splitText(e);
      if (s > 0) target = target.splitText(s);
      const el = document.createElement('mark');
      el.className = 'wcn-hl';
      el.dataset.wcnId = h.id;
      decorate(el, h);
      target.parentNode.insertBefore(el, target);
      el.appendChild(target);
      return el;
    });

    if (els.length) {
      els[0].classList.add('wcn-first');
      els[els.length - 1].classList.add('wcn-last');
    }
    return els;
  }

  function unwrap(els) {
    for (const el of els) {
      const parent = el.parentNode;
      if (!parent) continue;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }
  }

  function flash(els) {
    for (const el of els) {
      el.classList.remove('wcn-flash');
      void el.offsetWidth; // restart the animation
      el.classList.add('wcn-flash');
    }
    setTimeout(() => els.forEach((el) => el.classList.remove('wcn-flash')), 2000);
  }

  WCN.hl = { SELECTOR, wrap, unwrap, decorate, flash };
})();
