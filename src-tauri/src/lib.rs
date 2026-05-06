// src-tauri/src/lib.rs
//
// Tauri v2 application runtime.
// Responsibilities:
//   - Register tauri-plugin-global-shortcut (Alt+Space → focus toggle)
//   - Register tauri-plugin-sql (SQLite backend)
//   - Window is configured as borderless + transparent via tauri.conf.json.

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
// Public entry point (called from main.rs)
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── Global shortcut plugin ──────────────────────────────────────────
        // `.with_shortcuts` pre-registers shortcuts at startup.
        // `.with_handler` receives ALL shortcut events; we filter by matching.
        .setup(|app| {
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
        // ── SQLite plugin ───────────────────────────────────────────────────
        .plugin(tauri_plugin_sql::Builder::default().build())
        // ── Invoke handler ──────────────────────────────────────────────────
        // No custom commands at this time; extend with tauri::generate_handler!
        // as the project grows.
        .invoke_handler(tauri::generate_handler![])
        // ── Run ─────────────────────────────────────────────────────────────
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
