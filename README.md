# agentText 输入台

给 CLI agent（Claude Code 等）用的本地「提示词草稿台」：在浏览器里舒服地编辑，
截图直接粘贴、文件直接拖入（自动落盘为 WSL 绝对路径），一键复制纯文本，粘进终端。

## 日常使用（一键启动）

```bash
./start.sh            # 自动装依赖/增量构建/后台启动，并打开浏览器
./start.sh stop       # 停止
./start.sh restart    # 重启
./start.sh status     # 查看状态
```

- `NO_BROWSER=1 ./start.sh`：启动但不打开浏览器
- `PORT=8888 ./start.sh`：换端口
- 日志在 `data/server.log`
- Windows 侧一键：把 `start.bat`（或其快捷方式）放到桌面双击

手动方式（等价）：

```bash
npm run build   # 只需在前端代码变更后执行一次
npm start       # 打开 http://localhost:7777
```

## 开发模式

```bash
npm run dev     # server(7777) + vite(5173)，打开 http://localhost:5173
```

## 数据位置

- 图片/文件落盘：`assets/<日期>/<内容hash>.<ext>`（复制出来的就是这个绝对路径）
- 卡片历史：`data/cards.json`

## 快捷键

- `Ctrl+Enter`：复制当前卡片
