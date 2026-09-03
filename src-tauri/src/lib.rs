// src-tauri/src/lib.rs
//
// application runtime.
// Responsibilities:
//   - Register tauri-plugin-global-shortcut (desktop)
//   - Single-instance plugin + `--toggle` arg (desktop)
//   - Register tauri-plugin-sql
//   - Window is configured as borderless + transparent (desktop)
//   - System tray integration (desktop)

#[cfg(desktop)]
use base64::Engine;
use serde_json::{json, Value};
#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

#[cfg(target_os = "linux")]
mod linux_blur;
mod skills;

// ---------------------------------------------------------------------------
// Command: parse PDF / Word document via Python (desktop only; no Python
// runtime exists on mobile — see parse_document mobile stub below)
// ---------------------------------------------------------------------------
#[cfg(desktop)]
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

    std::fs::write(&temp_path, &bytes).map_err(|e| format!("write temp file failed: {}", e))?;

    // locate Python 
    fn find_python() -> Result<String, String> {
        // Windows
        #[cfg(target_os = "windows")]
        {
            for name in ["python", "py", "python3"] {
                if let Ok(output) = std::process::Command::new("where").arg(name).output() {
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

        // Unix
        #[cfg(not(target_os = "windows"))]
        {
            for name in ["python3", "python"] {
                if let Ok(output) = std::process::Command::new("which").arg(name).output() {
                    if output.status.success() {
                        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if !path.is_empty() {
                            return Ok(path);
                        }
                    }
                }
            }
        }

        // Fallback: try bare commands
        for cmd in ["python3", "python", "py"] {
            if std::process::Command::new(cmd)
                .arg("--version")
                .output()
                .is_ok()
            {
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
            if stderr.is_empty() {
                "(empty)"
            } else {
                &stderr
            },
            if stdout.is_empty() {
                "(empty)"
            } else {
                &stdout
            },
            python_path
        ))
    }
}

// 移动端无 Python 运行时：文档解析暂不支持，后续替换为 Rust 原生解析库
#[cfg(mobile)]
#[tauri::command]
fn parse_document(_data: String, _ext: String) -> Result<String, String> {
    Err("移动端暂不支持 PDF / Word 文档解析".to_string())
}

// ---------------------------------------------------------------------------
// setup system tray icon with menu (desktop)
// ---------------------------------------------------------------------------
#[cfg(desktop)]
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
// Command: fetch a web page and extract readable text 
// ---------------------------------------------------------------------------
/// 正文返回给模型的最大字符数
const FETCH_URL_MAX_CHARS: usize = 20_000;
/// 响应体读取上限
const FETCH_URL_MAX_BYTES: usize = 5 * 1024 * 1024;
/// 提出 HTML 中不提供正文语义的标签
const HTML_STRIP_SELECTOR: &str = "script, style, noscript, template, svg, iframe, head";
/// 提取文本时在边界补换行，保留基本段落结构。
const HTML_BLOCK_SELECTOR: &str =
    "p, div, br, hr, li, ul, ol, tr, table, section, article, header, footer, aside, nav, \
     h1, h2, h3, h4, h5, h6, blockquote, pre, figure, figcaption, form, fieldset, dl, dt, dd";

fn extract_html_text(html: &str) -> (Option<String>, String) {
    use scraper::{Html, Selector};

    let mut doc = Html::parse_document(html);

    let title = Selector::parse("title")
        .ok()
        .and_then(|sel| doc.select(&sel).next())
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|t| !t.is_empty());

    // 剔除无正文语义的节点
    if let Ok(strip) = Selector::parse(HTML_STRIP_SELECTOR) {
        let ids: Vec<_> = doc.select(&strip).map(|el| el.id()).collect();
        for id in ids {
            if let Some(mut node) = doc.tree.get_mut(id) {
                node.detach();
            }
        }
    }

    let body_html = Selector::parse("body")
        .ok()
        .and_then(|sel| doc.select(&sel).next())
        .map(|el| el.inner_html())
        .unwrap_or_default();

    // 在块级元素边界插入换行，再收集纯文本
    let mut body_doc = Html::parse_fragment(&body_html);
    if let Ok(blocks) = Selector::parse(HTML_BLOCK_SELECTOR) {
        let ids: Vec<_> = body_doc.select(&blocks).map(|el| el.id()).collect();
        for id in ids {
            if let Some(mut node) = body_doc.tree.get_mut(id) {
                node.append(scraper::node::Node::Text(scraper::node::Text {
                    text: "\n".into(),
                }));
            }
        }
    }

    let root = body_doc.root_element();
    let raw: String = root.text().collect();

    // 行内连续空白折叠为单空格，3 个以上换行折叠为 2 个
    let mut lines: Vec<String> = raw
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect();
    lines.retain(|line| !line.is_empty());
    (title, lines.join("\n"))
}

#[tauri::command]
async fn fetch_url(url: String) -> Result<Value, String> {
    let url = url.trim().to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("仅支持 http/https 链接: {url}"));
    }

    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求网页失败: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("网页请求失败 (HTTP {status})"));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取网页内容失败: {e}"))?;
    let bytes = if bytes.len() > FETCH_URL_MAX_BYTES {
        &bytes[..FETCH_URL_MAX_BYTES]
    } else {
        &bytes[..]
    };
    let raw_text = String::from_utf8_lossy(bytes).to_string();

    let is_html = content_type.contains("text/html") || content_type.contains("application/xhtml");
    let (title, content) = if is_html {
        extract_html_text(&raw_text)
    } else {
        (None, raw_text)
    };

    let truncated = content.chars().count() > FETCH_URL_MAX_CHARS;
    let content: String = if truncated {
        content.chars().take(FETCH_URL_MAX_CHARS).collect()
    } else {
        content
    };

    if content.trim().is_empty() {
        return Err("网页内容为空或无法提取正文（可能需要 JS 渲染或登录）".to_string());
    }

    Ok(json!({
        "url": url,
        "title": title,
        "content": content,
        "truncated": truncated,
    }))
}

#[cfg(test)]
mod tests {
    use super::extract_html_text;

    #[test]
    fn extracts_title_and_body_text_without_scripts() {
        let html = r#"
            <html>
            <head><title>示例页面</title><style>body{color:red}</style></head>
            <body>
                <h1>标题一</h1>
                <p>第一段   带有多余空格。</p>
                <script>alert('x')</script>
                <ul><li>项目一</li><li>项目二</li></ul>
            </body>
            </html>
        "#;
        let (title, text) = extract_html_text(html);
        assert_eq!(title.as_deref(), Some("示例页面"));
        assert!(text.contains("标题一"));
        assert!(text.contains("第一段 带有多余空格。"));
        assert!(text.contains("项目一"));
        assert!(!text.contains("alert"));
        assert!(!text.contains("color:red"));
    }

    #[test]
    fn collapses_blank_lines() {
        let html = "<body><p>a</p><div><div><div>b</div></div></div></body>";
        let (_, text) = extract_html_text(html);
        assert_eq!(text, "a\nb");
    }
}

// ---------------------------------------------------------------------------
// Public entry point 
// ---------------------------------------------------------------------------
#[cfg(desktop)]
fn toggle_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        if window.is_focused().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.set_focus();
        }
    } else {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// dev:fresh 启动时清空开发库
fn remove_db_files(dir: &std::path::Path, name: &str) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(dir.join(format!("{name}{suffix}")));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // ── Single instance: secondary launches forward here, then exit ──────
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        |app, argv, _cwd| {
            if argv.iter().any(|arg| arg == "--toggle") {
                toggle_main_window(app);
            } else if let Some(window) = app.get_webview_window("main") {
                // Plain relaunch: surface the already-running window.
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        },
    ));

    builder
        // ── Intercept close request: hide to tray instead of quitting (desktop) ──
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(e) = window.hide() {
                    eprintln!("[quick-chat] hide() on close requested: {e}");
                }
            }
            #[cfg(mobile)]
            {
                let _ = (window, event);
            }
        })
        // Global shortcut plugin
        // The quick-open shortcut is registered by the frontend so users can
        // change or disable it. These two shortcuts remain fixed app actions.
        .setup(|app| {
            // System tray setup (desktop)
            #[cfg(desktop)]
            if let Err(e) = setup_tray(app) {
                eprintln!("[quick-chat] tray setup error: {e}");
            }

            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = linux_blur::install(&window) {
                    eprintln!("[quick-chat] Linux blur setup error: {e}");
                }
            }

            // dev:fresh 时清空开发库（plugin-sql 将 sqlite: 相对路径解析到 app config dir）
            if let Ok(config_dir) = app.path().app_config_dir() {
                if std::env::var("QUICK_CHAT_DEV_DB").is_ok() {
                    remove_db_files(&config_dir, "quick_chat_dev.db");
                }
            }

            // Global shortcuts are desktop-only.
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::Builder as ShortcutBuilder;

                app.handle().plugin(
                    ShortcutBuilder::new()
                        .with_shortcuts(["ctrl+shift+s", "ctrl+shift+n"])
                        .expect("failed to register global shortcuts")
                        .with_handler(|app, shortcut, event| {
                            // Act only on key-down to prevent double-firing.
                            if event.state != ShortcutState::Pressed {
                                return;
                            }
                            let is_main_window_focused = app
                                .get_webview_window("main")
                                .and_then(|window| window.is_focused().ok())
                                .unwrap_or(false);
                            if !is_main_window_focused {
                                return;
                            }
                            if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyS) {
                                let _ = app.emit("shortcut-toggle-sidebar", ());
                            } else if shortcut
                                .matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyN)
                            {
                                let _ = app.emit("shortcut-new-conversation", ());
                            }
                        })
                        .build(),
                )?;
            }
            Ok(())
        })
        // Clipboard manager plugin 
        .plugin(tauri_plugin_clipboard_manager::init())
        // Opener plugin
        .plugin(tauri_plugin_opener::init())
        // SQLite plugin
        .plugin(tauri_plugin_sql::Builder::default().build())
        // Invoke handler
        .invoke_handler(tauri::generate_handler![
            fetch_url,
            parse_document,
            skills::list_skills,
            skills::read_skill,
            skills::create_skill,
            skills::delete_skill,
            skills::import_external_skills,
            skills::ensure_builtin_skill
        ])
        // ── Run ─────────────────────────────────────────────────────────────
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
