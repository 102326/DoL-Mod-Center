# Mod Center 2.0 前端

这里是 DoL Mod Center 的 Vue 前端工程，使用 Vue 3、TypeScript、Vite 和 Tailwind CSS。前端负责管理器界面；存储、诊断、备份和 type 图层等共享能力通过 `mods/mod-center-v1/src/` 中的模块接入。修改共享模块时必须保持原有事务与备份边界。

运行库随模组 ZIP 提供，支持离线使用。构建工具用于开发和打包。

## 本地构建

环境要求 Node.js 22.12+、Python 3.10+。在仓库根目录执行：

```powershell
npm ci
npm --prefix frontend/mod-center ci
npm run package
```

根目录脚本会调用本目录的类型检查、生产构建和打包流程。直接在本目录调试时，也可以执行：

```powershell
npm ci
npm run typecheck
npm run build
npm run package
```

构建输出写入 `frontend/mod-center/dist/`；模组 ZIP 会复制到 `releases/mods/`。不要把 `node_modules`、游戏 HTML、存档或真实模组包加入发布包。

## 代码边界

- Vue 页面、导航和界面样式位于本目录的 `src/`。
- 共享存储、诊断、备份、快照和图层逻辑位于 `mods/mod-center-v1/src/`，保持相对路径和现有接口。
- 管理器界面、共享模块和打包流程各自保持清晰边界；不改游戏存档结构、游戏本体或 APK。
- 完整备份使用 `full.v2`：不包含存档、游戏本体、内嵌包体、type 数据库或缓存。紧急导出不可直接恢复。

## 测试

根目录 `npm test` 运行隔离的合成测试。需要浏览器验收时，先准备 Microsoft Edge 浏览器并准备本地游戏 HTML fixture：

```powershell
npx playwright install msedge
python scripts/prepare-native.py PATH_TO_GAME_HTML
node frontend/mod-center/tests/acceptance.cjs
node frontend/mod-center/tests/shell.cjs
node frontend/mod-center/tests/panels.cjs
```

fixture 只在本机生成并被 Git 忽略。浏览器测试通过只说明隔离环境行为正确，不能替代 Android 实机、物理触控或全部模组组合验收。

第三方运行库许可随包写入 `THIRD-PARTY-NOTICES.txt`。生产包不包含构建工具和 `node_modules`。
