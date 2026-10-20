# v101 发布门禁记录（2026-10-20）

## 版本与范围

- 对外版本：`v101`；应用内部版本：`0.1.1`。
- 回归基线：Git `01f5b47` / 标签 `v97`。
- 本轮修复 PRTS 新干员解析、下载后空白桌宠、Spine 皮肤回退，以及重复下载的同 ID 素材包保护。
- 安装包不内置角色素材，也不包含用户设置、诊断记录或审计临时数据。

## 已完成的发布门禁

| 检查 | 结果 |
| --- | --- |
| 素材档案、左右组合与旧版恢复测试 | 通过 |
| PRTS Provider 单元测试 | 通过 |
| 下载管理器测试 | 通过 |
| 诊断 ZIP 脱敏测试 | 通过 |
| Spine 兼容性与皮肤选择测试 | 通过 |
| PRTS 审计辅助脚本测试 | 通过 |
| 源码语法检查与 `git diff --check` | 通过 |
| PRTS 实网契约 | 通过：银灰的默认、约克的寒风、探寻者 SKm01、不融冰 |
| 专项实际渲染复核 | 通过：银灰素材下载、双角色应用、重启恢复；以及此前失败的洛洛、流明、埃拉托、海蒂、黑键、寻澜逐项复核 |

曾运行的全表网络审计不作为本次最终发布门禁：其早期 6 条失败已定位为重叠审计进程造成的临时目录竞争，逐条隔离复核后均通过；随后从零开始的隔离审计已完成 290 项且为 0 失败。基于发布方要求避免继续耗时的重复网络扫描，此处停止该审计，改以上述可重复的自动化测试和实网契约作为最小门禁。

## 构建物核验

- 新目录：`release-v101-final-2026-10-20/`（构建前确认不存在，因此没有覆盖旧发布目录）。
- `明日方舟基建桌宠-portable.zip`：包含 `明日方舟基建桌宠-portable\\ArknightsBasePet.exe` 与 `resources\\app\\package.json`；不含 `assets/`、`prts-assets/`、`processed-assets/`。
- `完整安装包.zip`：包含 `完整安装包\\Install-ArknightsBasePet.cmd`、`install.ps1`、`pet.zip` 与安装说明。
- portable ZIP SHA-256：`22300D2C41DBB371627A5A9997D5AA0694B9201990A45A81A7AD64198E90BACD`。
- 完整安装包 SHA-256：`EA9EB5EB735AAE690850B24B8F96307C379AB6ED544B539D23F4197722F90492`。
- `ArknightsBasePet.exe` SHA-256：`62C62D170A95AA4A3EB3DF05F0D56A3654AB4344F7452E21DEA1334AFED7100F`。

## 使用方式

- 推荐下载 `完整安装包.zip`，解压后双击 `Install-ArknightsBasePet.cmd`。
- 也可下载 `明日方舟基建桌宠-portable.zip`，解压后直接运行 `ArknightsBasePet.exe`。
- 安装与运行不会覆盖 `%APPDATA%\\arknights-base-desktop-pet` 中已有的用户素材、设置或诊断记录。
