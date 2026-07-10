import React, { useEffect } from 'react';

interface ArtifactFullscreenShellProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

const ArtifactFullscreenShell: React.FC<ArtifactFullscreenShellProps> = ({
  title,
  children,
  onClose,
  actions,
  className = '',
  contentClassName = '',
}) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/55 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`group relative flex h-[92vh] w-[94vw] max-w-7xl flex-col overflow-hidden bg-linear-bg shadow-2xl ${className}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-linear-border bg-[#202020] px-4">
          <span className="truncate text-xs font-medium uppercase tracking-wider text-linear-text-tertiary">
            {title}
          </span>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
        <div className={`min-h-0 flex-1 bg-linear-bg ${contentClassName}`}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default ArtifactFullscreenShell;
