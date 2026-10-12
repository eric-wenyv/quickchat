---
name: quick-chat-skill-guide
description: >
  How to manage skills in the Quick Chat app: create, delete, import from
  Claude/Codex, invoke with slash commands, and control AI auto-invocation.
  Use when the user asks how to add, remove, import, or use skills in this app.
---

# Managing Skills in Quick Chat

## Create a Skill

Click **新建 Skill** in the top-right corner, then fill in:

- **Name**: letters, digits, hyphens, and underscores; it is normalized into a
  slug (e.g. `My Skill` becomes `my-skill`) and must be unique.
- **Description**: a short summary shown in the list and used by the AI to
  decide when to auto-invoke the skill.
- **Content**: the Markdown body.
- **仅手动调用**: when checked, the AI will not invoke this skill on its own;
  it can only be triggered manually with a slash command.

The skill is saved to `~/.chat/skills/<name>/` and takes effect immediately.

## Import from Claude / Codex

- **Manual**: click **导入 Claude/Codex** in the top-right corner (desktop only)
  to rescan immediately. A notification reports how many were imported.
- You can also copy a skill folder into `~/.chat/skills/` directly with a file
  manager; it is picked up without restarting.

## Use a Skill in a Conversation

- **Slash command**: type `/` in the message input to open the skill list, pick
  one, and send. Example: `/my-skill help me draft a resume`. The skill's full
  content is injected with that message and stays active for the whole conversation.
- **AI auto-invocation**: when your request matches a skill's description, the
  AI loads and follows it automatically. Skills marked 仅手动 are excluded.
- **Dedicated conversation**: in the preview pane, click **在对话中使用** to
  start a new conversation with the skill's content as context.

> Quick Chat only injects a skill's text content into the conversation; any
> scripts bundled inside a skill folder are never executed.
