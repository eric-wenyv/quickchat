import React from 'react';

export const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="mb-2 px-1 text-xs font-bold text-linear-text-tertiary">{children}</h2>
);

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`divide-y divide-linear-border/70 rounded-xl border border-linear-border bg-linear-surface ${className}`}>
    {children}
  </div>
);

interface RowProps {
  title: string;
  desc?: string;
  children: React.ReactNode;
}

/** 行式控件：左侧标题，右侧控制元件 */
export const Row: React.FC<RowProps> = ({ title, children }) => (
  <div className="flex items-center justify-between gap-6 px-4 py-3.5">
    <div className="min-w-0 flex-1">
      <h3 className="text-sm font-semibold text-linear-text-primary">{title}</h3>
    </div>
    <div className="flex flex-shrink-0 items-center">{children}</div>
  </div>
);
