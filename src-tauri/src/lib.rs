// src-tauri/src/lib.rs
//
// Tauri v2 application runtime.
// Responsibilities:
//   - Register tauri-plugin-global-shortcut (Alt+Space → focus toggle)
//   - Register tauri-plugin-sql (SQLite backend)
//   - Window is configured as borderless + transparent via tauri.conf.json.
//   - System tray integration (close → hide to tray, keep running in background)

use base64::Engine;
use serde_json::Value;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

// ---------------------------------------------------------------------------
// Command: parse PDF / Word document via Python (pdfplumber / python-docx)
// ---------------------------------------------------------------------------

#[tauri::command]
fn parse_document(data: String, ext: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("base64 decode failed: {}", e))?;

    let temp_name = format!(
        "quick_chat_parse_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let temp_path = std::env::temp_dir().join(&temp_name);

    std::fs::write(&temp_path, &bytes)
        .map_err(|e| format!("write temp file failed: {}", e))?;

    // -----------------------------------------------------------------------
    // Helper: locate Python executable robustly on Windows / Unix
    // -----------------------------------------------------------------------
    fn find_python() -> Result<String, String> {
        // Windows: use "where" to resolve the real path
        #[cfg(target_os = "windows")]
        {
            for name in ["python", "py", "python3"] {
                if let Ok(output) = std::process::Command::new("where")
                    .arg(name)
                    .output()
                {
                    if output.status.success() {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        if let Some(line) = stdout.lines().next() {
                            let path = line.trim();
                            if std::path::Path::new(path).exists() {
                                return Ok(path.to_string());
                            }
                        }
                    }
                }
            }
        }

        // Unix: try "which"
        #[cfg(not(target_os = "windows"))]
        {
            for name in ["python3", "python"] {
                if let Ok(output) = std::process::Command::new("which")
                    .arg(name)
                    .output()
                {
                    if output.status.success() {
                        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if !path.is_empty() {
                            return Ok(path);
                        }
                    }
                }
            }
        }

        // Fallback: try bare commands (rely on PATH)
        for cmd in ["python3", "python", "py"] {
            if std::process::Command::new(cmd).arg("--version").output().is_ok() {
                return Ok(cmd.to_string());
            }
        }

        Err("无法找到 Python 解释器，请确保 Python 已安装并加入 PATH".to_string())
    }

    let python_path = find_python()?;

    let script = r#"
import sys, io, traceback
# Force UTF-8 on Windows to avoid 'gbk' codec errors
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
path = sys.argv[1]
ext = sys.argv[2].lower()

try:
    if ext == 'pdf':
        import pdfplumber
        pdf = pdfplumber.open(path)
        pages = []
        for page in pdf.pages:
            t = page.extract_text()
            pages.append(t if t else '')
        text = '\n'.join(pages)
        pdf.close()
    elif ext in ('docx', 'doc'):
        from docx import Document
        doc = Document(path)
        text = '\n'.join(p.text for p in doc.paragraphs)
    else:
        text = ''
    sys.stdout.write(text)
    sys.stdout.flush()
except Exception:
    traceback.print_exc()
    sys.exit(1)
"#;

    let output = std::process::Command::new(&python_path)
        .arg("-c")
        .arg(script)
        .arg(&temp_path)
        .arg(&ext)
        .output()
        .map_err(|e| format!("启动 Python 失败 ({}): {}", python_path, e))?;

    let _ = std::fs::remove_file(&temp_path);

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if output.status.success() {
        Ok(stdout.trim().to_string())
    } else {
        Err(format!(
            "Python exit code {:?}. stderr: {}. stdout: {}. python: {}",
            output.status.code(),
            if stderr.is_empty() { "(empty)" } else { &stderr },
            if stdout.is_empty() { "(empty)" } else { &stdout },
            python_path
        ))
    }
}

// ---------------------------------------------------------------------------
// Helper: toggle window visibility + focus (called from the shortcut handler)
// ---------------------------------------------------------------------------

/// Spotlight-style visibility toggle for the main window.
/// - Hidden / minimised  → show + unminimise + force keyboard focus
/// - Visible             → hide (send to background)
fn toggle_window_focus(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[quick-chat] window 'main' not found");
        return;
    };

    let visible = match window.is_visible() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[quick-chat] is_visible() error: {e}");
            return;
        }
    };

    if visible {
        // Window is in the foreground — hide it.
        if let Err(e) = window.hide() {
            eprintln!("[quick-chat] hide() error: {e}");
        }
    } else {
        // Window is hidden — bring it back to the front.
        if let Err(e) = window.show() {
            eprintln!("[quick-chat] show() error: {e}");
            return; // No point calling set_focus if show failed.
        }
        // Un-minimise on Windows / macOS when applicable.
        if let Err(e) = window.unminimize() {
            eprintln!("[quick-chat] unminimize() error: {e}");
        }
        // Force keyboard focus so the user can start typing immediately.
        if let Err(e) = window.set_focus() {
            eprintln!("[quick-chat] set_focus() error: {e}");
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: setup system tray icon with menu
// ---------------------------------------------------------------------------

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show_i = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
    let quit_i = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show_i, &PredefinedMenuItem::separator(app)?, &quit_i])
        .build()?;

    TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .icon(app.default_window_icon().unwrap().clone())
        .build(app)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Helper: proxy SerpApi requests through Rust to avoid browser CORS
// ---------------------------------------------------------------------------

#[tauri::command]
async fn search_web(query: String, api_key: String) -> Result<Value, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("SerpApi Key 未配置".to_string());
    }

    let client = reqwest::Client::new();
    let response = client
        .get("https://serpapi.com/search.json")
        .query(&[
            ("engine", "google"),
            ("q", query.as_str()),
            ("api_key", api_key),
        ])
        .send()
        .await
        .map_err(|e| format!("SerpApi 搜索请求失败: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("SerpApi 响应读取失败: {e}"))?;

    if !status.is_success() {
        return Err(format!("SerpApi 搜索请求失败 ({status}): {body}"));
    }

    serde_json::from_str(&body).map_err(|e| format!("SerpApi 响应解析失败: {e}"))
}

// ---------------------------------------------------------------------------
// Public entry point (called from main.rs)
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { 
    tauri::Builder::default()
        // ── Intercept close request: hide to tray instead of quitting ───────
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(e) = window.hide() {
                    eprintln!("[quick-chat] hide() on close requested: {e}");
                }
            }
        })
        // ── Global shortcut plugin ──────────────────────────────────────────
        // `.with_shortcuts` pre-registers shortcuts at startup.
        // `.with_handler` receives ALL shortcut events; we filter by matching.
        .setup(|app| {
            // System tray setup
            if let Err(e) = setup_tray(app) {
                eprintln!("[quick-chat] tray setup error: {e}");
            }

            // Global shortcuts are desktop-only.
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::Builder as ShortcutBuilder;

                app.handle().plugin(
                    ShortcutBuilder::new()
                        .with_shortcuts(["alt+space", "ctrl+shift+s", "ctrl+shift+n"])
                        .expect("failed to register global shortcuts")
                        .with_handler(|app, shortcut, event| {
                            // Act only on key-down to prevent double-firing.
                            if event.state != ShortcutState::Pressed {
                                return;
                            }
                            if shortcut.matches(Modifiers::ALT, Code::Space) {
                                toggle_window_focus(app);
                            } else if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyS) {
                                let _ = app.emit("shortcut-toggle-sidebar", ());
                            } else if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyN) {
                                let _ = app.emit("shortcut-new-conversation", ());
                            }
                        })
                        .build(),
                )?;
            }
            Ok(())
        })
        // ── Clipboard manager plugin ────────────────────────────────────────
        .plugin(tauri_plugin_clipboard_manager::init())
        // ── Opener plugin ───────────────────────────────────────────────────
        .plugin(tauri_plugin_opener::init())
        // ── SQLite plugin ───────────────────────────────────────────────────
        .plugin(tauri_plugin_sql::Builder::default().build())
        // ── Invoke handler ──────────────────────────────────────────────────
        // 搜索请求走 Rust 侧转发，避免 webview 直连 SerpApi 的 CORS 限制。
        .invoke_handler(tauri::generate_handler![search_web, parse_document])
        // ── Run ─────────────────────────────────────────────────────────────
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
