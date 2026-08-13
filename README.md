# 明日方舟基建桌宠

银灰与灵知同屏成对出现的 Windows Electron 桌宠。项目使用明日方舟基建动作资源：优先加载本地 PRTS 透明 Spine 素材，透明 APNG 作为第一降级，原始黑底 WebM 的运行时抠黑方案作为最后降级。

> 这是非官方个人项目。公开发布源码时，请不要直接提交角色素材，除非你确认自己拥有再分发授权。素材目录和文件清单见 `ASSETS.md`。

## 功能

- 银灰与灵知固定成对出现，使用 Move、Relax、Sit、Sleep、Interact 等基建动作。
- 自主移动时，Move 动画方向与真实水平位移一致；向左移动会镜像原始素材。
- 停止时回到 Relax；Sit、Sleep、Interact 只在窗口贴住屏幕工作区底边时触发，避免空中坐下或睡觉。
- 默认尺寸 60%，默认人物距离 50%，可在控制栏中调节大小、人物距离、移动速度和活跃度。
- 支持专注模式、配置持久化和恢复默认设置。
- 自动状态下鼠标穿透，不遮挡其他应用点击；暂停后允许拖拽。
- `Ctrl+Alt+P` 暂停或继续自动行动，`Ctrl+Alt+H` 重新显示隐藏后的控制栏。
- 窗口会限制在屏幕工作区内，不会被拖到屏幕外。
- 通过脚本安装包迁移到其他 Windows 电脑，不使用旧 `Setup.exe`。

## 本地运行

先安装依赖：

```powershell
npm install
```

开发时如需使用内置的银灰 × 灵知回归素材，请确认本地已经放好 `assets/`、`prts-assets/`、`processed-assets/` 中的素材后运行：

```powershell
npm start
```

没有这些目录时，应用会进入素材包配置状态；可从控制栏导入符合 `素材包格式说明.md` 的本地素材包。

## 打包

默认输出到 `release/`：

```powershell
npm run dist
```

也可以指定新的输出目录，避免覆盖旧版本：

```powershell
$env:PET_RELEASE_DIR = 'release-final'
npm run dist
```

打包结果包含：

- `明日方舟基建桌宠-portable/`：便携版目录；
- `明日方舟基建桌宠-portable.zip`：便携版压缩包；
- `script-installer/Install-ArknightsBasePet.cmd`：迁移安装入口。

默认安装包不再内置角色素材。首次启动会进入素材包配置：输入干员名称，选择 PRTS 返回的时装组后即可下载对应的“基建”Spine 素材。若仅用于开发回归、需要把当前银灵素材一并打进测试包，可在打包前设置：

```powershell
$env:PET_BUNDLE_MATERIALS = '1'
npm run dist
```

在其他 Windows 电脑上，把 `script-installer/` 整个目录复制过去，运行 `Install-ArknightsBasePet.cmd` 即可安装并创建快捷方式。

面向普通用户的安装、运行、SmartScreen、卸载和日志位置说明见 `安装说明.md`。

## 给 AI 排查用

桌宠会在用户目录下保存配置和诊断日志，普通使用时不需要打开这些文件。

- 诊断日志目录：`%APPDATA%\arknights-base-desktop-pet\diagnostics`
- 配置文件：`%APPDATA%\arknights-base-desktop-pet\settings.json`

如果遇到闪烁、拖拽、动作异常或启动报错，可以让 AI 帮忙读取或打包上述目录。诊断日志为 `.jsonl` 格式，文件名类似 `render-diagnostics-*.jsonl`。

## 发布到 GitHub

公开仓库建议只提交代码、脚本和说明文件，不提交素材、`node_modules/`、历史 `release*/`、诊断日志等本地文件。本项目已提供 `.gitignore`，直接按下面流程发布即可：

```powershell
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

如果你希望把可运行成品也发给别人，建议在 GitHub 的 Releases 页面上传本地构建出的 `明日方舟基建桌宠-portable.zip` 或 `script-installer/` 压缩包；公开分发前同样需要确认素材授权。
