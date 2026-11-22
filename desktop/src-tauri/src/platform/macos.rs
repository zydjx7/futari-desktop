use super::{retina::Screen, *};
use std::{
    ffi::{CStr, CString},
    fs::File,
    os::{
        fd::AsRawFd,
        unix::ffi::{OsStrExt, OsStringExt},
    },
    path::PathBuf,
    sync::OnceLock,
};

extern "C" {
    fn ft_install(callback: extern "C" fn(i32, f64, f64), keys: *mut i32);
    fn ft_screen(window: isize, output: *mut Screen);
    fn ft_cursor(x: *mut f64, y: *mut f64);
    fn ft_desktop() -> bool;
    fn ft_external() -> bool;
    fn ft_present(
        stage: isize,
        visible: bool,
        interactive: bool,
        top: bool,
        below: bool,
        desktop: bool,
    );
    fn ft_shape(stage: isize, x: i32, y: i32, rows: *const [i32; 4], count: usize);
    fn ft_hide_hit();
    fn ft_card(window: isize, x: f64, y: f64);
    fn ft_hide(window: isize);
    fn ft_folder(path: *const libc::c_char) -> bool;
}
static EVENTS: OnceLock<Sender<NativeEvent>> = OnceLock::new();
fn screen(w: isize) -> Screen {
    let mut value = Screen::default();
    unsafe { ft_screen(w, &mut value) }
    value
}
extern "C" fn receive(kind: i32, x: f64, y: f64) {
    let point = || screen(0).point(x, y);
    let e = match kind {
        0 => NativeEvent::Toggle,
        1 => NativeEvent::Switch,
        2 => NativeEvent::Foreground,
        3 => NativeEvent::Display,
        4 => {
            let (x, y) = point();
            NativeEvent::Click(x, y)
        }
        5 => {
            let (x, y) = point();
            NativeEvent::Card(x, y)
        }
        6 => {
            let (x, y) = point();
            NativeEvent::DragStart(x, y)
        }
        7 => {
            let (x, y) = point();
            NativeEvent::Drag(x, y)
        }
        8 => NativeEvent::Drop,
        9 => NativeEvent::Lock(x != 0.),
        10 => NativeEvent::Tick,
        _ => return,
    };
    if let Some(tx) = EVENTS.get() {
        let _ = tx.send(e);
    }
}
pub struct Native {
    keys: [Option<String>; 2],
}
impl PlatformController for Native {
    fn install(tx: Sender<NativeEvent>) -> Result<Self> {
        EVENTS.set(tx).map_err(|_| "重复安装平台事件")?;
        let mut keys = [-1; 2];
        unsafe { ft_install(receive, keys.as_mut_ptr()) }
        Ok(Self {
            keys: std::array::from_fn(|i| {
                let k = ["Q", "W"][i];
                match keys[i] {
                    0 => Some(format!("Option+{k} (⌥{k})")),
                    1 => Some(format!("Control+Option+{k}")),
                    2 => Some(format!("Control+Option+Shift+{k}")),
                    _ => None,
                }
            }),
        })
    }
    fn display(&self, w: isize) -> Display {
        screen(w).display()
    }
    fn is_desktop(&self, _: isize, _: isize) -> bool {
        unsafe { ft_desktop() }
    }
    fn foreground_external(&self, _: isize, _: isize) -> bool {
        unsafe { ft_external() }
    }
    fn present(
        &self,
        w: isize,
        _: Display,
        mode: Mode,
        wall: bool,
        visible: bool,
        interactive: bool,
        top: bool,
    ) -> bool {
        let below = wall && mode == Mode::Desktop && !top;
        unsafe { ft_present(w, visible, interactive, top, below, mode == Mode::Desktop) };
        below && visible
    }
    fn shape(&self, w: isize, h: &Hit, _: bool) {
        unsafe { ft_shape(w, h.x, h.y, h.rows.as_ptr(), h.rows.len()) }
    }
    fn hide_hit(&self) {
        unsafe { ft_hide_hit() }
    }
    fn card_position(&self, w: isize, x: i32, y: i32, _: Display) {
        let (x, y) = screen(0).cocoa(x, y);
        unsafe { ft_card(w, x, y) }
    }
    fn hide_card(&self, w: isize) {
        unsafe { ft_hide(w) }
    }
    fn shortcuts(&self) -> [Option<String>; 2] {
        self.keys.clone()
    }
    fn open_scenes(&self, path: &Path) -> Result<()> {
        let dir = path.canonicalize().map_err(|e| e.to_string())?;
        if dir != path
            || !dir.is_dir()
            || dir.file_name().and_then(|n| n.to_str()) != Some("scenes")
        {
            return Err("无效的场景目录".into());
        }
        let name = CString::new(dir.as_os_str().as_bytes()).map_err(|_| "无效路径")?;
        if unsafe { ft_folder(name.as_ptr()) } {
            Ok(())
        } else {
            Err("无法打开场景目录".into())
        }
    }
}
pub fn handle(w: &tauri::WebviewWindow) -> isize {
    w.ns_window().map(|p| p as isize).unwrap_or(0)
}
pub fn cursor_pos() -> (i32, i32) {
    let (mut x, mut y) = (0., 0.);
    unsafe { ft_cursor(&mut x, &mut y) };
    screen(0).point(x, y)
}
pub fn awake_seconds() -> u64 {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    unsafe {
        libc::clock_gettime(libc::CLOCK_UPTIME_RAW, &mut ts);
    }
    ts.tv_sec as u64
}
pub fn file_path(f: &File) -> Result<PathBuf> {
    let mut buf = [0i8; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(f.as_raw_fd(), libc::F_GETPATH, buf.as_mut_ptr()) } < 0 {
        return Err("无法验证场景文件路径".into());
    }
    Ok(
        std::ffi::OsString::from_vec(unsafe { CStr::from_ptr(buf.as_ptr()) }.to_bytes().to_vec())
            .into(),
    )
}
pub fn startup_error(msg: &str) {
    eprintln!("FUTARI: {msg}");
}
#[cfg(feature = "cloud-sync")]
pub mod credentials {
    use super::Result;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };
    const SERVICE: &str = "app.futari.desktop";
    const ACCOUNT: &str = "desktop-session";
    pub fn read() -> Result<Option<String>> {
        match get_generic_password(SERVICE, ACCOUNT) {
            Ok(v) => String::from_utf8(v)
                .map(Some)
                .map_err(|_| "钥匙串令牌无效".into()),
            Err(e) if e.code() == -25300 => Ok(None),
            Err(_) => Err("无法读取钥匙串".into()),
        }
    }
    pub fn write(token: &str) -> Result<()> {
        set_generic_password(SERVICE, ACCOUNT, token.as_bytes())
            .map_err(|_| "无法写入钥匙串".into())
    }
    pub fn clear() -> Result<()> {
        match delete_generic_password(SERVICE, ACCOUNT) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(_) => Err("无法清除钥匙串令牌".into()),
        }
    }
}
