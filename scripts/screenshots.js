// Takes the README screenshots with the real extension loaded into a throwaway Chrome
// profile (headless, via the DevTools protocol over a pipe):
//   node scripts/screenshots.js          (set CHROME=/path/to/chrome if not the default)
// Output: docs/images/{highlight,note,popup,manage}.png
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'images');
const CHROME = process.env.CHROME || {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] || 'google-chrome';
const HOST = 'blog.example.com'; // mapped to the local server, so the demo URL looks real
const DEMO_URL = `http://${HOST}/docs/demo-article.html`;

// Injected into the demo page: builds a Range for `needle` inside element #id and selects it.
const PAGE_HELPERS = `
  window.__range = (id, needle) => {
    const walker = document.createTreeWalker(document.getElementById(id), NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    for (let n; (n = walker.nextNode());) { nodes.push([n, text.length]); text += n.data; }
    const at = text.indexOf(needle);
    const pos = (off) => { let k = nodes.length - 1; while (nodes[k][1] > off) k--; return [nodes[k][0], off - nodes[k][1]]; };
    const r = document.createRange();
    r.setStart(...pos(at));
    const [en, eo] = pos(at + needle.length - 1);
    r.setEnd(en, eo + 1);
    return r;
  };
  window.__select = (id, needle) => { const s = getSelection(); s.removeAllRanges(); s.addRange(__range(id, needle)); };
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Minimal CDP client over --remote-debugging-pipe (NUL-delimited JSON on fds 3/4).
function connect(proc) {
  let nextId = 1;
  let buf = Buffer.alloc(0);
  const pending = new Map();
  const listeners = new Set();
  proc.stdio[4].on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (let i = buf.indexOf(0); i !== -1; i = buf.indexOf(0)) {
      const msg = JSON.parse(buf.subarray(0, i).toString('utf8'));
      buf = buf.subarray(i + 1);
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
      } else {
        listeners.forEach((fn) => fn(msg));
      }
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, method });
      proc.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  return { send, on: (fn) => listeners.add(fn) };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wcn-shots-'));

  // Load a copy whose manifest also grants host permissions. In real use, clicking the
  // toolbar icon grants activeTab (which lets the popup read the tab URL); a scripted
  // chrome.action.openPopup() doesn't, so the copy stands in for that click.
  const extDir = path.join(profile, 'extension');
  for (const entry of ['icons', 'src']) fs.cpSync(path.join(ROOT, entry), path.join(extDir, entry), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://*/*', 'https://*/*'];
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));
  const proc = spawn(CHROME, [
    `--user-data-dir=${profile}`,
    '--headless',
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--no-proxy-server', // host-resolver-rules don't apply to proxied requests
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${port}`,
    '--window-size=1280,800',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = connect(proc);

  try {
    const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: extDir });
    console.log('extension loaded:', extId);

    const open = async (url, { newWindow = false } = {}) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const s = (method, params) => cdp.send(method, params, sessionId);
      await s('Page.enable');
      await s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await s('Emulation.setFocusEmulationEnabled', { enabled: true });
      const { errorText } = await s('Page.navigate', { url });
      if (errorText) throw new Error(`navigating to ${url}: ${errorText}`);
      await sleep(800);
      const evaluate = async (expression) => {
        const { result, exceptionDetails } = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
        return result.value;
      };
      return { targetId, s, evaluate };
    };
    const shot = async (page, name) => {
      const { data } = await page.s('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
      console.log('saved', name);
    };
    const waitFor = async (page, expr, what) => {
      for (let i = 0; i < 50; i++) {
        if (await page.evaluate(expr)) return;
        await sleep(200);
      }
      throw new Error(`timed out waiting for ${what}`);
    };

    // The demo article, with the real content script injected by Chrome.
    const demo = await open(DEMO_URL);
    await waitFor(demo, `!!document.getElementById('wcn-ui-host')`, 'content script');
    await demo.evaluate(PAGE_HELPERS);

    // An extension page to talk to the tab through the real messaging APIs.
    const ext = await open(`chrome-extension://${extId}/src/manage/manage.html`, { newWindow: true });
    const tabId = await ext.evaluate(`chrome.tabs.query({ url: 'http://${HOST}/*' }).then(([t]) => t.id)`);
    const message = (msg) => ext.evaluate(`chrome.tabs.sendMessage(${tabId}, ${JSON.stringify(msg)})`);

    const press = async (key) => {
      await demo.s('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 });
      await demo.s('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 });
    };
    const annotate = async (id, needle, color, note) => {
      await demo.evaluate(`__select(${JSON.stringify(id)}, ${JSON.stringify(needle)})`);
      await message({ type: 'annotate', color });
      await sleep(300);
      if (note) await demo.s('Input.insertText', { text: note });
      await press('Escape'); // closes the popover, which saves the note
      await sleep(300);
    };

    await demo.evaluate(`__select('p2', '动笔的那一刻，阅读就从被动接收变成了主动思考。')`);
    await message({ type: 'highlight', color: 'yellow' });
    await sleep(300);
    await annotate('p3', '直接在原文上留下痕迹、下次打开时它们依然在那里', 'green', '这正是我想要的：笔记跟着原文走，不用来回切换软件。');
    await annotate('p4', '好的笔记不在于多，而在于能被再次找到。', 'blue', '年底回顾一下全年的高亮。');

    // Reload to prove the highlights are restored from storage, not left over in the DOM.
    await demo.s('Page.reload');
    await sleep(500);
    await waitFor(demo, `document.querySelectorAll('mark.wcn-hl').length >= 3`, 'restored highlights');
    await demo.evaluate(PAGE_HELPERS);
    console.log('restored after reload:', await demo.evaluate(`new Set([...document.querySelectorAll('mark.wcn-hl')].map(m => m.dataset.wcnId)).size`));

    // 1. Selection toolbar: a real mouse drag across a sentence.
    const drag = await demo.evaluate(`(() => {
      const rects = [...__range('p5', '慢一点，读得才会更深。').getClientRects()];
      const a = rects[0], b = rects[rects.length - 1];
      return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
    })()`);
    const mouse = (type, x, y, extra = {}) => demo.s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
    await mouse('mousePressed', drag.x1, drag.y1, { buttons: 1 });
    await mouse('mouseMoved', (drag.x1 + drag.x2) / 2, drag.y2, { buttons: 1 });
    await mouse('mouseMoved', drag.x2, drag.y2, { buttons: 1 });
    await mouse('mouseReleased', drag.x2, drag.y2, { buttons: 0 });
    await sleep(400);
    await shot(demo, 'highlight.png');

    // 2. Note popover: click an annotated highlight.
    await mouse('mousePressed', 60, 760, { buttons: 1 });
    await mouse('mouseReleased', 60, 760, { buttons: 0 });
    await sleep(200);
    const target = await demo.evaluate(`(() => {
      const r = document.querySelector('#p3 mark.wcn-hl').getClientRects()[0];
      return { x: r.left + 80, y: r.top + r.height / 2 };
    })()`);
    await mouse('mousePressed', target.x, target.y, { buttons: 1 });
    await mouse('mouseReleased', target.x, target.y, { buttons: 0 });
    await sleep(400);
    await shot(demo, 'note.png');
    await press('Escape');

    // 3. Toolbar popup. The demo tab is active in its own window, so the popup lists its notes.
    const { windowId } = await ext.evaluate(`chrome.tabs.get(${tabId})`);
    try {
      await ext.evaluate(`chrome.action.openPopup({ windowId: ${windowId} })`);
      let popup = null;
      for (let i = 0; i < 25 && !popup; i++) {
        await sleep(200);
        const { targetInfos } = await cdp.send('Target.getTargets');
        popup = targetInfos.find((t) => t.url.includes('/src/popup/popup.html'));
      }
      if (!popup) throw new Error('popup target not found');
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: popup.targetId, flatten: true });
      await sleep(500);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
      fs.writeFileSync(path.join(OUT, 'popup.png'), Buffer.from(data, 'base64'));
      console.log('saved popup.png');
    } catch (e) {
      console.warn('popup screenshot skipped:', e.message);
    }

    // 4. Manager page, with a couple of extra example pages so it isn't nearly empty.
    await ext.evaluate(`(async () => {
      const now = Date.now();
      const mk = (exact, color, note, mins) => ({ id: Math.random().toString(36).slice(2), exact, color, note,
        prefix: '', suffix: '', start: 0, end: exact.length, createdAt: now - mins * 6e4, updatedAt: now - mins * 6e4 });
      const pages = [
        { url: 'https://docs.example.com/guide/getting-started', title: '入门指南：十分钟搭建你的第一个项目', minsAgo: 90, highlights: [
          mk('先跑通最小可用版本，再逐步添加功能，比一开始就追求完美要高效得多。', 'yellow', '适用于所有新项目，贴到团队 wiki。', 95),
          mk('配置文件中的每一项都有合理的默认值，大多数情况下你不需要修改它们。', 'purple', '', 93),
          mk('遇到问题时，先查看日志中的第一条错误，后面的往往只是连锁反应。', 'pink', '调试技巧', 90) ] },
        { url: 'https://news.example.com/2026/09/remote-work', title: '远程办公五年后：我们学到了什么', minsAgo: 3000, highlights: [
          mk('异步沟通的关键不是工具，而是把上下文写清楚，让对方不需要追问就能行动。', 'green', '周会上分享这一点', 3005),
          mk('每周固定一次面对面交流，能显著降低误解和孤独感。', 'blue', '', 3000) ] },
      ];
      const items = {};
      for (const { minsAgo, ...p } of pages) items['page:' + p.url] = { ...p, createdAt: now - minsAgo * 6e4, updatedAt: now - minsAgo * 6e4, rev: 'demo' };
      await chrome.storage.local.set(items);
    })()`);
    await sleep(500);
    await ext.s('Page.reload');
    await sleep(1000);
    await shot(ext, 'manage.png');
  } finally {
    proc.kill();
    server.close();
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
