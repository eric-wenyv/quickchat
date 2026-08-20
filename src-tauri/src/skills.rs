// src-tauri/src/skills.rs
//
// Skill 管理：扫描、读取、创建、删除、导入 Skill。
//
// 存储位置：$HOME/.chat/skills/<skill-dir>/SKILL.md
// 兼容 Claude (~/.claude/skills) 与 Codex (~/.codex/skills) 的 Skill 目录格式，
// 导入时复制整个目录（含脚本、模板、符号链接目标等），同名时 Claude 优先。
//
// 每个导入的 Skill 目录内写入隐藏的 `.source` 文件记录来源（claude/codex/builtin），
// 不影响 Claude/Codex 对该目录的识别。

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct SkillMeta {
    /// 目录名，作为稳定 ID（读取/删除均使用它）
    id: String,
    /// 展示名称（frontmatter name，缺省时回退为目录名）
    name: String,
    description: String,
    /// claude | codex | builtin | local
    source: String,
    /// Skill 目录的绝对路径
    path: String,
    /// 目录中除 SKILL.md 外是否还有其它可见文件（脚本、模板等）
    has_assets: bool,
    /// frontmatter `disable-model-invocation: true` —— 禁止 AI 自主调用，仅用户可 / 调用
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

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())
}

fn skills_root() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".chat").join("skills"))
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

fn skill_dir(id: &str) -> Result<PathBuf, String> {
    if !is_valid_skill_id(id) {
        return Err(format!("非法的 Skill 名称: {id}"));
    }
    Ok(skills_root()?.join(id))
}

// ---------------------------------------------------------------------------
// Frontmatter 解析（行级简单解析：name / description 单行值）
// ---------------------------------------------------------------------------

/// 解析 frontmatter，返回 (name, description, disable_model_invocation)
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>, bool) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None, false);
    }
    let mut name = None;
    let mut description = None;
    let mut disable_model_invocation = false;
    // 跳过首行 "---"，读到下一个 "---" 为止
    for line in trimmed.lines().skip(1) {
        let line = line.trim_end();
        if line.trim() == "---" {
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .trim()
            .to_string();
        match key.trim() {
            "name" if !value.is_empty() => name = Some(value),
            "description" if !value.is_empty() => description = Some(value),
            "disable-model-invocation" | "disable_model_invocation" => {
                disable_model_invocation = matches!(value.as_str(), "true" | "yes" | "1");
            }
            _ => {}
        }
    }
    (name, description, disable_model_invocation)
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
    let entries =
        fs::read_dir(src).map_err(|e| format!("读取目录失败 {}: {e}", src.display()))?;
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
pub fn list_skills() -> Result<Vec<SkillMeta>, String> {
    let root = skills_root()?;
    fs::create_dir_all(&root).map_err(|e| format!("创建 Skill 目录失败: {e}"))?;

    let mut skills = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| format!("读取 Skill 目录失败: {e}"))?;
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
        let (fm_name, fm_desc, fm_disable) = parse_frontmatter(&content);
        skills.push(SkillMeta {
            id: dir_name.clone(),
            name: fm_name.unwrap_or(dir_name),
            description: fm_desc.unwrap_or_default(),
            source: read_source(&path),
            path: path.to_string_lossy().to_string(),
            has_assets: dir_has_assets(&path),
            disable_model_invocation: fm_disable,
        });
    }
    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(skills)
}

#[tauri::command]
pub fn read_skill(id: String) -> Result<String, String> {
    let dir = skill_dir(&id)?;
    fs::read_to_string(dir.join("SKILL.md")).map_err(|e| format!("读取 Skill 失败: {e}"))
}

#[tauri::command]
pub fn create_skill(
    name: String,
    description: String,
    content: String,
    disable_model_invocation: Option<bool>,
) -> Result<String, String> {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if !is_valid_skill_id(&slug) {
        return Err("名称无效：请使用字母、数字、连字符或下划线".to_string());
    }
    let dir = skill_dir(&slug)?;
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
        "---\nname: {slug}\ndescription: {}\n{}---\n\n{}\n",
        description.trim(),
        disable_line,
        if body.is_empty() { format!("# {slug}\n") } else { body.to_string() }
    );
    fs::write(dir.join("SKILL.md"), markdown).map_err(|e| format!("写入 SKILL.md 失败: {e}"))?;
    Ok(slug)
}

#[tauri::command]
pub fn delete_skill(id: String) -> Result<(), String> {
    let dir = skill_dir(&id)?;
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
            .and_then(|c| parse_frontmatter(&c).0)
            .unwrap_or_else(|| dir_name.clone());
        found.push((dir_name, fm_name, path));
    }
    found
}

#[tauri::command]
pub fn import_external_skills() -> Result<ImportReport, String> {
    let home = home_dir()?;
    let root = skills_root()?;
    fs::create_dir_all(&root).map_err(|e| format!("创建 Skill 目录失败: {e}"))?;

    let mut report = ImportReport {
        imported: Vec::new(),
        skipped_existing: Vec::new(),
    };

    // 已占用的名称（目录名 + frontmatter name），Claude 先扫描，因此同名时 Claude 优先
    let mut taken: HashSet<String> = HashSet::new();
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().to_string();
            taken.insert(dir_name.clone());
            if let Ok(content) = fs::read_to_string(path.join("SKILL.md")) {
                if let Some(fm_name) = parse_frontmatter(&content).0 {
                    taken.insert(fm_name);
                }
            }
        }
    }

    // Claude 在前：同名冲突时 Claude 的版本胜出
    let sources = [
        ("claude", home.join(".claude").join("skills")),
        ("codex", home.join(".codex").join("skills")),
    ];

    for (source, dir) in sources {
        for (dir_name, fm_name, src_path) in scan_external_source(&dir) {
            if taken.contains(&dir_name) || taken.contains(&fm_name) {
                report.skipped_existing.push(fm_name);
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
const BUILTIN_SKILL_VERSION: &str = "2";

const BUILTIN_SKILL_MD: &str = r#"---
name: quick-chat-skill-guide
description: Quick Chat Skill 使用指南 —— 斜杠命令与 AI 自主调用、如何自动/手动导入 Claude 与 Codex 的 Skill、创建新 Skill、目录结构与 SKILL.md 格式规范。
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

在 `SKILL.md` 的 frontmatter 中加入：

```markdown
---
name: my-skill
description: …
disable-model-invocation: true
---
```

标注后该 Skill 不会出现在 AI 的可用目录中，只能由用户通过 `/my-skill` 主动调用。
新建 Skill 时勾选「仅手动调用」也会写入此字段。

## 目录结构

```
~/.chat/skills/
└── <skill-name>/
    ├── SKILL.md        # 必需：Skill 说明（含 frontmatter）
    ├── scripts/        # 可选：bash/python 等辅助脚本
    └── templates/      # 可选：模板、参考文件
```

`SKILL.md` 开头的 frontmatter 定义名称与描述：

```markdown
---
name: my-skill
description: 一句话说明这个 Skill 什么时候用、做什么。
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

/// 首次运行时写入内置 Skill；内容升级时就地更新（用户已删除的则不复活）。
/// 通过 `.builtin-installed` 标记文件记录已安装的版本。
#[tauri::command]
pub fn ensure_builtin_skill() -> Result<(), String> {
    let root = skills_root()?;
    fs::create_dir_all(&root).map_err(|e| format!("创建 Skill 目录失败: {e}"))?;
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
// Tests：在临时 HOME 下端到端验证 Skill 的导入/增删/读取逻辑
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

    /// 单个测试函数串行跑完全部断言，避免并发修改 HOME 环境变量
    #[test]
    fn skills_end_to_end() {
        let tmp = std::env::temp_dir().join(format!("quick_chat_skills_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        std::env::set_var("HOME", &tmp);

        // 准备外部来源：claude 有 shared + claude-only；codex 有 shared（应输给 claude）、
        // codex-only、.system 内置（应跳过）。claude-only 带附属脚本与符号链接。
        let claude = tmp.join(".claude/skills");
        let codex = tmp.join(".codex/skills");
        write_skill(&claude, "shared", "shared", "claude 版本");
        write_skill(&claude, "claude-only", "claude-only", "带附件");
        fs::write(claude.join("claude-only/run.sh"), "#!/bin/sh\necho hi\n").unwrap();
        write_skill(&codex, "shared", "shared", "codex 版本");
        write_skill(&codex, "codex-only", "codex-only", "codex 独有");
        write_skill(&codex, ".system/sys", "sys", "内置应跳过");

        // 内置 Skill：首次写入，且写入标记
        ensure_builtin_skill().unwrap();
        assert!(tmp.join(".chat/skills/quick-chat-skill-guide/SKILL.md").is_file());
        let guide = read_skill("quick-chat-skill-guide".into()).unwrap();
        assert!(guide.contains("如何导入 Skill"));

        // 导入：claude 优先、跳过 .system、跳过已存在
        let report = import_external_skills().unwrap();
        assert_eq!(report.imported.len(), 3);
        let names: HashSet<&str> = report.imported.iter().map(|i| i.name.as_str()).collect();
        assert!(names.contains("shared") && names.contains("claude-only") && names.contains("codex-only"));
        let shared = report.imported.iter().find(|i| i.name == "shared").unwrap();
        assert_eq!(shared.source, "claude");
        assert!(!tmp.join(".chat/skills/sys").exists());

        // 附属文件被完整复制
        assert!(tmp.join(".chat/skills/claude-only/run.sh").is_file());
        assert_eq!(
            fs::read_to_string(tmp.join(".chat/skills/shared/.source")).unwrap(),
            "claude"
        );

        // 重复导入：全部跳过（claude 2 个 + codex 2 个），不覆盖
        let report2 = import_external_skills().unwrap();
        assert_eq!(report2.imported.len(), 0);
        assert_eq!(report2.skipped_existing.len(), 4);

        // 列表：frontmatter 解析 + 来源标记
        let list = list_skills().unwrap();
        assert_eq!(list.len(), 4); // guide + 3 导入
        let claude_only = list.iter().find(|s| s.id == "claude-only").unwrap();
        assert_eq!(claude_only.description, "带附件");
        assert!(claude_only.has_assets);
        let guide_meta = list.iter().find(|s| s.id == "quick-chat-skill-guide").unwrap();
        assert_eq!(guide_meta.source, "builtin");
        assert!(!guide_meta.has_assets);

        // 新建：slug 化 + 重名拒绝 + disable-model-invocation 写入与解析
        create_skill("My Skill".into(), "测试".into(), "# 你好".into(), None).unwrap();
        let created = read_skill("my-skill".into()).unwrap();
        assert!(created.contains("name: my-skill") && created.contains("# 你好"));
        assert!(create_skill("my-skill".into(), String::new(), String::new(), None).is_err());

        create_skill("manual-only".into(), "仅手动".into(), String::new(), Some(true)).unwrap();
        let list2 = list_skills().unwrap();
        let manual = list2.iter().find(|s| s.id == "manual-only").unwrap();
        assert!(manual.disable_model_invocation);
        let auto = list2.iter().find(|s| s.id == "my-skill").unwrap();
        assert!(!auto.disable_model_invocation);

        // 删除 + 路径穿越防护
        delete_skill("my-skill".into()).unwrap();
        delete_skill("manual-only".into()).unwrap();
        assert!(!tmp.join(".chat/skills/my-skill").exists());
        assert!(delete_skill("../..".into()).is_err());
        assert!(read_skill("../..".into()).is_err());

        let _ = fs::remove_dir_all(&tmp);
    }
}
