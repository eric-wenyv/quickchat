import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { openPath } from '@tauri-apps/plugin-opener';
import MessageContent from '../chat/MessageContent';
import SkillForm from './SkillForm';
import SkillFrontmatterTable from './SkillFrontmatterTable';
import { useSkills } from '@/hooks/useSkills';
import { parseSkillFrontmatter } from '@/utils/skill-frontmatter';
import { isMobilePlatform } from '@/utils/platform';
import {
  createSkill,
  deleteSkill,
  importExternalSkills,
  readSkill,
  refreshSkills,
  type SkillMeta,
} from '@/services/skills';

interface SkillManagerProps {
  /** 返回聊天界面 */
  onClose: () => void;
  /** 在对话中使用某个 Skill（注入其完整内容作为上下文） */
  onUseSkill: (skill: SkillMeta, content: string) => void;
  /** 全局 Toast 通知 */
  onNotify: (title: string, desc?: string, type?: 'error' | 'success') => void;
}

const SOURCE_LABEL: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  builtin: '内置',
  local: '本地',
};

const SourceBadge: React.FC<{ source: string }> = ({ source }) => (
  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-linear-surface-hover text-linear-text-tertiary">
    {SOURCE_LABEL[source] ?? source}
  </span>
);

/** 悬浮 description 提示：portal 到 body，避免被列表滚动容器裁剪 */
const DescriptionTooltip: React.FC<{ text: string; anchor: DOMRect | null }> = ({ text, anchor }) => {
  if (!anchor) return null;
  const top = Math.min(anchor.top, window.innerHeight - 140);
  return createPortal(
    <div
      className="pointer-events-none fixed z-[200] w-72 rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#2D2D2D]/95 px-3 py-2 text-xs leading-relaxed text-linear-text-secondary shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl animate-in fade-in"
      style={{ left: anchor.right + 10, top }}
    >
      {text}
    </div>,
    document.body
  );
};

/** 移动端（Android/iOS）：点击 Skill 跳转全屏详情，列表与详情不并排 */
const IS_MOBILE = isMobilePlatform;

/**
 * Skill 管理界面（占据右侧主区域，替代 MainChatArea）
 *
 * - 桌面端：左侧 Skill 列表（名称 + 来源徽标 + 删除），右侧完整 Markdown 预览
 * - 移动端：仅显示列表，点击进入全屏详情，顶栏返回列表；不显示「导入 Claude/Codex」
 * - 预览复用消息渲染管线；顶栏：导入 Claude/Codex（仅桌面）、新建 Skill、返回
 */
const SkillManager: React.FC<SkillManagerProps> = ({ onClose, onUseSkill, onNotify }) => {
  const skills = useSkills();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; anchor: DOMRect } | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);

  const selectedSkill = skills.find(s => s.id === selectedId) ?? null;

  // 头部 frontmatter 字段拆出来单独以表格展示，正文走消息渲染管线
  const frontmatter = useMemo(() => parseSkillFrontmatter(content), [content]);

  const refresh = useCallback(async (keepSelection = true) => {
    try {
      const list = await refreshSkills();
      setSelectedId(prev => {
        if (keepSelection && prev && list.some(s => s.id === prev)) return prev;
        // 移动端不自动选中，保持列表视图，由用户点击进入详情
        return IS_MOBILE ? null : list[0]?.id ?? null;
      });
    } catch (e) {
      onNotify('加载 Skill 失败', String(e));
    } finally {
      setIsLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  // 加载选中 Skill 的完整 Markdown
  useEffect(() => {
    if (!selectedId) {
      setContent('');
      return;
    }
    let cancelled = false;
    setIsLoadingContent(true);
    readSkill(selectedId)
      .then(md => { if (!cancelled) setContent(md); })
      .catch(e => { if (!cancelled) onNotify('读取 Skill 失败', String(e)); })
      .finally(() => { if (!cancelled) setIsLoadingContent(false); });
    return () => { cancelled = true; };
  }, [selectedId, onNotify]);

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const report = await importExternalSkills();
      await refresh();
      if (report.imported.length > 0) {
        const names = report.imported.map(i => i.name).join('、');
        onNotify('导入完成', `新增 ${report.imported.length} 个 Skill：${names}`, 'success');
      } else {
        onNotify('没有新 Skill', 'Claude / Codex 中的 Skill 均已导入', 'success');
      }
    } catch (e) {
      onNotify('导入失败', String(e));
    } finally {
      setIsImporting(false);
    }
  };

  const handleCreate = async (name: string, description: string, body: string, disableModelInvocation: boolean) => {
    try {
      const slug = await createSkill(name, description, body, disableModelInvocation);
      setShowForm(false);
      await refresh(false);
      setSelectedId(slug);
      onNotify('已创建', `Skill "${name}" 已保存到 ~/.chat/skills/`, 'success');
    } catch (e) {
      onNotify('创建失败', String(e));
    }
  };

  const handleDelete = async (skill: SkillMeta) => {
    try {
      await deleteSkill(skill.id);
      setConfirmDeleteId(null);
      await refresh(false);
      onNotify('已删除', `Skill "${skill.name}" 已移除`, 'success');
    } catch (e) {
      onNotify('删除失败', String(e));
    }
  };

  const handleOpenFolder = async (skill: SkillMeta) => {
    try {
      await openPath(skill.path);
    } catch (e) {
      onNotify('打开文件夹失败', String(e));
    }
  };

  const handleItemEnter = (e: React.MouseEvent, skill: SkillMeta) => {
    if (!skill.description) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (tooltipTimerRef.current) window.clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = window.setTimeout(() => {
      setTooltip({ text: skill.description, anchor: rect });
    }, 350);
  };

  const handleItemLeave = () => {
    if (tooltipTimerRef.current) window.clearTimeout(tooltipTimerRef.current);
    setTooltip(null);
  };

  const headerButtonClass =
    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-linear-text-secondary transition-colors hover:bg-linear-surface hover:text-linear-text-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  // Markdown 正文（桌面详情与移动端详情共用）
  const previewBody = isLoadingContent ? (
    <div className="flex h-full items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-linear-border border-t-linear-text-secondary" />
    </div>
  ) : (
    <div className="mx-auto max-w-3xl">
      {frontmatter && frontmatter.fields.length > 0 && (
        <SkillFrontmatterTable fields={frontmatter.fields} />
      )}
      <MessageContent content={frontmatter ? frontmatter.body : content} status="completed" />
    </div>
  );

  // 移动端详情：全屏展示选中 Skill，顶栏返回列表
  if (IS_MOBILE && selectedSkill) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex h-12 flex-shrink-0 items-center justify-between gap-2 border-b border-linear-border px-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              onClick={() => setSelectedId(null)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-linear-text-tertiary transition-colors hover:bg-linear-surface hover:text-linear-text-primary cursor-pointer"
              title="返回列表"
              aria-label="返回列表"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h2 className="truncate text-[15px] font-semibold text-linear-text-primary">{selectedSkill.name}</h2>
            <SourceBadge source={selectedSkill.source} />
            {selectedSkill.disable_model_invocation && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-400">
                仅手动
              </span>
            )}
          </div>
          <button
            onClick={() => onUseSkill(selectedSkill, content)}
            disabled={isLoadingContent || !content}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-linear-text-primary text-linear-bg transition-opacity disabled:opacity-40 cursor-pointer"
            title="在对话中使用"
            aria-label="在对话中使用"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">{previewBody}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶栏 */}
      <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-linear-border px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-linear-text-tertiary transition-colors hover:bg-linear-surface hover:text-linear-text-primary cursor-pointer"
            title="返回对话"
            aria-label="返回对话"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-[15px] font-semibold text-linear-text-primary">Skills</h1>
          {!isLoading && (
            <span className="text-xs text-linear-text-tertiary">{skills.length} 个</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!IS_MOBILE && (
            <button onClick={handleImport} disabled={isImporting} className={headerButtonClass} title="扫描 ~/.claude/skills 与 ~/.codex/skills，导入新增的 Skill">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isImporting ? 'animate-spin' : ''}>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              {isImporting ? '导入中...' : '导入 Claude/Codex'}
            </button>
          )}
          <button onClick={() => setShowForm(true)} className={headerButtonClass}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            新建 Skill
          </button>
        </div>
      </header>

      {/* 主体：列表（桌面端并排预览 / 移动端独占全屏） */}
      <div className="flex min-h-0 flex-1">
        {/* Skill 列表 */}
        <div className={`flex flex-col overflow-y-auto p-2 ${IS_MOBILE ? 'w-full flex-1' : 'w-60 flex-shrink-0 border-r border-linear-border'}`}>
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-linear-border border-t-linear-text-secondary" />
            </div>
          ) : skills.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
              <p className="text-[13px] font-medium text-linear-text-tertiary">还没有 Skill</p>
              <p className="text-xs leading-relaxed text-linear-text-muted">
                {IS_MOBILE
                  ? '点击右上角「新建 Skill」手动创建'
                  : '点击右上角「导入 Claude/Codex」自动导入，或「新建 Skill」手动创建'}
              </p>
            </div>
          ) : (
            skills.map(skill => {
              const isActive = skill.id === selectedId;
              const isConfirming = confirmDeleteId === skill.id;
              return (
                <div
                  key={skill.id}
                  className={`group relative mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors duration-150 ${
                    isActive ? 'bg-linear-surface' : 'hover:bg-linear-surface/70 active:bg-linear-surface'
                  }`}
                  onMouseEnter={(e) => handleItemEnter(e, skill)}
                  onMouseLeave={handleItemLeave}
                >
                  <button
                    onClick={() => setSelectedId(skill.id)}
                    className="flex min-w-0 flex-1 flex-col gap-0.5 text-left cursor-pointer outline-none"
                  >
                    <span className={`truncate text-[13px] font-semibold ${isActive ? 'text-linear-text-primary' : 'text-linear-text-secondary'}`}>
                      {skill.name}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <SourceBadge source={skill.source} />
                      {skill.disable_model_invocation && (
                        <span className="text-[10px] text-linear-text-muted" title="已标注 disable-model-invocation，仅能通过 / 命令手动调用，AI 不会自主调用">仅手动</span>
                      )}
                      {skill.has_assets && (
                        <span className="text-[10px] text-linear-text-muted" title="包含脚本/模板等附属文件">含附件</span>
                      )}
                    </span>
                  </button>
                  {isConfirming ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => handleDelete(skill)}
                        className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-red-400 hover:bg-red-500/10 cursor-pointer"
                      >
                        确认
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-linear-text-tertiary hover:bg-linear-surface-hover cursor-pointer"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(skill.id)}
                      className={`h-6 w-6 shrink-0 items-center justify-center rounded text-linear-text-tertiary transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer ${IS_MOBILE ? 'flex' : 'hidden group-hover:flex'}`}
                      title="删除 Skill"
                      aria-label={`删除 ${skill.name}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 预览区（仅桌面端；移动端走上方全屏详情分支） */}
        {!IS_MOBILE && (
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedSkill ? (
            <>
              <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-linear-border/70 px-5 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold text-linear-text-primary">{selectedSkill.name}</h2>
                  <SourceBadge source={selectedSkill.source} />
                  {selectedSkill.disable_model_invocation && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-400"
                      title="已标注 disable-model-invocation，AI 不会自主调用，仅能通过 / 命令手动调用"
                    >
                      仅手动
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => handleOpenFolder(selectedSkill)}
                    className={headerButtonClass}
                    title={selectedSkill.path}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                    </svg>
                    打开文件夹
                  </button>
                  <button
                    onClick={() => onUseSkill(selectedSkill, content)}
                    disabled={isLoadingContent || !content}
                    className="flex items-center gap-1.5 rounded-md bg-linear-text-primary px-2.5 py-1.5 text-[13px] font-semibold text-linear-bg transition-opacity disabled:opacity-40 cursor-pointer"
                    title="新建一个对话，将此 Skill 的完整内容作为上下文注入"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
                    </svg>
                    在对话中使用
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{previewBody}</div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-[13px] text-linear-text-muted">选择左侧的 Skill 查看完整内容</p>
            </div>
          )}
        </div>
        )}
      </div>

      {showForm && <SkillForm onSave={handleCreate} onClose={() => setShowForm(false)} />}
      {tooltip && <DescriptionTooltip text={tooltip.text} anchor={tooltip.anchor} />}
    </div>
  );
};

export default SkillManager;
