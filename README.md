# DoL Mod Center

[![Latest release](https://img.shields.io/github/v/release/102326/DoL-Mod-Center?label=release)](https://github.com/102326/DoL-Mod-Center/releases/latest)
[![License](https://img.shields.io/github/license/102326/DoL-Mod-Center)](https://github.com/102326/DoL-Mod-Center/blob/main/LICENSE)

面向 **Degrees of Lewdity ModLoader** 的本地模组管理器。在本地完成模组整理、运行诊断、配置快照，以及本地模组配置与包体的备份恢复。

> [!TIP]
> 第一次使用前，请先保留游戏存档和重要模组包的独立副本。先看[安装说明](#安装与依赖)和[备份边界](#备份边界)，再导入 ZIP。

## 目录

- [功能](#功能)
- [安装与依赖](#安装与依赖)
- [使用](#使用)
- [备份边界](#备份边界)
- [验证范围](#验证范围)
- [反馈](#反馈)
- [更新日志](#更新日志)
- [许可与链接](#许可与链接)

## 功能

- 导入、校验、更新、启用、停用、删除和导出本地 ZIP。
- 拖拽调整启用顺序，并预览基于依赖声明的排序结果。
- 查看包内版本、作者、README/Markdown、依赖和 Wiki 等资料链接。
- 识别加载器报告的预载模组，并对只读来源保持只读。
- 查看运行诊断、配置变更记录、启停名单快照和 BeautySelectorAddon 的 type 图层。
- 通过事务、并发快照检查和恢复后回读校验保护管理器数据。

## 安装与依赖

1. 从 [Latest release](https://github.com/102326/DoL-Mod-Center/releases/latest) 下载 `DoLModCenter-2.0.0.mod.zip`。
2. 确认游戏已经安装并启用 **ModLoader**。
3. 在 ModLoader 中导入 ZIP，替换同名的 DoL Mod Center，然后重启游戏。
4. 从游戏侧栏的“模组中心”入口打开管理器。

当前已验证的写入适配为 **ModLoader 2.101.1**；其他版本可能只能查看，无法安全写入。

## 使用

在“本地模组”中导入你已经取得的 ZIP，确认后再调整启停状态或加载顺序。配置变化通常需要重启游戏才会由加载器应用。详情页只读取包内资料和加载器提供的运行信息，外部链接由你主动点击打开。

备份前先让游戏完成加载，以便加载器确认预载来源。恢复前保留当前配置副本，并确保目标游戏仍提供备份所引用的预载版本。不要让其他管理器同时修改同一份配置。

## 备份边界

`DoLModCenter.full.v2` 保存本地模组 ZIP、启停名单、顺序和预载名称/版本引用。预载资源本身不在备份中，恢复时必须由目标游戏提供相同版本。

完整备份**不包含**游戏存档、游戏本体、内嵌包体、美化 type 数据库或缓存。`DoLModCenter.emergency.v1` 只尽力保留可读包体、配置摘要和诊断信息，并标记为不可恢复；它不能替代完整备份。

## 验证范围

项目包含隔离浏览器和原生加载器 fixture 测试，覆盖导入、删除、启停、排序、详情、完整备份恢复和手机、平板及 PC 的五种模拟视口。测试使用合成数据，不读取你的存档或真实游戏数据库。

这些结果不等同于 Android 实机、物理触控、任意 DoL 版本或全部模组组合的兼容证明。

## 反馈

请在 [Issues](https://github.com/102326/DoL-Mod-Center/issues) 提供管理器版本、ModLoader 版本、复现步骤和诊断摘要。请勿上传私人存档、完整备份或包含个人数据的日志。

## 更新日志

见 [UPDATE.md](https://github.com/102326/DoL-Mod-Center/blob/main/UPDATE.md)。开发者可阅读 [前端构建说明](https://github.com/102326/DoL-Mod-Center/blob/main/frontend/mod-center/README.md)。当前公开基线为 2.0.0 正式版。

## 许可与链接

代码采用 [MIT License](https://github.com/102326/DoL-Mod-Center/blob/main/LICENSE)。

- [GitHub 仓库](https://github.com/102326/DoL-Mod-Center)
- [最新发行版](https://github.com/102326/DoL-Mod-Center/releases/latest)
- [问题反馈](https://github.com/102326/DoL-Mod-Center/issues)

DoL、ModLoader 及其他第三方项目归其各自作者所有。
