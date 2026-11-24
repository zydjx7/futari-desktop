# FUTARI 桌面应用

一个桌宠，两套原生窗口与快捷键实现。网站源码在 [futari-web](https://github.com/zydjx7/futari-web)。

## 下载

打开 [最新版本的 Assets](https://github.com/zydjx7/futari-desktop/releases/latest)，按系统选择 ZIP。

| 系统 | 文件名 | 快捷键（小兔层级 / 壁纸） |
| --- | --- | --- |
| Windows x64 | FUTARI-Desktop-Windows-x64.zip | Alt+Q / Alt+W |
| macOS 12+，Apple Silicon 与 Intel | FUTARI-Desktop-macOS.zip | ⌥J / ⌥K |

Windows 解压整个目录，双击 FUTARI Desktop.exe。Mac 解压后把 FUTARI Desktop.app 拖到「应用程序」。压缩包附有对应系统的使用说明。

## 从源码构建

使用 Node.js 24 和 Rust stable。Mac 需要 Xcode Command Line Tools，Windows 需要 Visual Studio C++ Build Tools 和 WebView2。从仓库根目录运行：

- Windows PowerShell：`./desktop/scripts/build.ps1`
- 当前 Mac 架构：`bash desktop/scripts/build-macos.sh`
- Mac 通用包：`bash desktop/scripts/build-macos.sh --universal`

产物在 `desktop/dist/`。两端共用 `desktop/ui/` 和 `src/modules/` 的兔子行为与美术资源。原生实现位于 `desktop/src-tauri/src/platform/`。
