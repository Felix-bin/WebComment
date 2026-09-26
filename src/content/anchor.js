// Text anchoring: converts between DOM selections and a serializable description
// (global text offsets + the quoted text with some surrounding context), and finds
// that description again when the page is reopened — even if the page has changed.
(() => {
  const WCN = globalThis.WCN;

  const CONTEXT_LEN = 32;
  const MAX_CANDIDATES = 1000;
  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'textarea', 'select', 'option',
    'svg', 'math', 'iframe', 'canvas', 'video', 'audio', 'object',
  ]);

  // Flattens every visible-ish text node under root into one string. Offsets into
  // that string are stable across our own <mark> wrapping, since wrapping only
  // splits text nodes and never changes the text itself.
  function buildIndex(root = document.body) {
    const nodes = [];
    const starts = [];
    const parts = [];
    let length = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (SKIP_TAGS.has(n.localName) || n.isContentEditable || n.id === WCN.UI_HOST_ID) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push(n);
      starts.push(length);
      parts.push(n.data);
      length += n.data.length;
    }
    return { nodes, starts, text: parts.join(''), loose: null };
  }

  // Index of the last node whose start offset is <= offset.
  function nodeAt(index, offset) {
    const { starts } = index;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function rangeToOffsets(range, index) {
    let start = -1;
    let end = -1;
    index.nodes.forEach((node, i) => {
      if (!range.intersectsNode(node)) return;
      const s = node === range.startContainer ? range.startOffset : 0;
      const e = node === range.endContainer ? range.endOffset : node.data.length;
      if (s >= e) return;
      if (start < 0) start = index.starts[i] + s;
      end = index.starts[i] + e;
    });
    if (start < 0) return null;
    const { text } = index;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return start < end ? { start, end } : null;
  }

  function describe(start, end, index) {
    const { text } = index;
    return {
      start,
      end,
      exact: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - CONTEXT_LEN), start),
      suffix: text.slice(end, end + CONTEXT_LEN),
    };
  }

  function contextScore(text, i, len, h) {
    const prefix = h.prefix || '';
    const suffix = h.suffix || '';
    let p = 0;
    while (p < prefix.length && text[i - 1 - p] === prefix[prefix.length - 1 - p]) p++;
    let s = 0;
    while (s < suffix.length && text[i + len + s] === suffix[s]) s++;
    return p + s;
  }

  // Whitespace-collapsed copy of the page text with a map back to original offsets,
  // for pages whose whitespace/line breaks changed between visits.
  function looseText(index) {
    if (index.loose) return index.loose;
    const { text } = index;
    const chars = [];
    const map = [];
    let inSpace = false;
    for (let i = 0; i < text.length; i++) {
      const isSpace = /\s/.test(text[i]);
      if (isSpace && inSpace) continue;
      chars.push(isSpace ? ' ' : text[i]);
      map.push(i);
      inSpace = isSpace;
    }
    index.loose = { text: chars.join(''), map };
    return index.loose;
  }

  function locateLoose(h, index) {
    const needle = h.exact.replace(/\s+/g, ' ').trim();
    if (!needle) return null;
    const loose = looseText(index);
    let best = null;
    let bestDist = Infinity;
    let count = 0;
    for (let i = loose.text.indexOf(needle); i !== -1 && count < MAX_CANDIDATES; i = loose.text.indexOf(needle, i + 1), count++) {
      const start = loose.map[i];
      const dist = Math.abs(start - (h.start ?? 0));
      if (dist < bestDist) {
        bestDist = dist;
        best = { start, end: loose.map[i + needle.length - 1] + 1 };
      }
    }
    return best;
  }

  // Finds the best occurrence of the quoted text: surrounding context matters most,
  // the originally recorded position breaks ties.
  function locate(h, index) {
    const { exact } = h;
    if (!exact) return null;
    const { text } = index;
    const len = exact.length;
    let best = null;
    let bestScore = -Infinity;
    let count = 0;
    for (let i = text.indexOf(exact); i !== -1 && count < MAX_CANDIDATES; i = text.indexOf(exact, i + 1), count++) {
      const score =
        contextScore(text, i, len, h) +
        (i === h.start ? 8 : 0) -
        Math.abs(i - (h.start ?? 0)) / (text.length + 1);
      if (score > bestScore) {
        bestScore = score;
        best = { start: i, end: i + len };
      }
    }
    return best || locateLoose(h, index);
  }

  WCN.anchor = { buildIndex, nodeAt, rangeToOffsets, describe, locate };
})();
