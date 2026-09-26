# WebComment 网页批注

在任意网页上高亮文字、写批注，下次打开同一网页时自动恢复。Chrome / Edge 扩展（Manifest V3），纯原生 JS，无需构建。

## 安装

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本目录（`WebComment`）

> 安装前已打开的标签页需要刷新一次才能使用。

## 使用

- **高亮**：选中文字 → 点工具栏上的色块
- **批注**：选中文字 → 点「批注」，输入内容自动保存（Ctrl+Enter 完成）
- **编辑/删除**：点击已高亮的文字，可以换颜色、改批注、复制或删除
- **右键菜单**：选中文字后右键「高亮选中文字」/「高亮并添加批注」
- **快捷键**：`Alt+Shift+H` 高亮，`Alt+Shift+N` 批注（可在 `chrome://extensions/shortcuts` 修改）
- **扩展图标弹窗**：查看当前页所有笔记，点击跳转到原文；复制为 Markdown
- **全部笔记**（弹窗里的按钮，或右键扩展图标）：搜索、按颜色筛选、编辑、导出 Markdown、备份 / 导入 JSON

## 实现要点

| 文件 | 作用 |
| --- | --- |
| `src/shared/core.js` | 存储（`chrome.storage.local`，按规范化 URL 分页存）、颜色、Markdown 导出 |
| `src/content/anchor.js` | 文本定位：把选区序列化为「全文偏移 + 原文 + 前后 32 字上下文」，恢复时按上下文打分匹配；空白变化时退回到折叠空白后的模糊匹配 |
| `src/content/highlighter.js` | 用 `<mark class="wcn-hl">` 包裹文本节点（可跨标签、跨段落） |
| `src/content/ui.js` | 划词工具栏、批注卡片，放在 closed Shadow DOM 中，不受网页 CSS / CSP 影响 |
| `src/content/content.js` | 主流程：创建、恢复、同步（多标签页/管理页修改实时生效）、页面重渲染或懒加载内容出现后自动补挂、SPA 路由切换 |
| `src/background.js` | 右键菜单、快捷键、图标角标计数 |
| `src/popup/`、`src/manage/` | 弹窗与管理页 |

URL 规范化会去掉 `#锚点` 和 `utm_*`、`fbclid` 等跟踪参数；`#/`、`#!` 形式的前端路由会保留。

## 打包发布

```bash
node scripts/pack.js   # 生成 dist/webcomment-<版本号>.zip，只包含 manifest、icons、src
```

每次发新版前先改 `manifest.json` 里的 `version`（必须比上次大）。上架商店用的文案、权限说明、截图和宣传图都在 `store/` 目录，详见 [store/listing.md](store/listing.md)；隐私政策见 [PRIVACY.md](PRIVACY.md)。

## 测试

`test/` 下是一个带 `chrome.*` 模拟的测试页，可以直接在普通网页里跑内容脚本：

```bash
node test/server.js   # 打开 http://localhost:8765/test/
```

刷新页面即模拟「再次打开」；访问 `#shifted` 可模拟网页改版（插入段落、空白变化）后的恢复。

重新生成图标：`node scripts/make-icons.js`
