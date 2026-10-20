# PRTS Spine 素材兼容性修复技术方案

**状态：已实施于 v101；本文保留为设计与验收依据**
**基线：v97 / 提交 `01f5b47`**
**目标：修复“下载并应用干员组合后桌宠空白”，并防止后续 PRTS Spine 资源版本变动再次把不可播放素材设为当前组合。**

## 1. 问题摘要

v97 已修复 PRTS `/spine` 渲染页面中的 HTML 不是有效 JSON 导致的查询失败。但在当前 PRTS 静态目录中，银灰默认“基建”模型下载完成并应用后，桌宠窗口只保留控制栏，角色区域空白。

本问题不是下载未完成、文件损坏、组合未保存或透明窗口失焦：三件套已落盘，Profile 已原子导入，左右槽位也已指向该 Profile。故障发生在 **导入后的 Spine 运行时兼容性阶段**。

## 2. 已确认事实与根因

### 2.1 现场证据

本机诊断记录确认了如下事件顺序：

1. `prts-download-success`：银灰默认 Profile 下载与导入成功。
2. `profiles-selected`：左右槽位均已选择该 Profile。
3. `transparent-spine-load-success`：画布与资源加载调用没有抛异常。
4. `availableAnimations: []`：运行时读取到的动画列表为空。
5. `profile-runtime-validated`：`Move`、`Relax` 被标记为缺失，Profile 判为 `incompatible`。
6. `spine-animation-unavailable`：行为引擎每次请求 `Relax` 或 `Move` 都无法播放。
7. `profile-spine-unavailable`：PRTS Profile 没有独立的 APNG/WebM 降级资源，因此角色区域为空白。

下载到的文件本身不是空文件：`model.skel`、`model.atlas` 和 atlas 引用的 PNG 均存在且格式正确。

### 2.2 版本不兼容

当前下载的银灰默认 `model.skel` 二进制头包含 Spine 版本标记 **`3.5.51D`**；项目内置的 `prts-spine-runtime.js` 与已验收的本地银灰回归素材使用 **Spine 3.8**（回归素材头部为 `3.8.99`）。

内置运行时对该 3.5 二进制没有可靠地抛出格式错误，而是构建出没有动画的 skeleton；现有 renderer 误将“没有异常”视为“加载成功”。这造成了“加载成功 + 空动画列表”的假成功状态。

### 2.3 来源选择缺陷

`src/main/prts-provider.js` 会从当前静态目录和 legacy `torappu.prts.wiki` metadata 合并时装组：

- 静态目录先写入时装名称；
- legacy 目录只有在该名称不存在时才补充；
- 同名时装（例如“默认”）永远选择静态目录版本。

这项规则曾假设静态目录总是可由内置运行时播放。当前 PRTS 把同名模型替换为 3.5 Skeleton 后，该假设失效；同路径 `spine38` 可提供可播放的 3.8 版本，而 legacy 仅作为时装组补充来源。

## 3. 修复目标与非目标

### 3.1 目标

- 任何被设为活动左右角色的 PRTS Profile，必须实际包含可播放的 `Move` 与 `Relax`。
- 同一时装有多个来源时，保留候选来源，并在不兼容时自动回退，而不是按名称永久丢弃候选。
- 对版本不兼容、动画缺失、atlas/纹理失配提供明确中文提示与可诊断事件。
- 下载失败或候选资源不兼容时，继续使用之前已验证的左右组合；不得把不可用 Profile 原子替换为活动组合。
- 保留 `assets/`、`prts-assets/`、`processed-assets/` 和 `src/renderer/black-key-fallback.js`；不删除用户 Profile、设置或诊断记录。

### 3.2 非目标

- 本轮不替换或升级 `prts-spine-runtime.js`，不承诺直接支持 Spine 2.5。
- 本轮不把角色素材内置到生产包。
- 本轮不将任意 PRTS URL 交给 renderer；下载 URL 仍须由受限 PRTS 提供器生成。
- 本轮不以硬编码干员 ID 或硬编码“默认”资源路径替代来源解析。

## 4. 设计原则

1. **可播放性高于 HTTP 成功。** 三个文件都返回 200 不代表模型能在本应用运行时播放。
2. **验证在激活前完成。** Profile 成功导入不等于可成为活动角色。
3. **候选来源不可丢失。** 同名时装是一个逻辑选项，可对应多个来源候选。
4. **回退必须可解释。** UI、诊断和测试都应记录实际选择的来源、Skeleton 版本与失败原因。
5. **不以 HTML 作为机器格式。** 模型 catalog 仍优先使用 PRTS raw 页面；渲染页、legacy metadata 仅作为受控回退。

## 5. 目标数据模型

### 5.1 Catalog 内部表示

将现有单一 `outfit`：

```js
{ name, build, prefix }
```

扩展为逻辑时装和候选模型：

```js
{
  name: '默认',
  candidates: [
    {
      source: 'static',
      prefix: 'https://static.prts.wiki/spine/',
      build: 'char/char_172_svrash/build_char_172_svrash/build_char_172_svrash'
    },
    {
      source: 'legacy',
      prefix: 'https://torappu.prts.wiki/assets/char_spine/char_172_svrash/',
      build: 'defaultskin/build/build_char_172_svrash'
    }
  ]
}
```

`lookup()` 对 UI 仍只返回时装名称，避免改变选择界面；`createDownloadPlan()` 返回按优先级排列的候选下载计划，而非提前销毁其中一个来源。

### 5.2 已导入 Profile 元数据

成功验证后在 `profile.json` 保存不可变的来源与验证信息：

```json
{
  "provider": "prts",
  "source": {
    "kind": "legacy",
    "catalog": "torappu.prts.wiki",
    "build": "defaultskin/build/build_char_172_svrash"
  },
  "runtimeValidation": {
    "runtime": "spine-3.8",
    "skeletonVersion": "3.8.99",
    "availableAnimations": ["Relax", "Move", "Sit", "Sleep", "Interact"],
    "validatedAt": "<ISO-8601>"
  }
}
```

这些字段仅记录公开资源和技术元数据；不得写入 Cookie、令牌、完整用户路径或其他凭据。

## 6. 实施方案

### 6.1 PRTS Provider：保留同名候选

修改 `mergeMetaOutfits()`，使它合并为候选列表而非“静态来源覆盖 legacy 来源”。

候选排序建议如下：

1. 当前 static `spine` / `spine38` 来源；
2. legacy metadata 来源；
3. 未来新增的已验证受限来源。

排序只代表尝试顺序，**不代表无条件采用**。候选的 URL 仍必须通过现有 HTTPS、允许 host、目录与文件名校验。

### 6.2 下载管理器：候选逐个下载和校验

`AssetDownloadManager` 新增“候选尝试”边界：

1. 在临时目录下载某一个候选的 `.skel/.atlas/.png`。
2. 保留现有长度、文件类型、PNG 文件头、atlas 纹理文件名和原子导入检查。
3. 对该临时目录执行 Spine 可播放性验证。
4. 验证通过才写入正式 Profile 目录；失败则删除**仅本次临时目录**，记录失败原因并尝试下一个候选。
5. 全部候选失败时，不创建新 Profile、不改活动组合，向 UI 返回候选摘要。

取消请求必须立即停止后续候选尝试，并沿用现有“无残留临时目录”的取消语义。

### 6.3 Spine 可播放性验证器

新增主进程服务（建议 `src/main/profile-runtime-validator.js`），通过一个隐藏、隔离的 `BrowserWindow` 加载与实际 renderer 相同的 `prts-spine-runtime.js`。

输入：临时 Profile 路径和模型文件相对路径。
输出：

```js
{
  ok: true,
  skeletonVersion: '3.8.99',
  availableAnimations: ['Relax', 'Move', 'Sit', 'Sleep', 'Interact'],
  compatibility: 'complete' // complete | basic | incompatible
}
```

判定规则：

| 条件 | 结果 |
| --- | --- |
| 运行时异常、atlas 不能读、纹理不匹配 | `incompatible` |
| `Move` 或 `Relax` 缺失 | `incompatible` |
| `Move`、`Relax` 存在，任一可选动作缺失 | `basic` |
| 五个语义动作都存在 | `complete` |

不要仅通过二进制头的版本字符串判定兼容性：它可作为诊断字段和快速拒绝提示，但真正的准入标准必须是与生产 renderer 相同运行时读取出的动作列表。

### 6.4 Renderer：消除“假成功”状态

修改 `ensureSpineRenderer()` 的成功条件：

```text
资源可加载 AND availableAnimations 包含 Move AND Relax
```

如果 `availableAnimations` 为空或缺少必需动作：

- 不设置 `data-renderer="transparent-spine"`；
- 清理刚创建的 canvas/player；
- 触发明确的 `transparent-spine-incompatible` 诊断；
- 若存在独立 APNG/WebM 资源，走现有降级链；
- 对 PRTS 下载 Profile（通常没有独立降级资源），显示可理解的状态，而非保持空白画布。

这层是防御性保护；主准入仍应在下载/导入阶段完成。

### 6.5 组合应用的事务边界

当前组合只有在两侧 Profile 均通过已保存的 `runtimeValidation` 时才可持久化为 `active-pair.json`。

- 新 Profile 验证失败：保留此前 `active-pair.json`。
- 已有的旧 Profile 缺少验证信息：首次选择时即时验证；失败则拒绝应用并保留旧组合。
- 首次启动没有可用 Profile：保持配置模式，但显示“没有可播放的基建模型”，不能进入无提示空白桌宠状态。

## 7. 用户界面与诊断

### 7.1 用户可见文案

禁止将该问题显示为泛化的“下载失败”或“干员不存在”。推荐文案：

```text
已下载素材，但其 Spine 版本或动画不兼容当前桌宠，未应用新组合。
已保留原来的角色组合。可重试或选择另一套时装。
```

如果存在候选回退并成功：

```text
首选素材不兼容，已自动切换到兼容来源并完成应用。
```

### 7.2 新增脱敏诊断事件

建议事件：

- `prts-candidate-download-started`
- `prts-candidate-runtime-validation-failed`
- `prts-candidate-runtime-validation-passed`
- `prts-candidate-fallback-selected`
- `transparent-spine-incompatible`
- `profile-activation-rejected-incompatible`

允许记录：公开 host、来源类型、时装名、文件大小、Skeleton 版本、动画名列表、失败分类。
禁止记录：令牌、Cookie、授权头、完整用户目录、任意本地素材内容。

## 8. 自动化测试计划

先新增失败测试，再写修复代码。

### 8.1 Provider 单元测试

- 同名“默认”时装的 static 与 legacy metadata 必须均保留为候选。
- static 仅有的时装仍可生成唯一候选。
- legacy 仅有的时装仍可生成唯一候选。
- URL allowlist、文件名校验、raw 页面回退不可回归。

### 8.2 下载与事务测试

- 候选 A 下载成功但运行时验证失败，候选 B 通过：最终只导入 B。
- 所有候选不兼容：没有新 Profile、活动组合原样保留。
- 取消发生在候选 A/B 间：不开始 B，临时目录清理干净。
- 验证失败不会覆盖同 ID 的既有可用 Profile。

### 8.3 真实 Spine 运行时回归

测试必须通过实际 `prts-spine-runtime.js` 执行，而不是只检查 HTTP 状态、文件扩展名或 `meta.json`：

- 已验收的 3.8 银灰回归素材：动作列表至少包含 `Move` 与 `Relax`。
- 当前 PRTS static 2.5 样本：应返回 `incompatible`，绝不可报告成功。
- legacy 3.8 样本：应返回可用动作列表。
- `spine38` 样本仍应保持原有结果。

### 8.4 端到端回归

1. 在隔离 user-data 中下载银灰默认。
2. 如 static 不兼容，确认自动选择兼容 legacy 候选。
3. 将其设为左右组合，重启后验证两槽都显示并有 `Move`/`Relax`。
4. 在故意不兼容的候选下，确认旧组合仍可见，控制面板布局保持三行两项：
   - 暂停/恢复自动行动｜开启/关闭专注模式
   - 恢复默认设置｜反馈问题
   - 更换干员｜退出桌宠
5. 验证诊断 ZIP 的脱敏规则未回归。

## 9. 发布与迁移要求

- 调试阶段：设置新的 `PET_RELEASE_DIR`，设置 `PET_SKIP_ARCHIVES=1`，仅输出新的 portable 文件夹。
- 不覆盖 `v97-portable.zip`、任何历史 `release-v*`、用户素材、用户设置或诊断记录。
- 只有在单元、下载、Profile、诊断、PRTS 合约和真实 GUI 回归全部通过后，才创建新的 ZIP 或正式发布物。
- 新版本首次启动应对旧 Profile 做延迟兼容性检查；验证失败只禁止激活，不删除目录，便于用户保留素材和诊断证据。

## 10. 验收标准

本修复完成的最低标准：

1. 当前 PRTS static 返回 3.5 Skeleton 时，应用不会进入空白桌宠状态。
2. 有兼容 legacy 候选时，下载器自动回退并显示角色。
3. 没有兼容候选时，用户得到明确错误，旧组合不被破坏。
4. `availableAnimations: []` 永远不能被记录为可用 Spine Profile。
5. v97 已验收的 PRTS raw 回退、下载取消、诊断 ZIP 脱敏、左右组合重启恢复和控制面板布局均无回归。
