> 当前改为纯 mod 交付；待导入列表使用普通文件选择，不依赖私人 APK。

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
- `market.ts` 只负责公开仓库配置、GitHub 元数据和有界下载；`MarketPanel.vue` 展示源与附件，`App.vue` 统一负责忙锁、包预检、确认和现有安装事务。联网阶段不直接写入模组数据库，不沿用网络请求开始时的旧安装 token。
- `wiki-source.ts` 从固定 MediaWiki API 获取默认发现目录，解析在惰性 template 内进行，输出纯文本名称和规范化仓库；`WikiDirectory.vue` 负责缓存展示、搜索、分页和用户选择，不能把远程 HTML 插入游戏页面。Wiki 缓存 key 与私人订阅分离。
- `market-order.ts` 保守匹配明确游戏版本声明并排序，当前版本只读取 `DMCAssistant.gameVersion(runtime)`，不读取存档。共享仓库的 Release 不套用于单条目录。
- `RepositoryReadme.vue` 复用 `DMCMarkdown.render`，不使用 `v-html`。展开才通过固定 GitHub API 读取 README，大小/编码/来源校验由 `market.ts` 执行；图片按原有规则点击后加载，Cordova 链接走系统浏览器或复制回退。
- 共享存储、诊断、备份、快照和图层逻辑位于 `mods/mod-center-v1/src/`，保持相对路径和现有接口。
- 管理器界面、共享模块和打包流程各自保持清晰边界；不改游戏存档结构、游戏本体或 APK。
- 完整备份使用 `full.v2`：不包含存档、游戏本体、内嵌包体、type 数据库或缓存。紧急导出不可直接恢复。

## 内部功能开关

`src/internal-features.ts` 的 `MARKET_ENABLED` 默认为 `false`。关闭时没有市场导航，MarketPanel 不挂载，不初始化订阅与 Wiki 缓存；旧数据不会清除。它不是用户设置，不读取 URL、localStorage 或 window 开关。开发者修改常量后需重新构建。

市场 UI 测试（market.cjs、wiki-market.cjs、batch-market.cjs）仅适用于内部启用市场的构建；默认构建运行 `node frontend/mod-center/tests/market-disabled.cjs`。服务层市场单元测试仍由 `npm test` 覆盖。

## 测试

根目录 `npm test` 运行隔离的合成测试。需要浏览器验收时，先准备 Microsoft Edge 浏览器并准备本地游戏 HTML fixture：

```powershell
npx playwright install msedge
python scripts/prepare-native.py PATH_TO_GAME_HTML
node frontend/mod-center/tests/acceptance.cjs
node frontend/mod-center/tests/shell.cjs
node frontend/mod-center/tests/panels.cjs
node frontend/mod-center/tests/market-service.cjs
node frontend/mod-center/tests/wiki-source.cjs
node frontend/mod-center/tests/market-disabled.cjs
node frontend/mod-center/tests/local-library-ui.cjs
node frontend/mod-center/tests/two-page-storage.cjs
```

市场服务测试使用模拟 HTTP 响应，市场浏览器测试通过 Playwright 路由和合成 ZIP 覆盖网络与安装流程。它们不能证明真实 GitHub 附件在 Android WebView 中可跨域下载。真实网络结果与验收边界见 [2.3.0 验证记录](../../docs/VALIDATION-2.3.0.md)。

默认 Wiki 目录测试使用原创合成表格与模拟 API。真实页面结构检查只保留修订号和计数，不将 Wiki 原文加入测试或发布包；本轮详情见 [2.3.0 验证记录](../../docs/VALIDATION-2.3.0.md)。

fixture 只在本机生成并被 Git 忽略。浏览器测试通过只说明隔离环境行为正确，不能替代 Android 实机、物理触控或全部模组组合验收。

第三方运行库许可随包写入 `THIRD-PARTY-NOTICES.txt`。生产包不包含构建工具和 `node_modules`。
