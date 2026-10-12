# quick-chat

基于 Electron + React + TypeScript + Vite 的桌面聊天应用。

## 开发

```bash
npm install
npm run dev            # 启动 Electron + Vite dev server（端口 1420）
npm run dev:fresh      # 使用隔离的开发数据库（启动时清空）
npm run dev:web        # 仅浏览器模式（无桌面能力：DB/快捷键等桥命令不可用）
npm run build          # 打包（build:web + build:electron-main + electron-builder）
npm test               # node --test tests/*.test.mjs
```

主进程代码在 `electron/`（TypeScript，编译到 `electron-dist/`），渲染进程
在 `src/`。两者通过 preload 桥 `window.__QC_BRIDGE__` 通信
（`src/services/bridge.ts`）。

## 打包发布

```bash
npm run build              # 等价于 build:web + build:electron-main + electron-builder
npx electron-builder --dir # 只出 unpacked 目录（release/linux-unpacked/）
npx electron-builder --linux AppImage deb rpm
npx electron-builder --win nsis
```

配置在 `package.json` 的 `build` 字段（appId `com.quickchat.app`，Linux 图标
`electron/assets/icon.png` 512×512）。托盘图标 `electron/assets/tray-icon.png`
由 `build:electron-main` 拷入 `electron-dist/assets/` 随包分发。
`parse_document` 依赖系统 Python（pdfplumber / python-docx），不随包分发。

CI（`.github/workflows/release.yml`）：push 到 main 跑测试与编译检查；
打 `v*` tag 时并行构建 Linux（AppImage/deb/rpm）、Windows（NSIS）、
Arch（`archlinux/PKGBUILD` 出 pkg.tar.zst）并发布 GitHub Release。

## 数据

- SQLite：`app.getPath('userData')/quick_chat.db`（WAL），由主进程
  better-sqlite3 持有，前端经 `sql:execute` / `sql:select` 桥命令直接执行 SQL。
- Skill：`~/.chat/skills/`（兼容导入 `~/.claude/skills`、`~/.codex/skills`）。
