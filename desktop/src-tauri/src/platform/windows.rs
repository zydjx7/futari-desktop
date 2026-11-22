use super::*;
use std::{
    cell::Cell,
    ffi::OsString,
    fs::File,
    mem::{size_of, zeroed},
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        io::AsRawHandle,
    },
    path::PathBuf,
    ptr::{null, null_mut},
    sync::OnceLock,
};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::*,
    Storage::FileSystem::GetFinalPathNameByHandleW,
    System::{
        LibraryLoader::GetModuleHandleW, RemoteDesktop::*,
        WindowsProgramming::QueryUnbiasedInterruptTime,
    },
    UI::{
        Accessibility::*, HiDpi::GetDpiForWindow, Input::KeyboardAndMouse::*, Shell::ShellExecuteW,
        WindowsAndMessaging::*,
    },
};
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain([0]).collect()
}
fn cname(w: HWND) -> String {
    let mut buf = [0u16; 128];
    unsafe {
        let n = GetClassNameW(w, buf.as_mut_ptr(), 128);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}
static EVENTS: OnceLock<Sender<NativeEvent>> = OnceLock::new();
fn send(e: NativeEvent) {
    if let Some(s) = EVENTS.get() {
        let _ = s.send(e);
    }
}
thread_local! {static DOWN:Cell<Option<(i32,i32,bool)>>=const{Cell::new(None)};}
fn cursor() -> POINT {
    unsafe {
        let mut p = POINT::default();
        GetCursorPos(&mut p);
        p
    }
}
unsafe extern "system" fn foreground(
    _: HWINEVENTHOOK,
    _: u32,
    _: HWND,
    _: i32,
    _: i32,
    _: u32,
    _: u32,
) {
    send(NativeEvent::Foreground)
}
unsafe extern "system" fn proc(w: HWND, m: u32, a: WPARAM, b: LPARAM) -> LRESULT {
    match m {
        WM_MOUSEACTIVATE => return MA_NOACTIVATE as isize,
        WM_HOTKEY => {
            if a == 1 {
                send(NativeEvent::Toggle)
            } else if a == 2 {
                send(NativeEvent::Switch)
            }
        }
        WM_DISPLAYCHANGE | WM_SETTINGCHANGE => send(NativeEvent::Display),
        WM_WTSSESSION_CHANGE => {
            if a == WTS_SESSION_LOCK as usize || a == WTS_SESSION_UNLOCK as usize {
                send(NativeEvent::Lock(a == WTS_SESSION_LOCK as usize))
            }
        }
        WM_TIMER => send(NativeEvent::Tick),
        WM_RBUTTONDOWN => {
            SetCapture(w);
        }
        WM_LBUTTONDOWN => {
            let p = cursor();
            SetCapture(w);
            DOWN.set(Some((p.x, p.y, false)));
        }
        WM_LBUTTONDBLCLK | WM_RBUTTONUP => {
            DOWN.set(None);
            if GetCapture() == w {
                ReleaseCapture();
            }
            let p = cursor();
            send(NativeEvent::Card(p.x, p.y));
        }
        WM_MOUSEMOVE => {
            if let Some((x, y, drag)) = DOWN.get() {
                let p = cursor();
                if drag || (p.x - x).abs() + (p.y - y).abs() > 5 {
                    DOWN.set(Some((x, y, true)));
                    if !drag {
                        send(NativeEvent::DragStart(x, y));
                    }
                    send(NativeEvent::Drag(p.x, p.y));
                }
            }
        }
        WM_LBUTTONUP => {
            let was = DOWN.take();
            ReleaseCapture();
            if let Some((_, _, drag)) = was {
                let p = cursor();
                send(if drag {
                    NativeEvent::Drop
                } else {
                    NativeEvent::Click(p.x, p.y)
                });
            }
        }
        WM_CAPTURECHANGED => {
            if DOWN.take().is_some_and(|v| v.2) {
                send(NativeEvent::Drop)
            }
        }
        _ => return DefWindowProcW(w, m, a, b),
    }
    0
}
use std::sync::atomic::{AtomicBool, Ordering};
pub struct Native {
    desktop_foreground: AtomicBool,
    hit: isize,
    hook: isize,
    keys: [Option<String>; 2],
}
fn rect(r: RECT) -> Rect {
    Rect {
        x: r.left,
        y: r.top,
        w: r.right - r.left,
        h: r.bottom - r.top,
    }
}
unsafe fn find_child(parent: HWND, class: &str) -> HWND {
    FindWindowExW(parent, null_mut(), wide(class).as_ptr(), null())
}
// Place our surface immediately above Explorer's icon host, below ordinary windows.
unsafe fn icon_host() -> HWND {
    let shell = GetShellWindow();
    if !shell.is_null() && !find_child(shell, "SHELLDLL_DefView").is_null() {
        return shell;
    }
    unsafe extern "system" fn visit(w: HWND, arg: LPARAM) -> i32 {
        let mut shell = 0;
        let mut owner = 0;
        GetWindowThreadProcessId(GetShellWindow(), &mut shell);
        GetWindowThreadProcessId(w, &mut owner);
        if shell != 0 && owner == shell && !find_child(w, "SHELLDLL_DefView").is_null() {
            *(arg as *mut HWND) = w;
            0
        } else {
            1
        }
    }
    let mut host: HWND = null_mut();
    EnumWindows(Some(visit), &mut host as *mut _ as isize);
    if host.is_null() {
        shell
    } else {
        host
    }
}
unsafe fn above(w: HWND, anchor: HWND) -> (HWND, u32) {
    if GetWindowLongPtrW(w, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0 {
        SetWindowPos(
            w,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
    if anchor.is_null() {
        return (HWND_BOTTOM, 0);
    }
    let prev = GetWindow(anchor, GW_HWNDPREV);
    if prev == w {
        (HWND_TOP, SWP_NOZORDER)
    } else if prev.is_null() {
        (HWND_TOP, 0)
    } else {
        (prev, 0)
    }
}
unsafe fn wallpaper_host() -> HWND {
    let prog = FindWindowW(wide("Progman").as_ptr(), null());
    if prog.is_null() {
        return null_mut();
    }
    // Ask Explorer to provide its wallpaper surface. The icon host is never reparented.
    let mut result = 0;
    SendMessageTimeoutW(prog, 0x052c, 0xd, 1, SMTO_ABORTIFHUNG, 250, &mut result);
    if !find_child(prog, "SHELLDLL_DefView").is_null() {
        let child = find_child(prog, "WorkerW");
        if !child.is_null() {
            return child;
        }
    }
    unsafe extern "system" fn visit(w: HWND, arg: LPARAM) -> i32 {
        if !find_child(w, "SHELLDLL_DefView").is_null() {
            let candidate = FindWindowExW(null_mut(), w, wide("WorkerW").as_ptr(), null());
            if !candidate.is_null() {
                *(arg as *mut HWND) = candidate;
                return 0;
            }
        }
        1
    }
    let mut out: HWND = null_mut();
    EnumWindows(Some(visit), &mut out as *mut _ as isize);
    if !out.is_null() {
        let mut shell = 0;
        let mut owner = 0;
        GetWindowThreadProcessId(prog, &mut shell);
        GetWindowThreadProcessId(out, &mut owner);
        if owner != shell {
            return null_mut();
        }
    }
    out
}
impl PlatformController for Native {
    fn install(events: Sender<NativeEvent>) -> Result<Self> {
        unsafe {
            EVENTS.set(events).map_err(|_| "桌面控制器重复初始化")?;
            let class = wide("FutariPetInput");
            let inst = GetModuleHandleW(null());
            let wc = WNDCLASSW {
                style: CS_DBLCLKS,
                lpfnWndProc: Some(proc),
                hInstance: inst,
                lpszClassName: class.as_ptr(),
                hCursor: LoadCursorW(null_mut(), IDC_HAND),
                hbrBackground: GetStockObject(BLACK_BRUSH) as _,
                ..zeroed()
            };
            if RegisterClassW(&wc) == 0 {
                return Err("无法注册桌宠交互窗口".into());
            }
            let w = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                class.as_ptr(),
                wide("FUTARI touch").as_ptr(),
                WS_POPUP,
                0,
                0,
                1,
                1,
                null_mut(),
                null_mut(),
                inst,
                null(),
            );
            if w.is_null() {
                return Err("无法建立桌宠交互窗口".into());
            }
            SetLayeredWindowAttributes(w, 0, 1, LWA_ALPHA);
            let register = |id, key: u8| {
                for (modifiers, label) in [
                    (MOD_ALT, "Alt"),
                    (MOD_CONTROL | MOD_ALT, "Ctrl+Alt"),
                    (MOD_CONTROL | MOD_SHIFT | MOD_ALT, "Ctrl+Alt+Shift"),
                ] {
                    if RegisterHotKey(w, id, modifiers | MOD_NOREPEAT, u32::from(key)) != 0 {
                        return Some(format!("{label}+{}", char::from(key)));
                    }
                }
                None
            };
            let keys = [register(1, b'Q'), register(2, b'W')];
            let hook = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                null_mut(),
                Some(foreground),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
            if hook.is_null() {
                return Err("无法订阅桌面切换".into());
            }
            WTSRegisterSessionNotification(w, NOTIFY_FOR_THIS_SESSION);
            SetTimer(w, 1, 60000, None);
            Ok(Self {
                desktop_foreground: AtomicBool::new(false),
                hit: w as isize,
                hook: hook as isize,
                keys,
            })
        }
    }
    fn shortcuts(&self) -> [Option<String>; 2] {
        self.keys.clone()
    }
    fn hide_card(&self, window: isize) {
        unsafe {
            ShowWindow(window as HWND, SW_HIDE);
        }
    }
    fn display(&self, stage: isize) -> Display {
        unsafe {
            let mon = if stage == 0 {
                MonitorFromPoint(cursor(), MONITOR_DEFAULTTOPRIMARY)
            } else {
                MonitorFromWindow(stage as _, MONITOR_DEFAULTTONEAREST)
            };
            let mut m: MONITORINFO = zeroed();
            m.cbSize = size_of::<MONITORINFO>() as u32;
            GetMonitorInfoW(mon, &mut m);
            Display {
                screen: rect(m.rcMonitor),
                work: rect(m.rcWork),
            }
        }
    }
    fn is_desktop(&self, stage: isize, card: isize) -> bool {
        unsafe {
            let w = GetForegroundWindow();
            let class = cname(w);
            if w.is_null()
                || w == stage as HWND
                || w == card as HWND
                || w == self.hit as HWND
                || matches!(
                    class.as_str(),
                    "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "NotifyIconOverflowWindow"
                )
            {
                return self.desktop_foreground.load(Ordering::Relaxed);
            }
            let shell = GetShellWindow();
            let mut shell_pid = 0;
            let mut pid = 0;
            GetWindowThreadProcessId(shell, &mut shell_pid);
            GetWindowThreadProcessId(w, &mut pid);
            let is_desktop = w == shell
                || (shell_pid != 0
                    && shell_pid == pid
                    && matches!(class.as_str(), "Progman" | "WorkerW"));
            self.desktop_foreground.store(is_desktop, Ordering::Relaxed);
            is_desktop
        }
    }
    fn foreground_external(&self, stage: isize, card: isize) -> bool {
        unsafe {
            let w = GetForegroundWindow();
            if w.is_null() || w == stage as HWND || w == card as HWND || w == self.hit as HWND {
                return false;
            }
            let class = cname(w);
            !matches!(
                class.as_str(),
                "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "NotifyIconOverflowWindow"
            )
        }
    }
    fn present(
        &self,
        stage: isize,
        d: Display,
        mode: Mode,
        wallpaper: bool,
        visible: bool,
        interactive: bool,
        topmost: bool,
    ) -> bool {
        unsafe {
            let w = stage as HWND;
            let mut style = GetWindowLongPtrW(w, GWL_STYLE) as u32;
            let requested = mode == Mode::Desktop && wallpaper && !interactive;
            let mut parent = if style & WS_CHILD != 0 {
                GetParent(w)
            } else {
                null_mut()
            };
            if requested && parent.is_null() {
                let host = wallpaper_host();
                if !host.is_null() {
                    SetLastError(0);
                    SetParent(w, host);
                    if GetLastError() == 0 {
                        parent = host;
                        style = (style & !WS_POPUP) | WS_CHILD;
                        SetWindowLongPtrW(w, GWL_STYLE, style as isize);
                    }
                }
            }
            if !requested && !parent.is_null() {
                ShowWindow(w, SW_HIDE);
                SetParent(w, null_mut());
                SetWindowLongPtrW(w, GWL_STYLE, ((style & !WS_CHILD) | WS_POPUP) as isize);
                parent = null_mut();
            }
            let mut ex = GetWindowLongPtrW(w, GWL_EXSTYLE) as u32
                | WS_EX_TOOLWINDOW
                | WS_EX_NOACTIVATE
                | WS_EX_LAYERED;
            if interactive {
                ex &= !(WS_EX_TRANSPARENT | WS_EX_NOACTIVATE)
            } else {
                ex |= WS_EX_TRANSPARENT | WS_EX_NOACTIVATE
            }
            SetWindowLongPtrW(w, GWL_EXSTYLE, ex as isize);
            if !visible {
                ShowWindow(w, SW_HIDE);
                self.hide_hit();
                return !parent.is_null();
            }
            let mut origin = POINT {
                x: d.screen.x,
                y: d.screen.y,
            };
            if !parent.is_null() {
                ScreenToClient(parent, &mut origin);
            }
            let (z, flags) = if topmost {
                (HWND_TOPMOST, 0)
            } else if !parent.is_null() {
                (HWND_BOTTOM, 0)
            } else {
                above(w, icon_host())
            };
            SetWindowPos(
                w,
                z,
                origin.x,
                origin.y,
                d.screen.w,
                d.screen.h,
                flags
                    | SWP_FRAMECHANGED
                    | SWP_SHOWWINDOW
                    | if interactive { 0 } else { SWP_NOACTIVATE },
            );
            if interactive {
                SetForegroundWindow(w);
            }
            !parent.is_null()
        }
    }
    fn hide_hit(&self) {
        unsafe {
            ShowWindow(self.hit as _, SW_HIDE);
        }
    }
    fn shape(&self, stage: isize, hit: &Hit, top: bool) {
        unsafe {
            let w = self.hit as HWND;
            if hit.rows.is_empty() {
                self.hide_hit();
                return;
            }
            let rgn = CreateRectRgn(0, 0, 0, 0);
            let row = CreateRectRgn(0, 0, 0, 0);
            for &[x, y, r, b] in &hit.rows {
                SetRectRgn(row, x, y, r, b);
                CombineRgn(rgn, rgn, row, RGN_OR);
            }
            DeleteObject(row);
            if SetWindowRgn(w, rgn, 0) == 0 {
                DeleteObject(rgn);
                return;
            }
            let mut p = POINT { x: hit.x, y: hit.y };
            ClientToScreen(stage as _, &mut p);
            let fg = GetForegroundWindow();
            let mut owner = 0;
            GetWindowThreadProcessId(fg, &mut owner);
            let (order, flags) = if !top {
                let target = if GetWindowLongPtrW(stage as HWND, GWL_STYLE) as u32 & WS_CHILD != 0 {
                    icon_host()
                } else {
                    stage as HWND
                };
                above(w, target)
            } else if !fg.is_null()
                && owner == std::process::id()
                && fg != stage as HWND
                && fg != w
                && cname(fg) == "Tauri Window"
            {
                (fg, 0)
            } else {
                (HWND_TOPMOST, 0)
            };
            SetWindowPos(
                w,
                order,
                p.x,
                p.y,
                hit.w,
                hit.h,
                flags | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }
    fn card_position(&self, w: isize, x: i32, y: i32, d: Display) {
        unsafe {
            let win = w as HWND;
            let dpi = GetDpiForWindow(win).max(96) as f64 / 96.;
            let width = ((420. * dpi) as i32).min(d.work.w);
            let height = ((540. * dpi) as i32).min(d.work.h);
            let px = (if x + width + 22 < d.work.x + d.work.w {
                x + 14
            } else {
                x - width - 14
            })
            .clamp(d.work.x, d.work.x + d.work.w - width);
            let py = (y - height + 30).clamp(d.work.y, d.work.y + d.work.h - height);
            SetWindowPos(win, HWND_TOPMOST, px, py, width, height, SWP_SHOWWINDOW);
            SetForegroundWindow(win);
        }
    }
    fn open_scenes(&self, path: &Path) -> Result<()> {
        let p: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        unsafe {
            if ShellExecuteW(
                null_mut(),
                wide("open").as_ptr(),
                p.as_ptr(),
                null(),
                null(),
                SW_SHOWNORMAL,
            ) as isize
                <= 32
            {
                Err("无法打开场景目录".into())
            } else {
                Ok(())
            }
        }
    }
}
impl Drop for Native {
    fn drop(&mut self) {
        unsafe {
            let w = self.hit as HWND;
            UnhookWinEvent(self.hook as _);
            KillTimer(w, 1);
            UnregisterHotKey(w, 1);
            UnregisterHotKey(w, 2);
            WTSUnRegisterSessionNotification(w);
            DestroyWindow(w);
        }
    }
}
pub fn awake_seconds() -> u64 {
    let mut t = 0;
    unsafe {
        QueryUnbiasedInterruptTime(&mut t);
    }
    t / 10_000_000
}
pub fn cursor_pos() -> (i32, i32) {
    let p = cursor();
    (p.x, p.y)
}
pub fn file_path(f: &File) -> Result<PathBuf> {
    let mut b = vec![0u16; 32768];
    let n = unsafe {
        GetFinalPathNameByHandleW(f.as_raw_handle() as _, b.as_mut_ptr(), b.len() as u32, 0)
    } as usize;
    if n == 0 || n >= b.len() {
        return Err("无法验证文件来源".into());
    }
    Ok(OsString::from_wide(&b[..n]).into())
}
#[cfg(feature = "cloud-sync")]
pub mod credentials {
    use super::*;
    use windows_sys::Win32::Security::Credentials::*;
    const TARGET: &str = "FUTARI Desktop / pet session v1";
    pub fn read() -> Result<Option<String>> {
        unsafe {
            let mut p = null_mut();
            if CredReadW(wide(TARGET).as_ptr(), CRED_TYPE_GENERIC, 0, &mut p) == 0 {
                return if GetLastError() == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err("无法读取 Windows 凭据".into())
                };
            }
            let v = if (*p).CredentialBlobSize > 0 && (*p).CredentialBlobSize <= 512 {
                String::from_utf8(
                    std::slice::from_raw_parts(
                        (*p).CredentialBlob,
                        (*p).CredentialBlobSize as usize,
                    )
                    .to_vec(),
                )
                .ok()
            } else {
                None
            };
            CredFree(p as _);
            Ok(v)
        }
    }
    pub fn write(t: &str) -> Result<()> {
        unsafe {
            let mut k = wide(TARGET);
            let c = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: k.as_mut_ptr(),
                CredentialBlob: t.as_ptr() as _,
                CredentialBlobSize: t.len() as u32,
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                ..zeroed()
            };
            if CredWriteW(&c, 0) == 0 {
                return Err("无法保存 Windows 凭据".into());
            }
            Ok(())
        }
    }
    pub fn clear() -> Result<()> {
        unsafe {
            if CredDeleteW(wide(TARGET).as_ptr(), CRED_TYPE_GENERIC, 0) == 0
                && GetLastError() != ERROR_NOT_FOUND
            {
                return Err("无法清除 Windows 凭据".into());
            }
        }
        Ok(())
    }
}
pub fn handle(w: &tauri::WebviewWindow) -> isize {
    w.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}
pub fn startup_error(message: &str) {
    unsafe {
        MessageBoxW(
            null_mut(),
            wide(message).as_ptr(),
            wide("FUTARI Desktop").as_ptr(),
            MB_OK | MB_ICONINFORMATION,
        );
    }
}
