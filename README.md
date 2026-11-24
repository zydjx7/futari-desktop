# FUTARI 桌面应用

一个桌宠，两套原生窗口与快捷键实现。网站源码在 [futari-web](https://github.com/zydjx7/futari-web)。

## 下载

从 [GitHub Releases](https://github.com/zydjx7/futari-desktop/releases/latest) 的 Assets 下载已发布的平台包。也可以直接克隆源码，在本机编译。

macOS 修复版 0.2.7 保留 0.2.6 的道具拖动、独立缩放和颜色修复，并修复首页白屏与默认陪工活动区。Windows 下载包继续沿用 0.2.6，内容不变。

| 系统 | 文件名 | 快捷键（小兔层级 / 壁纸） |
| --- | --- | --- |
| Windows x64 | FUTARI-Desktop-Windows-x64.zip | Alt+Q / Alt+W |
| macOS 12+，Apple Silicon 与 Intel | FUTARI-Desktop-macOS.zip | ⌥J / ⌥K |

Windows 解压整个目录，双击 FUTARI Desktop.exe。Mac 解压后把 FUTARI Desktop.app 拖到「应用程序」。压缩包附有对应系统的使用说明。

## 从源码构建

本仓库为私有仓库，克隆需要有访问权限的 GitHub 账号。获取开发分支：

```sh
git clone https://github.com/zydjx7/futari-desktop.git
cd futari-desktop
```

已配置 GitHub SSH 密钥时，克隆地址也可使用 `git@github.com:zydjx7/futari-desktop.git`。要复现某次发行，从仓库根目录切换到对应标签，例如 `git switch --detach v0.2.4`。日后跟进开发分支，运行 `git switch main` 和 `git pull --ff-only`。

使用 Node.js 24 和 Rust stable。Mac 需要 Xcode Command Line Tools，Windows 需要 Visual Studio C++ Build Tools 和 WebView2。从仓库根目录运行：

- Windows PowerShell：`./desktop/scripts/build.ps1`
- 当前 Mac 架构：`bash desktop/scripts/build-macos.sh`
- Mac 通用包：`bash desktop/scripts/build-macos.sh --universal`

产物在 `desktop/dist/`。两端共用 `desktop/ui/` 和 `src/modules/` 的兔子行为与美术资源。原生实现位于 `desktop/src-tauri/src/platform/`。
