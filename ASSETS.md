# 素材准备说明

本仓库可以公开发布代码，但不建议公开提交角色素材、PRTS Spine 文件、WebM/APNG/PNG 等资源，除非你确认自己拥有再分发授权。

运行和打包前，请在本地补齐以下目录：

```text
assets/
  灵知default.png
  银灰default.png
  灵知-默认-基建-Interact-x1.webm
  灵知-默认-基建-Move-x1.webm
  灵知-默认-基建-Relax-x1.webm
  灵知-默认-基建-Sit-x1.webm
  灵知-默认-基建-Sleep-x1.webm
  银灰-默认-基建-Interact-x1.webm
  银灰-默认-基建-Move-x1.webm
  银灰-默认-基建-Relax-x1.webm
  银灰-默认-基建-Sit-x1.webm
  银灰-默认-基建-Sleep-x1.webm

prts-assets/
  gnosis/
    model.atlas
    model.png
    model.skel
  silverash/
    model.atlas
    model.png
    model.skel

processed-assets/
  灵知-默认-基建-Interact-x1.apng
  灵知-默认-基建-Move-x1.apng
  灵知-默认-基建-Relax-x1.apng
  灵知-默认-基建-Sit-x1.apng
  灵知-默认-基建-Sleep-x1.apng
  银灰-默认-基建-Interact-x1.apng
  银灰-默认-基建-Move-x1.apng
  银灰-默认-基建-Relax-x1.apng
  银灰-默认-基建-Sit-x1.apng
  银灰-默认-基建-Sleep-x1.apng
```

渲染优先级为：

1. `prts-assets` 中的透明 Spine 原始素材；
2. `processed-assets` 中的透明 APNG；
3. `assets` 中的原始黑底 WebM，经 `src/renderer/black-key-fallback.js` 运行时抠黑降级。

第三层黑底抠图是最后降级方案，请保留相关代码。
