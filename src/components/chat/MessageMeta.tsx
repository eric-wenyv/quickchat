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

/**
 * MessageMeta (Linear-style)
 * 时间戳和 Token 信息用极暗灰色小字号展示。
 */
export default function MessageMeta({ createdAt, tokenCount, inputTokens, outputTokens, modelId, role }: MessageMetaProps) {
  const hasTokenInfo = tokenCount !== null || (inputTokens !== null && outputTokens !== null);

  return (
    <div className="flex items-center gap-2 text-[11px] font-normal text-linear-text-tertiary tracking-tight select-none">
      <span>·</span>
      <RelativeTime timestamp={createdAt} />

      {modelId && role === 'assistant' && (
        <>
          <span>·</span>
          <span className="uppercase tracking-wider">{modelId}</span>
        </>
      )}

      {hasTokenInfo && role === 'assistant' && (
        <>
          <span>·</span>
          <div className="flex items-center gap-1.5">
            {inputTokens !== null && (
              <span title="Input tokens">
                ↑{inputTokens}
              </span>
            )}
            {outputTokens !== null && (
              <span title="Output tokens">
                ↓{outputTokens}
              </span>
            )}
            {tokenCount !== null && (
              <span>
                = {tokenCount}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
