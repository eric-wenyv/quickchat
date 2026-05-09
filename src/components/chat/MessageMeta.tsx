import type { EpochMillis } from '@/types/types';
import RelativeTime from '@/components/shared/RelativeTime';

interface MessageMetaProps {
  createdAt: EpochMillis;
  tokenCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  modelId: string | null;
  role: string;
}

export default function MessageMeta({ createdAt, tokenCount, inputTokens, outputTokens, modelId, role }: MessageMetaProps) {
  const hasTokenInfo = tokenCount !== null || (inputTokens !== null && outputTokens !== null);

  return (
    <div className="flex items-center gap-3 mt-1.5 text-[11px] font-medium text-ink-200/80 tracking-tight select-none">
      <RelativeTime timestamp={createdAt} />

      {modelId && role === 'assistant' && (
        <div className="flex items-center gap-2">
          <span className="text-ink-100/50">•</span>
          <span className="uppercase tracking-widest opacity-90">{modelId}</span>
        </div>
      )}

      {hasTokenInfo && role === 'assistant' && (
        <div className="flex items-center gap-2">
          <span className="text-ink-100/50">•</span>
          <div className="flex items-center gap-1.5">
            {inputTokens !== null && (
              <span className="text-ink-200/70" title="Input tokens">
                ↑{inputTokens}
              </span>
            )}
            {outputTokens !== null && (
              <span className="text-ink-200/70" title="Output tokens">
                ↓{outputTokens}
              </span>
            )}
            {tokenCount !== null && (
              <span className="text-ink-200/90">
                = {tokenCount}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
