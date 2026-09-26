# 模组中心 2.0.0 正式版 — Vue 前端

独立前端工程：Vue 3 + TypeScript + Vite + Tailwind CSS。用户已明确授权引入框架，取代旧版 README 中“不新增运行时库”的限制。运行库随 ZIP 离线打包，不使用 CDN、不需要服务器。

## 使用

安装 DoLModCenter-2.0.0.mod.zip 替换旧模组中心，重启后通过原“模组中心”入口打开。请勿并装两个版本。保留 1.3.1 ZIP 便于回退。

新版主导航、本地模组列表、确认流程、搜索、详情导航由 Vue 实现；Markdown/详情渲染、拖拽、诊断、备份恢复、快照、美化 type 页面复用已有模块，尚未全部转换成 Vue 组件。通过原生存储接口执行事务，不修改存档结构。

2.0 为唯一管理界面，手机顶部导航可横向滑动。新版包不加载旧 manager-ui.js，不再创建经典外壳或提供经典切换；诊断、备份、快照等继续使用共享功能模块。初始化错误显示提示和重试入口，不自动退回旧界面。

## 构建

- `npm ci` 安装锁定依赖。
- `npm run build` 执行 TypeScript 检查并输出独立 ui.js/ui.css。
- `npm run package` 打包旧版明确声明的资产和新界面，只写当前版本 ZIP。
- `node tests/acceptance.cjs` 需要 Playwright；在仓库根目录 npm ci 安装。仅临时隔离数据库，不使用真实存档。

Tailwind 未引入 Preflight，工具类有 mc 前缀，自定义样式限定在 .dmc-next。构建不改变上游 HTML、稳定版源码或 APK。2.0 先迁移管理器，游戏主界面与战斗界面不在本次交付中。

## 备份边界

完整备份沿用 full.v2，包含存储包体及启停顺序，记录依赖的预载名称/版本；不包含存档、本体、内嵌包体、type 配置或缓存。紧急导出仍不直接恢复。

## 第三方许可

THIRD-PARTY-NOTICES.txt 包含随包携带的 Vue/Tailwind 许可。构建工具与 node_modules 不打入 ZIP。

## 架构与体积记录

- Vite 使用 library IIFE 输出，Vue 运行库编入 ui.js，生产常量在构建时替换，无 Node process 运行时依赖。
- Tailwind 仅导入 theme/utilities，未引入 Preflight；参考 https://tailwindcss.com/docs/preflight 和 https://vite.dev/guide/build.html#library-mode 。
- 2026-09-26 静态扫描上游 HTML：81,383,868 字节（约 77.6 MiB）；27 个内嵌 ZIP 的 Base64 字符串合计 27,858,192 字符。文件大不全是界面代码，本次不拆分它，也不宣称启动性能改善。
- 新前端新增 JS 约 78 KB、CSS 约 8 KB（未压缩）；最终 ZIP 携带共用功能模块，但不携带经典管理外壳。依赖锁定在 package-lock.json。

## 本轮验收

通过 TypeScript 检查和生产构建；Edge 隔离数据库 + 原生加载器 fixture 验证实际 ZIP 导入、删除、启停、Markdown 详情、键盘/合成触控排序、完整备份恢复、2.0 公共入口开关与清理、Escape 和模拟 Android backbutton。
五种 CSS 视口：390×844、844×390、1704×1136、1136×1704、1440×900；全部检查窗口边界和横向溢出，另检查各功能页手机宽度。截图为测试包，不代表真实游戏实测。
测试不访问真实游戏数据库或存档；Android APK、实际多模组游戏页面和物理触控仍待实机验收。
