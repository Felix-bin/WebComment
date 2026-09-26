// Minimal chrome.* mock so the content scripts can run in a plain page for testing.
// Storage persists in localStorage, so reloading the page simulates "reopening" it.
(() => {
  const KEY = '__wcn_mock_storage__';
  const read = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const write = (data) => localStorage.setItem(KEY, JSON.stringify(data));
  const listeners = [];
  const emit = (changes) => setTimeout(() => listeners.forEach((fn) => fn(changes, 'local')), 0);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  globalThis.__wcnMessages = [];
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const all = read();
          if (keys == null) return all;
          const out = {};
          for (const k of [].concat(keys)) if (k in all) out[k] = all[k];
          return out;
        },
        async set(items) {
          const all = read();
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: clone(all[k]), newValue: clone(v) };
            all[k] = clone(v);
          }
          write(all);
          emit(changes);
        },
        async remove(keys) {
          const all = read();
          const changes = {};
          for (const k of [].concat(keys)) {
            if (k in all) changes[k] = { oldValue: all[k] };
            delete all[k];
          }
          write(all);
          emit(changes);
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: {
      sendMessage: async (msg) => { globalThis.__wcnMessages.push(msg); },
      onMessage: { addListener: (fn) => (globalThis.__wcnOnMessage = fn) },
    },
  };
  // Test helper: deliver a message as if it came from the popup/background.
  globalThis.__wcnSend = (msg) => new Promise((resolve) => {
    const ret = globalThis.__wcnOnMessage(msg, {}, resolve);
    if (ret !== true) setTimeout(() => resolve(undefined), 50);
  });
  // Test helper: simulate another context (popup/manager) writing storage.
  globalThis.__wcnExternalSet = (items) => globalThis.chrome.storage.local.set(items);
})();
