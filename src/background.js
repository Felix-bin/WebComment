// Service worker: context menu, keyboard shortcuts and the per-tab badge count.

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'wcn-highlight', title: '高亮选中文字', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'wcn-annotate', title: '高亮并添加批注', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'wcn-manage', title: '打开批注管理', contexts: ['action'] });
  });
});

chrome.action.setBadgeBackgroundColor({ color: '#f59f00' });

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // No content script (browser page, or the tab was open before install).
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'wcn-manage') return chrome.runtime.openOptionsPage();
  if (!tab?.id) return;
  if (info.menuItemId === 'wcn-highlight') sendToTab(tab.id, { type: 'highlight' });
  if (info.menuItemId === 'wcn-annotate') sendToTab(tab.id, { type: 'annotate' });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  if (command === 'highlight-selection') sendToTab(tab.id, { type: 'highlight' });
  if (command === 'annotate-selection') sendToTab(tab.id, { type: 'annotate' });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'badge' && sender.tab?.id != null) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.count ? String(msg.count) : '' });
  }
});
