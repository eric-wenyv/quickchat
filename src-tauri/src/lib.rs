// src-tauri/src/lib.rs
//
// Tauri v2 application runtime.
// Responsibilities:
//   - Register tauri-plugin-global-shortcut (Alt+Space → focus toggle)
//   - Register tauri-plugin-sql (SQLite backend)
//   - Window is configured as borderless + transparent via tauri.conf.json.
//   - System tray integration (close → hide to tray, keep running in background)

use serde_json::Value;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

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
                        .with_shortcuts(["alt+space"])
                        .expect("failed to register Alt+Space shortcut")
                        .with_handler(|app, shortcut, event| {
                            // Act only on key-down to prevent double-firing.
                            if event.state == ShortcutState::Pressed
                                && shortcut.matches(Modifiers::ALT, Code::Space)
                            {
                                toggle_window_focus(app);
                            }
                        })
                        .build(),
                )?;
            }
            Ok(())
        })
        // ── Clipboard manager plugin ────────────────────────────────────────
        .plugin(tauri_plugin_clipboard_manager::init())
        // ── SQLite plugin ───────────────────────────────────────────────────
        .plugin(tauri_plugin_sql::Builder::default().build())
        // ── Invoke handler ──────────────────────────────────────────────────
        // 搜索请求走 Rust 侧转发，避免 webview 直连 SerpApi 的 CORS 限制。
        .invoke_handler(tauri::generate_handler![search_web])
        // ── Run ─────────────────────────────────────────────────────────────
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
