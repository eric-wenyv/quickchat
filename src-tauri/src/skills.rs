// src-tauri/src/skills.rs
//
// Skill 管理：扫描、读取、创建、删除、导入 Skill。
//
// 存储位置：桌面端 $HOME/.chat/skills/<skill-dir>/SKILL.md；
// 移动端（无可靠 HOME）存放在应用私有配置目录 skills/ 下。
// 桌面端兼容 Claude (~/.claude/skills) 与 Codex (~/.codex/skills) 的 Skill 目录格式，
// 导入时复制整个目录（含脚本、模板、符号链接目标等），同名时 Claude 优先。

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize, Clone)]
pub struct SkillMeta {
    /// 目录名
    id: String,
    /// 展示名称
    name: String,
    description: String,
    /// claude | codex | builtin | local
    source: String,
    /// Skill 目录的绝对路径
    path: String,
    /// 目录中除 SKILL.md 外是否还有其它可见文件（脚本、模板等）
    has_assets: bool,
    disable_model_invocation: bool,
}

#[derive(Serialize)]
pub struct ImportedSkill {
    name: String,
    source: String,
}

#[derive(Serialize)]
pub struct ImportReport {
    imported: Vec<ImportedSkill>,
    skipped_existing: Vec<String>,
}

// ---------------------------------------------------------------------------
// 路径与安全校验
// ---------------------------------------------------------------------------

fn skills_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(desktop)]
    {
        // 桌面端沿用 ~/.chat/skills，与 Claude/Codex 导入约定保持一致
        let home = app
            .path()
            .home_dir()
            .map_err(|e| format!("无法解析用户主目录: {e}"))?;
        Ok(home.join(".chat").join("skills"))
    }
    #[cfg(mobile)]
    {
        // Android 上 HOME 环境变量不可靠，Skill 存放在应用私有配置目录
        app.path()
            .app_config_dir()
            .map(|dir| dir.join("skills"))
            .map_err(|e| format!("无法解析应用数据目录: {e}"))
    }
}

/// Skill 目录名只允许安全的 slug 字符，杜绝路径穿越
fn is_valid_skill_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn resolve_skill_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_valid_skill_id(id) {
        return Err(format!("非法的 Skill 名称: {id}"));
    }
    Ok(root.join(id))
}

// ---------------------------------------------------------------------------
// Frontmatter 解析（对齐 Claude 的 YAML 解析语义）
//
// SKILL.md 头部是标准 YAML frontmatter，Claude（gray-matter + js-yaml）按
// YAML 解析。官方 Skill 大量使用块标量写法，单行解析会把描述读成 ">"：
//
//   description: >
//     折叠为单行的多行描述
//
// 这里实现 Skill 实际用到的 YAML 子集：普通标量（含更缩进续行的折叠）、
// 单/双引号标量、块标量（| 与 >，含 -/+ 裁剪与数字缩进指示）、# 注释剥离。
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Frontmatter {
    name: Option<String>,
    description: Option<String>,
    disable_model_invocation: bool,
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// 顶层映射键：`name`、`disable-model-invocation` 等（字母数字_-，冒号前）
fn split_key(line: &str) -> Option<(&str, &str)> {
    let (key, rest) = line.split_once(':')?;
    let key = key.trim();
    if key.is_empty()
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    Some((key, rest))
}

/// 块标量头：| 或 > 加可选的缩进指示数字与 -/+ 裁剪指示（如 `>`、`|-`、`|2+`）
fn block_scalar_header(rest: &str) -> Option<char> {
    let mut chars = rest.chars();
    let style = chars.next()?;
    if style != '|' && style != '>' {
        return None;
    }
    let mut seen_digit = false;
    let mut seen_chomp = false;
    for c in chars {
        match c {
            '1'..='9' if !seen_digit => seen_digit = true,
            '-' | '+' if !seen_chomp => seen_chomp = true,
            _ => return None,
        }
    }
    Some(style)
}

/// 剥离普通标量行内的注释（YAML：# 注释前必须有空白）
fn strip_plain_comment(s: &str) -> &str {
    match s.find(" #") {
        Some(pos) => &s[..pos],
        None => s,
    }
}

/// 折叠块标量（>）：相邻非空行以空格连接，空行变为换行，
/// 更缩进的行（相对块缩进还有前导空白）与其前后保留原换行
fn fold_block_lines(lines: &[String]) -> String {
    let mut out = String::new();
    let mut prev_more_indented: Option<bool> = None;
    let mut pending_newlines = 0usize;
    for line in lines {
        if line.trim().is_empty() {
            pending_newlines += 1;
            continue;
        }
        let more_indented = line.starts_with(' ');
        match prev_more_indented {
            Some(_) if pending_newlines > 0 => out.push_str(&"\n".repeat(pending_newlines)),
            Some(prev) if prev || more_indented => out.push('\n'),
            Some(_) => out.push(' '),
            None => {}
        }
        pending_newlines = 0;
        out.push_str(line);
        prev_more_indented = Some(more_indented);
    }
    out
}

/// 解析某个键的标量值，返回 (值, 键行之后额外消耗的行数)
fn parse_scalar_value(lines: &[&str], key_index: usize, rest: &str) -> (String, usize) {
    let rest = rest.trim();

    // 块标量：| 字面量 / > 折叠
    if let Some(style) = block_scalar_header(rest) {
        let mut i = key_index + 1;
        let mut block_indent: Option<usize> = None;
        let mut raw: Vec<String> = Vec::new();
        while i < lines.len() {
            let line = lines[i];
            if line.trim().is_empty() {
                raw.push(String::new());
                i += 1;
                continue;
            }
            let ind = indent_of(line);
            if block_indent.is_none() {
                block_indent = Some(ind);
            }
            if ind < block_indent.unwrap() {
                break;
            }
            raw.push(line[block_indent.unwrap()..].to_string());
            i += 1;
        }
        while raw.last().is_some_and(|l| l.trim().is_empty()) {
            raw.pop();
        }
        let value = if style == '>' {
            fold_block_lines(&raw)
        } else {
            raw.join("\n")
        };
        return (value.trim_end().to_string(), i - key_index - 1);
    }

    // 引号标量（按单行尽力解析：'' 与 \" 等转义）
    if let Some(quote) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let mut value = String::new();
        let mut chars = rest[quote.len_utf8()..].chars().peekable();
        while let Some(c) = chars.next() {
            if quote == '"' && c == '\\' {
                match chars.next() {
                    Some('n') => value.push('\n'),
                    Some('t') => value.push('\t'),
                    Some('r') => value.push('\r'),
                    Some('"') => value.push('"'),
                    Some('\\') => value.push('\\'),
                    Some(other) => {
                        value.push('\\');
                        value.push(other);
                    }
                    None => value.push('\\'),
                }
                continue;
            }
            if c == quote {
                if quote == '\'' && chars.peek() == Some(&'\'') {
                    chars.next();
                    value.push('\'');
                    continue;
                }
                break;
            }
            value.push(c);
        }
        return (value.trim().to_string(), 0);
    }

    // 普通标量：截掉 # 注释；键值为空或后续行更缩进时，续行折叠进来
    let mut value = if rest.starts_with('#') {
        String::new()
    } else {
        strip_plain_comment(rest).trim().to_string()
    };
    let mut i = key_index + 1;
    let mut pending_newlines = 0usize;
    while i < lines.len() {
        let line = lines[i];
        if line.trim().is_empty() {
            if value.is_empty() {
                break;
            }
            pending_newlines += 1;
            i += 1;
            continue;
        }
        if indent_of(line) == 0 {
            break;
        }
        let cont = strip_plain_comment(line).trim().to_string();
        if cont.is_empty() {
            i += 1;
            continue;
        }
        if value.is_empty() && pending_newlines == 0 {
            value = cont;
        } else if pending_newlines > 0 {
            value.push_str(&"\n".repeat(pending_newlines));
            value.push_str(&cont);
            pending_newlines = 0;
        } else {
            value.push(' ');
            value.push_str(&cont);
        }
        i += 1;
    }
    (value.trim().to_string(), i - key_index - 1)
}

fn parse_frontmatter(content: &str) -> Frontmatter {
    let trimmed = content.trim_start();
    let mut lines_iter = trimmed.lines();
    let Some(first) = lines_iter.next() else {
        return Frontmatter::default();
    };
    if first.trim() != "---" {
        return Frontmatter::default();
    }
    let all: Vec<&str> = lines_iter
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    let end = all
        .iter()
        .position(|l| l.trim() == "---")
        .unwrap_or(all.len());
    let lines = &all[..end];

    let mut fields: Vec<(String, String)> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            i += 1;
            continue;
        }
        // 只认缩进为 0 的顶层键；嵌套结构（列表等）Skill 元数据用不到，跳过
        if indent_of(line) > 0 {
            i += 1;
            continue;
        }
        let Some((key, rest)) = split_key(line) else {
            i += 1;
            continue;
        };
        let (value, consumed) = parse_scalar_value(lines, i, rest);
        fields.push((key.to_string(), value));
        i += 1 + consumed;
    }

    let get = |k: &str| {
        fields
            .iter()
            .find(|(key, _)| key == k)
            .map(|(_, v)| v.clone())
    };
    Frontmatter {
        name: get("name").filter(|v| !v.is_empty()),
        description: get("description").filter(|v| !v.is_empty()),
        disable_model_invocation: get("disable-model-invocation")
            .or_else(|| get("disable_model_invocation"))
            .is_some_and(|v| matches!(v.to_lowercase().as_str(), "true" | "yes" | "on" | "1")),
    }
}

fn read_source(path: &Path) -> String {
    fs::read_to_string(path.join(".source"))
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "local".to_string())
}

fn dir_has_assets(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|rd| {
            rd.flatten().any(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n != "SKILL.md" && !n.starts_with('.')
            })
        })
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// 递归复制（排除 .git；符号链接解析为目标内容复制，保证链接类 Skill 可用）
// ---------------------------------------------------------------------------

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {}: {e}", dst.display()))?;
    let entries = fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {e}", src.display()))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name == ".git" {
            continue;
        }
        let src_path = entry.path();
        let dst_path = dst.join(&name);
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if file_type.is_file() {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("复制文件失败 {}: {e}", src_path.display()))?;
        } else if file_type.is_symlink() {
            // 解析符号链接：复制其指向的实际内容，保证 Skill 迁移后仍然完整
            if let Ok(meta) = fs::metadata(&src_path) {
                if meta.is_dir() {
                    copy_dir_recursive(&src_path, &dst_path)?;
                } else if meta.is_file() {
                    fs::copy(&src_path, &dst_path)
                        .map_err(|e| format!("复制链接目标失败 {}: {e}", src_path.display()))?;
                }
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_skills(app: tauri::AppHandle) -> Result<Vec<SkillMeta>, String> {
    list_skills_at(&skills_root(&app)?)
}

fn list_skills_at(root: &Path) -> Result<Vec<SkillMeta>, String> {
    fs::create_dir_all(root).map_err(|e| format!("创建 Skill 目录失败: {e}"))?;

    let mut skills = Vec::new();
    let entries = fs::read_dir(root).map_err(|e| format!("读取 Skill 目录失败: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        if dir_name.starts_with('.') {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let content = fs::read_to_string(&skill_md).unwrap_or_default();
        let fm = parse_frontmatter(&content);
        skills.push(SkillMeta {
            id: dir_name.clone(),
            name: fm.name.unwrap_or(dir_name),
            description: fm.description.unwrap_or_default(),
            source: read_source(&path),
            path: path.to_string_lossy().to_string(),
            has_assets: dir_has_assets(&path),
            disable_model_invocation: fm.disable_model_invocation,
        });
    }
    skills.sort_by_key(|a| a.name.to_lowercase());
    Ok(skills)
}

#[tauri::command]
pub fn read_skill(app: tauri::AppHandle, id: String) -> Result<String, String> {
    read_skill_at(&skills_root(&app)?, &id)
}

fn read_skill_at(root: &Path, id: &str) -> Result<String, String> {
    let dir = resolve_skill_dir(root, id)?;
    fs::read_to_string(dir.join("SKILL.md")).map_err(|e| format!("读取 Skill 失败: {e}"))
}

/// 描述内联写入 YAML 是否安全（不含冒号/井号/引号等特殊字符、不以空白结尾）
fn is_plain_inline_safe(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with([' ', '\t', '#'])
        && !s.starts_with("- ")
        && !s.starts_with("? ")
        && !s.starts_with(": ")
        && !s.ends_with([' ', '\t'])
        && !s.chars().any(|c| {
            matches!(
                c,
                ':' | '#'
                    | '"'
                    | '\''
                    | '\n'
                    | '\r'
                    | '{'
                    | '}'
                    | '['
                    | ']'
                    | ','
                    | '&'
                    | '*'
                    | '!'
                    | '|'
                    | '>'
                    | '%'
                    | '@'
                    | '`'
            )
        })
}

/// 序列化 description 字段：简单文本内联单行；含特殊字符时改用字面量块标量
/// （|-），保证 Claude / Codex 的 YAML 解析器读到的文本与用户输入完全一致
fn format_description_yaml(desc: &str) -> String {
    if is_plain_inline_safe(desc) {
        return format!("description: {desc}\n");
    }
    if desc.is_empty() {
        return "description: \"\"\n".to_string();
    }
    let indented = desc
        .lines()
        .map(|l| {
            if l.is_empty() {
                String::new()
            } else {
                format!("  {l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("description: |-\n{indented}\n")
}

#[tauri::command]
pub fn create_skill(
    app: tauri::AppHandle,
    name: String,
    description: String,
    content: String,
    disable_model_invocation: Option<bool>,
) -> Result<String, String> {
    create_skill_at(
        &skills_root(&app)?,
        name,
        description,
        content,
        disable_model_invocation,
    )
}

fn create_skill_at(
    root: &Path,
    name: String,
    description: String,
    content: String,
    disable_model_invocation: Option<bool>,
) -> Result<String, String> {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if !is_valid_skill_id(&slug) {
        return Err("名称无效：请使用字母、数字、连字符或下划线".to_string());
    }
    let dir = resolve_skill_dir(root, &slug)?;
    if dir.exists() {
        return Err(format!("Skill \"{slug}\" 已存在"));
    }
    fs::create_dir_all(&dir).map_err(|e| format!("创建 Skill 目录失败: {e}"))?;
    let body = content.trim();
    let disable_line = if disable_model_invocation.unwrap_or(false) {
        "disable-model-invocation: true\n"
    } else {
        ""
    };
    let markdown = format!(
        "---\nname: {slug}\n{}{}---\n\n{}\n",
        format_description_yaml(description.trim()),
        disable_line,
        if body.is_empty() {
            format!("# {slug}\n")
        } else {
            body.to_string()
        }
    );
    fs::write(dir.join("SKILL.md"), markdown).map_err(|e| format!("写入 SKILL.md 失败: {e}"))?;
    Ok(slug)
}

#[tauri::command]
pub fn delete_skill(app: tauri::AppHandle, id: String) -> Result<(), String> {
    delete_skill_at(&skills_root(&app)?, &id)
}

fn delete_skill_at(root: &Path, id: &str) -> Result<(), String> {
    let dir = resolve_skill_dir(root, id)?;
    if !dir.is_dir() {
        return Err(format!("Skill \"{id}\" 不存在"));
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("删除 Skill 失败: {e}"))?;
    Ok(())
}

/// 扫描一个外部 Skill 来源目录，返回 (目录名, frontmatter name, 源路径) 列表
fn scan_external_source(dir: &Path) -> Vec<(String, String, PathBuf)> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        // 跳过隐藏目录（包括 Codex 的 .system 内置 skills）
        if dir_name.starts_with('.') {
            continue;
        }
        if !path.join("SKILL.md").is_file() {
            continue;
        }
        let fm_name = fs::read_to_string(path.join("SKILL.md"))
            .ok()
            .and_then(|c| parse_frontmatter(&c).name)
            .unwrap_or_else(|| dir_name.clone());
        found.push((dir_name, fm_name, path));
    }
    found
}

#[tauri::command]
pub fn import_external_skills(app: tauri::AppHandle) -> Result<ImportReport, String> {
    import_external_skills_at(&skills_root(&app)?, &external_skill_sources(&app))
}

/// 外部 Skill 来源目录。移动端没有外部工具的 Skill 目录，返回空列表。
#[cfg(desktop)]
fn external_skill_sources(app: &tauri::AppHandle) -> Vec<(String, PathBuf)> {
    let Ok(home) = app.path().home_dir() else {
        return Vec::new();
    };
    vec![
        ("claude".to_string(), home.join(".claude").join("skills")),
        ("codex".to_string(), home.join(".codex").join("skills")),
    ]
}

#[cfg(mobile)]
fn external_skill_sources(_app: &tauri::AppHandle) -> Vec<(String, PathBuf)> {
    Vec::new()
}

fn import_external_skills_at(
    root: &Path,
    sources: &[(String, PathBuf)],
) -> Result<ImportReport, String> {
    fs::create_dir_all(root).map_err(|e| format!("创建 Skill 目录失败: {e}"))?;

    let mut report = ImportReport {
        imported: Vec::new(),
        skipped_existing: Vec::new(),
    };

    // 已占用的名称（目录名 + frontmatter name），Claude 先扫描，因此同名时 Claude 优先
    let mut taken: HashSet<String> = HashSet::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().to_string();
            taken.insert(dir_name.clone());
            if let Ok(content) = fs::read_to_string(path.join("SKILL.md")) {
                if let Some(fm_name) = parse_frontmatter(&content).name {
                    taken.insert(fm_name);
                }
            }
        }
    }

    // 传入的 sources 已按优先级排序：同名冲突时排在前面的来源胜出
    for (source, dir) in sources {
        for (dir_name, fm_name, src_path) in scan_external_source(dir) {
            if taken.contains(&dir_name) || taken.contains(&fm_name) {                report.skipped_existing.push(fm_name);
                continue;
            }
            let dst = root.join(&dir_name);
            copy_dir_recursive(&src_path, &dst)?;
            let _ = fs::write(dst.join(".source"), source);
            taken.insert(dir_name);
            taken.insert(fm_name.clone());
            report.imported.push(ImportedSkill {
                name: fm_name,
                source: source.to_string(),
            });
        }
    }

    Ok(report)
}

// ---------------------------------------------------------------------------
// 内置 Skill：Skill 使用/导入指南
// ---------------------------------------------------------------------------

const BUILTIN_SKILL_ID: &str = "quick-chat-skill-guide";

/// 内置 Skill 内容版本：升级内容时递增，ensure_builtin_skill 会就地更新旧版本
const BUILTIN_SKILL_VERSION: &str = "4";

const BUILTIN_SKILL_MD: &str = r#"---
name: quick-chat-skill-guide
description: >
  Quick Chat Skill 使用指南：斜杠命令与 AI 自主调用、从 Claude / Codex 导入 Skill、
  新建 Skill、目录结构与 SKILL.md frontmatter 规范。Use when the user asks how to
  create, import, preview, or invoke skills in Quick Chat, or how SKILL.md works.
---

# Quick Chat Skill 指南

## 什么是 Skill

Skill 是一个以 Markdown 描述的能力包，遵循 Claude / Codex 的 Skill 目录规范。
每个 Skill 是一个文件夹，其中必须包含一个 `SKILL.md`，还可以携带脚本、模板、参考文档等附属文件。

## 在对话中调用 Skill

有两种调用方式：

1. **用户主动调用（斜杠命令）**：在输入框输入 `/` 会弹出 Skill 列表，选择后发送，
   例如 `/generate-pdf 帮我做一份简历`。该 Skill 的完整指引会随这条消息注入对话，
   并在整个会话中持续生效（消息里的 HTML 注释携带指引，界面上不可见）。
2. **AI 自主调用**：发送消息时，模型会看到可调用 Skill 的目录（名称 + 描述），
   当请求与某个 Skill 的用途匹配时，模型会通过 `use_skill` 工具自动加载其完整指引并遵循。

### 禁止 AI 自主调用

在 `SKILL.md` 的 frontmatter 中加入（Claude 规范字段，`true` = 禁止，缺省或 `false` = 允许）：

```markdown
---
name: my-skill
description: …
disable-model-invocation: true
---
```

标注后该 Skill 不会出现在 AI 的可用目录中，只能由用户通过 `/my-skill` 主动调用。
新建 Skill 时勾选「仅手动调用」也会写入此字段。
直接编辑 SKILL.md 增删该字段无需重启：下一条消息发送时会重新扫描并即时生效。

## 目录结构

```
~/.chat/skills/
└── <skill-name>/
    ├── SKILL.md        # 必需：Skill 说明（含 frontmatter）
    ├── scripts/        # 可选：bash/python 等辅助脚本
    └── templates/      # 可选：模板、参考文件
```

`SKILL.md` 开头的 frontmatter（YAML）定义名称与描述，遵循 Claude Skill 规范：

- `name`：小写字母、数字、连字符，与目录名一致
- `description`：说明这个 Skill 做什么、什么时候用（when to use / triggers），上限 1024 字符
- 较长的描述推荐用 `>` 折叠块写法：源码里分多行书写，解析时自动折叠成一行

```markdown
---
name: my-skill
description: >
  一句话说明这个 Skill 做什么、什么时候用（when to use / triggers）。
---

# 正文：具体的使用指引……
```

## 如何导入 Skill

1. **自动导入**：应用启动时会自动扫描 `~/.claude/skills/` 与 `~/.codex/skills/`，
   把新增的 Skill 复制到 `~/.chat/skills/`。两边同名时优先导入 Claude 的版本；
   本地已存在的同名 Skill 不会被覆盖。
2. **手动导入**：在 Skill 管理界面点击右上角「导入 Claude/Codex」按钮，立即重新扫描。
3. **手动复制**：直接把任何符合规范的 Skill 文件夹拷贝到 `~/.chat/skills/` 即可被识别。
4. **新建**：点击「新建 Skill」，填写名称、描述和 Markdown 内容，会自动写入 `~/.chat/skills/`。

## 在 Skill 管理界面

点击侧边栏的 Skills 图标进入管理界面：左侧列表悬浮可查看描述，点击可预览完整内容；
「在对话中使用」会新建一个对话并把该 Skill 作为系统提示词注入。

> 注意：Quick Chat 是对话应用，只注入 Skill 的文本内容，**不会执行**其中的 bash/python 脚本。
> 包含可执行脚本的 Skill（如需要跑命令的场景）请在 Claude Code / Codex 中使用；
> 本应用会完整保留这些文件，方便随时在文件管理器中查看或拷回。
"#;

#[tauri::command]
pub fn ensure_builtin_skill(app: tauri::AppHandle) -> Result<(), String> {
    ensure_builtin_skill_at(&skills_root(&app)?)
}

/// 首次运行时写入内置 Skill；内容升级时就地更新（用户已删除的则不复活）。
/// 通过 `.builtin-installed` 标记文件记录已安装的版本。
fn ensure_builtin_skill_at(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("创建 Skill 目录失败: {e}"))?;
    let flag = root.join(".builtin-installed");
    let installed_version = fs::read_to_string(&flag).unwrap_or_default();
    if installed_version.trim() == BUILTIN_SKILL_VERSION {
        return Ok(());
    }
    let dir = root.join(BUILTIN_SKILL_ID);
    // 目录存在则升级内容；目录不存在但只有旧版本标记，说明用户删过旧版 ——
    // 若从未安装过（无标记），则全新写入。
    let never_installed = installed_version.trim().is_empty();
    if dir.exists() || never_installed {
        fs::create_dir_all(&dir).map_err(|e| format!("创建内置 Skill 目录失败: {e}"))?;
        fs::write(dir.join("SKILL.md"), BUILTIN_SKILL_MD)
            .map_err(|e| format!("写入内置 Skill 失败: {e}"))?;
        let _ = fs::write(dir.join(".source"), "builtin");
    }
    let _ = fs::write(&flag, BUILTIN_SKILL_VERSION);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests：在临时目录下端到端验证 Skill 的导入/增删/读取逻辑
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn write_skill(root: &Path, dir: &str, fm_name: &str, desc: &str) {
        let d = root.join(dir);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("SKILL.md"),
            format!("---\nname: {fm_name}\ndescription: {desc}\n---\n\n# {fm_name}\n"),
        )
        .unwrap();
    }

    /// 单个测试函数串行跑完全部断言
    #[test]
    fn skills_end_to_end() {
        let tmp =
            std::env::temp_dir().join(format!("quick_chat_skills_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let root = tmp.join(".chat/skills");
        // 外部来源：claude 有 shared + claude-only + folded（块标量描述）；
        // codex 有 shared（应输给 claude）、codex-only、.system 内置（应跳过）。
        // claude-only 带附属脚本与符号链接。
        let sources = [
            ("claude".to_string(), tmp.join(".claude/skills")),
            ("codex".to_string(), tmp.join(".codex/skills")),
        ];
        let claude = &sources[0].1;
        let codex = &sources[1].1;
        write_skill(claude, "shared", "shared", "claude 版本");
        write_skill(claude, "claude-only", "claude-only", "带附件");
        fs::write(claude.join("claude-only/run.sh"), "#!/bin/sh\necho hi\n").unwrap();
        // Claude 官方 Skill 的折叠块写法：description: > + 缩进多行；
        // 布尔值用首字母大写的 True（js-yaml 同样识别）
        fs::create_dir_all(claude.join("folded")).unwrap();
        fs::write(
            claude.join("folded/SKILL.md"),
            "---\nname: folded\ndescription: >\n  第一行说明\n  第二行：带冒号与 \"引号\"\ndisable-model-invocation: True\n---\n\n# folded\n",
        )
        .unwrap();
        write_skill(codex, "shared", "shared", "codex 版本");
        write_skill(codex, "codex-only", "codex-only", "codex 独有");
        write_skill(codex, ".system/sys", "sys", "内置应跳过");

        // 内置 Skill：首次写入，且写入标记
        ensure_builtin_skill_at(&root).unwrap();
        assert!(root.join("quick-chat-skill-guide/SKILL.md").is_file());
        let guide = read_skill_at(&root, "quick-chat-skill-guide").unwrap();
        assert!(guide.contains("如何导入 Skill"));

        // 导入：claude 优先、跳过 .system、跳过已存在
        let report = import_external_skills_at(&root, &sources).unwrap();
        assert_eq!(report.imported.len(), 4);
        let names: HashSet<&str> = report.imported.iter().map(|i| i.name.as_str()).collect();
        assert!(
            names.contains("shared")
                && names.contains("claude-only")
                && names.contains("folded")
                && names.contains("codex-only")
        );
        let shared = report.imported.iter().find(|i| i.name == "shared").unwrap();
        assert_eq!(shared.source, "claude");
        assert!(!root.join("sys").exists());

        // 附属文件被完整复制
        assert!(root.join("claude-only/run.sh").is_file());
        assert_eq!(
            fs::read_to_string(root.join("shared/.source")).unwrap(),
            "claude"
        );

        // 重复导入：全部跳过（claude 3 个 + codex 2 个），不覆盖
        let report2 = import_external_skills_at(&root, &sources).unwrap();
        assert_eq!(report2.imported.len(), 0);
        assert_eq!(report2.skipped_existing.len(), 5);

        // 列表：frontmatter 解析 + 来源标记
        let list = list_skills_at(&root).unwrap();
        assert_eq!(list.len(), 5); // guide + 4 导入
        let claude_only = list.iter().find(|s| s.id == "claude-only").unwrap();
        assert_eq!(claude_only.description, "带附件");
        assert!(claude_only.has_assets);
        // 折叠块标量描述按 Claude（js-yaml）语义折叠为单行
        let folded = list.iter().find(|s| s.id == "folded").unwrap();
        assert_eq!(folded.description, "第一行说明 第二行：带冒号与 \"引号\"");
        assert!(folded.disable_model_invocation);
        let guide_meta = list
            .iter()
            .find(|s| s.id == "quick-chat-skill-guide")
            .unwrap();
        assert_eq!(guide_meta.source, "builtin");
        assert!(!guide_meta.has_assets);
        // 内置指南自身也用折叠块写法，解析结果不应残留 ">"
        assert!(guide_meta
            .description
            .starts_with("Quick Chat Skill 使用指南"));
        assert!(!guide_meta.description.contains('>'));

        // 新建：slug 化 + 重名拒绝 + disable-model-invocation 写入与解析
        create_skill_at(&root, "My Skill".into(), "测试".into(), "# 你好".into(), None).unwrap();
        let created = read_skill_at(&root, "my-skill").unwrap();
        assert!(created.contains("name: my-skill") && created.contains("# 你好"));
        assert!(create_skill_at(&root, "my-skill".into(), String::new(), String::new(), None).is_err());

        create_skill_at(
            &root,
            "manual-only".into(),
            "仅手动".into(),
            String::new(),
            Some(true),
        )
        .unwrap();
        let list2 = list_skills_at(&root).unwrap();
        let manual = list2.iter().find(|s| s.id == "manual-only").unwrap();
        assert!(manual.disable_model_invocation);
        let auto = list2.iter().find(|s| s.id == "my-skill").unwrap();
        assert!(!auto.disable_model_invocation);

        // 含冒号/引号的描述写入字面量块标量（|-），保证 Claude 的 YAML 解析一致
        let colon_desc = "使用时机：当用户说 \"帮我做简历\" 时";
        create_skill_at(&root, "colon-desc".into(), colon_desc.into(), String::new(), None).unwrap();
        let colon_file = read_skill_at(&root, "colon-desc").unwrap();
        assert!(colon_file.contains("description: |-\n  使用时机：当用户说 \"帮我做简历\" 时\n"));
        let list3 = list_skills_at(&root).unwrap();
        assert_eq!(
            list3
                .iter()
                .find(|s| s.id == "colon-desc")
                .unwrap()
                .description,
            colon_desc
        );

        // 删除 + 路径穿越防护
        delete_skill_at(&root, "my-skill").unwrap();
        delete_skill_at(&root, "manual-only").unwrap();
        delete_skill_at(&root, "colon-desc").unwrap();
        assert!(!root.join("my-skill").exists());
        assert!(delete_skill_at(&root, "../..").is_err());
        assert!(read_skill_at(&root, "../..").is_err());

        let _ = fs::remove_dir_all(&tmp);
    }
}
