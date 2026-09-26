# DoL Mod Center / 模组中心

面向 DoL ModLoader 的本地模组管理工具：离线管理、运行诊断、配置快照、备份恢复。没有在线市场，不自动下载模组。

## 下载与安装

推荐使用 [2.0 正式版](https://github.com/102326/DoL-Mod-Center/releases/tag/v2.0.0)。从本仓库 Releases 下载 ZIP，通过现有游戏的 ModLoader 导入，替换旧版同名 DoLModCenter 后重启。不要并装两版管理器。推荐在修改模组前单独导出游戏存档。

- **1.3.1 历史版**：保留下载供外部回退，不再作为新版内置界面。
- **2.0.0**：正式版统一诊断与美化图层的炭黑淡紫样式，移除默认标语和侧栏离线注释。2.0 成为唯一管理界面，移除经典界面入口及自动回退；诊断、备份等继续复用共享模块。界面初始化失败时显示错误提示并允许重试，不自动修改配置或重启游戏。

需要游戏已有 ModLoader，不依赖 maplebirch 或 ModHub。当前存储写入适配仅对已验证的 **ModLoader 2.101.1** 开放；其他版本可能只读。不要将本项目视为任意游戏版本/模组组合的兼容保证。

## 功能与边界

- 导入、校验、更新、启停、删除、导出本地 ZIP；拖拽排序；依赖排序预览。
- 预载来源识别、包内 README/Markdown、作者和 Wiki 信息链接。
- 运行诊断、配置变更记录、名单快照、美化 type 图层管理。
- 存储变更使用事务及并发快照校验；完整恢复包含校验与提交后回读。
- `full.v2` 完整备份包含存储 ZIP、启停顺序及预载版本引用。**不包含游戏存档、本体、内嵌包体、type 数据库或缓存**；预载需目标游戏提供相应版本。
- 紧急导出尽力保留可读数据，不能直接作为完整恢复文件。
- 普通模组 ZIP 在加载后提供入口，不会自动给 APK 添加启动前救援功能。

## 源码与构建

仓库只包含本工具源码与合成测试，不包含游戏、第三方内容模组、用户存档或签名材料。

环境：Node.js 22.12+、npm、Python 3.10+。经典版使用 JavaScript/CSS，Vue 前端使用 TypeScript/Vite/Tailwind；Python 只负责打包，不参与游戏运行。运行库离线随包携带。

```sh
# 经典版
python mods/mod-center-v1/build.py
# Vue 正式版
cd frontend/mod-center
npm ci
npm run package
```

经典包位于 `mods/mod-center-v1/dist/`，Vue 包位于 `frontend/mod-center/dist/` 及 `releases/mods/`。

## 测试

在仓库根目录 `npm ci`，然后 `npx playwright install msedge`（或使用已有 Microsoft Edge）。`npm test` 运行合成存储/元数据/诊断等基础测试，数据库与实际游戏隔离。

原生加载器测试需要自己提供本地游戏 HTML，提取的 fixture 已被 Git 忽略，不随项目分发：

```sh
python scripts/prepare-native.py PATH_TO_GAME_HTML
node mods/mod-center-v1/tests/native-backup.test.cjs
# 先构建 Vue 前端
node frontend/mod-center/tests/acceptance.cjs
```

浏览器自动化通过不等于真实 Android 物理触控或所有模组组合通过。报告问题请提供版本、复现步骤与诊断摘要，勿在公开 issue 上传私人存档或完整备份。

## 许可与来源

本项目代码采用 MIT，详见 LICENSE；诊断模块源自本项目此前的 DoLWorkbench / DoLDiagnostics。Vue/Tailwind 等依赖各自许可保留在打包后的 THIRD-PARTY-NOTICES.txt。运行时调用游戏/加载器提供的接口，其实现不在本仓库分发。本包不含 ModHub 或 NeoUI 源码。
