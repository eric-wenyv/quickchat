import type { EpochMillis } from '@/types/types';
import RelativeTime from '@/components/shared/RelativeTime';

interface MessageMetaProps {
  createdAt: EpochMillis;
  tokenCount: number | null;
  modelId: string | null;
}

export default function MessageMeta({ createdAt, tokenCount, modelId }: MessageMetaProps) {
  return (
    <div className="flex items-center gap-3 mt-1.5 text-[11px] font-medium text-ink-200/80 tracking-tight select-none">
      <RelativeTime timestamp={createdAt} />
      
      {modelId && (
        <div className="flex items-center gap-2">
          <span className="text-ink-100/50">•</span>
          <span className="uppercase tracking-widest opacity-90">{modelId}</span>
        </div>
      )}

      {tokenCount !== null && (
        <div className="flex items-center gap-2">
          <span className="text-ink-100/50">•</span>
          <span>{tokenCount} tokens</span>
        </div>
      )}
    </div>
  );
}
