import React from 'react';
import type { SkillFrontmatterField } from '@/utils/skill-frontmatter';

/**
 * SKILL.md frontmatter 展示组件：name / description 等头部标注字段
 * 以表格形式单独展示（视觉与消息渲染管线里的 Markdown 表格一致）。
 */
const SkillFrontmatterTable: React.FC<{ fields: SkillFrontmatterField[] }> = ({ fields }) => (
  <div className="my-4 max-w-full overflow-x-auto rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#202020]">
    <table className="w-full text-sm text-left border-collapse">
      <thead className="bg-[#343434] font-semibold">
        <tr className="border-b border-[rgba(255,255,255,0.09)]">
          <th className="w-48 px-4 py-2.5 text-linear-text-primary">字段</th>
          <th className="px-4 py-2.5 text-linear-text-primary">内容</th>
        </tr>
      </thead>
      <tbody>
        {fields.map(({ key, value }) => (
          <tr
            key={key}
            className="border-b border-[rgba(255,255,255,0.09)] last:border-b-0 hover:bg-[rgba(255,255,255,0.05)] transition-colors"
          >
            <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-[13px] text-linear-text-secondary">
              {key}
            </td>
            <td className="break-words whitespace-pre-wrap px-4 py-2.5 align-top text-linear-text-body">
              {value || <span className="text-linear-text-muted">（空）</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default SkillFrontmatterTable;
