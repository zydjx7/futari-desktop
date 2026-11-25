# FUTARI Desktop · 焦糖兔

焦糖兔是一个可以离线饲养的 Windows 和 macOS 桌宠。轻点兔子可以摸摸它的头，双击它就能翻开手账，喂它吃草、给它摆窝，或挑一张陪工时用的场景壁纸。[FUTARI 网页版源码](https://github.com/zydjx7/futari-web)

## 下载与启动

| 系统 | 下载 | 启动方式 |
| --- | --- | --- |
| Windows x64 | [Windows 0.2.6 ZIP](https://github.com/zydjx7/futari-desktop/releases/download/v0.2.6/FUTARI-Desktop-Windows-x64.zip) | 解压整个文件夹，保留其中的 `scenes` 目录，双击 `FUTARI Desktop.exe`。需要 WebView2 运行时。 |
| macOS 12 及以上 | [macOS 0.2.8 通用 ZIP](https://github.com/zydjx7/futari-desktop/releases/download/v0.2.8/FUTARI-Desktop-macOS.zip) | 解压后将 `FUTARI Desktop.app` 拖入「应用程序」。Apple Silicon 和 Intel Mac 使用同一个包。 |

两个平台分别发布。其他版本和更新记录见 [GitHub Releases](https://github.com/zydjx7/futari-desktop/releases)。

## 桌面操作

| 操作 | Windows | macOS |
| --- | --- | --- |
| 循环切换小兔状态（隐身 → 仅在桌面 → 悬浮置顶） | `Alt + Q` | `Option + J` |
| 开关场景壁纸 | `Alt + W` | `Option + K` |
| 打开手账 | 双击或右键点击兔子 | 双击或辅助点按兔子 |

兔子隐身后也能用快捷键叫回来，或点击 Windows 系统托盘、macOS 菜单栏里的兔子图标切换状态。喂食、布置兔窝和自定义场景的详细操作见 [Windows 使用说明](desktop/使用说明.txt) 和 [macOS 使用说明](desktop/使用说明-macOS.txt)。

## 从源码构建

本仓库公开，可直接克隆。构建环境使用 Node.js 24 和 Rust stable。Windows 需要 Visual Studio C++ Build Tools 和 WebView2，macOS 需要 Xcode Command Line Tools。

```sh
git clone https://github.com/zydjx7/futari-desktop.git
cd futari-desktop
```

在仓库根目录运行对应平台的命令。构建完成后，ZIP 包位于 `desktop/dist/`。

| 构建目标 | 命令 |
| --- | --- |
| Windows x64（PowerShell） | `.\desktop\scripts\build.ps1` |
| 当前 Mac 架构 | `bash desktop/scripts/build-macos.sh` |
| macOS 通用包（Apple Silicon 和 Intel） | `bash desktop/scripts/build-macos.sh --universal` |

桌面界面位于 [desktop/ui](desktop/ui)，共用模块位于 [src/modules](src/modules)，两个平台的原生窗口和快捷键实现位于 [desktop/src-tauri/src/platform](desktop/src-tauri/src/platform)。
