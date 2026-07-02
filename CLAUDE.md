# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目是什么

agentText 输入台：给 CLI agent（Claude Code 等）用的本地「提示词草稿台」。在浏览器里编辑（贴截图、拖文件、路径高亮），一键复制出纯文本粘进终端。单用户、本地工具，无测试框架、无 lint 配置。

## 常用命令

```bash
./start.sh              # 一键启动：装依赖(首次) + 增量构建 + 后台起服务 + 开浏览器
./start.sh stop|restart|status
npm run dev             # 开发模式：server(7777) + vite(5173，代理 /api /assets)，开 5173
npm run build           # 构建前端到 web/dist（start.sh 会按 mtime 自动增量构建）
npm start               # 仅启动服务（生产模式，7777 直接服务 web/dist）
npm run app             # Electron 开发形态：起窗口 + 内嵌 server（端口已有服务则复用）
npm run dist            # electron-builder 打 Windows portable exe（免签名免安装器）
```

- `NO_BROWSER=1`、`PORT=xxxx` 可作用于 start.sh；日志在 `data/server.log`。
- `AGENT_TEXT_ROOT`：数据根（`assets/`、`data/` 的父目录），server 和 Electron 都读它。不设时 = 项目根（行为同以前）；Electron 打包后默认 `~/agentText`。`web/dist` 始终随应用走（相对 `__dirname`），不受它影响。
- 验证改动：`npm run build` 通过 + `curl localhost:7777/api/cards`、`POST /api/upload` 冒烟；UI 可用 lightpanda 加载页面查渲染和 console 报错（粘贴/剪贴板交互无法无头验证）。

## 核心设计约束（改动前必读）

**CLI agent 只吃纯文本，但它能读文件。** 所以图片/文件不进剪贴板，而是 `POST /api/upload` 落盘为 WSL 绝对路径（`assets/<日期>/<内容hash>.<ext>`，hash 命名天然去重），编辑器里以 chip 展示，**复制时序列化为绝对路径文本**。这条链路是整个工具的存在理由，任何改动不能破坏「复制出来的文本可被 agent 直接消化」。

## 架构

两个进程，无框架后端 + Vue 前端：

- `server/index.mjs`（Express 单文件）：`POST /api/upload`（raw body 直传，非 multipart）、`GET/PUT/POST /api/cards`（整表读写 `data/cards.json`，原子写 tmp+rename；POST 是 sendBeacon 兜底别名，关页面前防丢）、静态服务 `/assets` 和 `web/dist`（dist 不存在则只提示走 dev 模式）。
- `web/src/`（Vite + Vue 3 + Tiptap v2）：`App.vue` 管卡片列表（排序=置顶优先+时间倒序，600ms 防抖整表保存）；`components/Card.vue` 每张卡一个独立 Tiptap Editor 实例，粘贴/拖拽文件在 `editorProps.handlePaste/handleDrop` 拦截后上传。

### 编辑器三件套（web/src/editor/）

- `assetChip.js`：行内 atom 节点（不可拆分，一次退格整体删除）。attrs 为 `{path, url, name, mime}`——`path` 是 WSL 绝对路径（序列化用），`url` 是 `/assets/...`（缩略图显示用），两者勿混。
- `pathHighlight.js`：**纯 decoration 高亮**（不是 mark、不改文档），路径仍是普通文本，序列化原样输出。改路径识别规则只动这里的 `PATH_RE`。
- `serialize.js`：`serializeText(editor)` 是唯一的「编辑器 → 剪贴板文本」出口，assetChip → 两侧补空格的绝对路径（防与中文粘连）。复制、字数统计、持久化的 text 字段都走它。

StarterKit 刻意关掉了所有富文本节点/mark（heading/bold/list 等），保持输出是可预期的纯文本——不要加回来。

### 数据模型

卡片存 Tiptap JSON（`doc`）+ 序列化文本（`text`）双份：`{id, createdAt, pinned, doc, text}`。`doc` 用于回显编辑，`text` 用于预览/判空。

### 路径双风格（Win ⇄ WSL）

文件只落一份在 Windows 盘上，chip 存**原生格式**（新数据 `C:\...`，旧数据 `/mnt/c/...` 无需迁移）。序列化时在唯一出口按目标风格做纯字符串转换——用户的 Claude Code 可能跑在 Windows 或 WSL 任一侧。

- `web/src/editor/pathStyle.js`：`toWin`/`toWsl` 纯函数，都能识别两种输入形式，转不了的（`/home/...`、相对路径）原样返回，所以无需归一。
- `serializeText(editor, style)`：`style` 为 `'win'|'wsl'`，是文件路径转换的唯一出口。
- `web/src/pathStyleStore.js`：全局 `pathStyle` ref，localStorage 持久化（key `agentText.pathStyle`），App.vue 顶栏 Win/WSL 开关切换。切换时 Card.vue watch 会重算字数并回写 `text`。
- `pathHighlight.js` 的 `PATH_RE` 同时认 `C:\...`、`C:/...` 和 Unix 路径。

### Electron 壳（electron/main.mjs，ESM 主进程）

`app.isPackaged` 决定数据根默认值（`~/agentText`）；启动前先探测 7777 端口有无现成 server，有则复用、没有才 `import('../server/index.mjs')`（import 即 listen）。关闭按钮隐藏到托盘保活，托盘「退出」先 `win.close()` 给 pagehide 的 sendBeacon 兜底保存留时间再 `app.quit()`。单实例锁二次启动聚焦已有窗口。electron-builder 配置在 package.json `build` 字段：win portable 目标，files 白名单只含 `electron/`、`server/`、`web/dist/`、`package.json`——**绝不打包 `assets/`、`data/`（用户数据）**。图标（exe/窗口/托盘/favicon 同款设计）由 `node scripts/gen-icon.mjs` 再生（零依赖手写 PNG/ICO 编码），产出进 git 的 `electron/icon.ico|icon.png|tray.png`。

## 陷阱

- node 是 nvm 装的；start.sh 在裸环境（Windows 快捷方式/cron）会自动 source nvm，新脚本注意同样问题。
- start.sh 用了 `set -euo pipefail`：grep/管道「无匹配」返回非零会静默中断脚本，查询类函数要 `|| true` 兜底（server_pid 已踩过这个坑）。
- `assets/` 和 `data/` 是用户数据（已 gitignore），清理/测试时不要动真实内容；测试上传后记得删掉测试文件。
