import React, { useState, useEffect } from 'react';
import type { ModelConfig, AIProvider } from '@/types/types';

interface ModelFormProps {
  initial?: ModelConfig | null;
  onSave: (config: ModelConfig) => void;
  onCancel: () => void;
}

const PROVIDER_LABELS: Record<AIProvider, string> = {
  google_gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  openai_compatible: 'OpenAI 兼容 API',
};

const PROVIDER_HINTS: Record<AIProvider, string> = {
  google_gemini: '使用 Gemini 的 OpenAI 兼容端点',
  openrouter: '支持任意模型，如 anthropic/claude-sonnet-4',
  openai_compatible: '自定义 OpenAI 兼容服务（如 Ollama、vLLM）',
};

const DEFAULT_ENDPOINTS: Record<AIProvider, string> = {
  google_gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  openrouter: 'https://openrouter.ai/api/v1/',
  openai_compatible: '',
};

export const ModelForm: React.FC<ModelFormProps> = ({ initial, onSave, onCancel }) => {
  const [provider, setProvider] = useState<AIProvider>(initial?.provider || 'openrouter');
  const [modelId, setModelId] = useState(initial?.model_id || '');
  const [displayName, setDisplayName] = useState(initial?.display_name || '');
  const [apiKey, setApiKey] = useState(initial?.api_key || '');
  const [apiEndpoint, setApiEndpoint] = useState(initial?.api_endpoint || '');
  const [temperature, setTemperature] = useState(initial?.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(initial?.max_tokens ?? 4096);
  const [topP, setTopP] = useState(initial?.top_p ?? 0.95);
  const [isDefault, setIsDefault] = useState(initial?.is_default || false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!initial && provider) {
      setApiEndpoint(DEFAULT_ENDPOINTS[provider]);
    }
  }, [provider, initial]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!modelId.trim()) errs.modelId = '模型 ID 不能为空';
    if (!displayName.trim()) errs.displayName = '显示名称不能为空';
    if (!apiKey.trim()) errs.apiKey = 'API Key 不能为空';
    if (provider === 'openai_compatible' && !apiEndpoint.trim()) {
      errs.apiEndpoint = '自定义 API 必须填写 Endpoint';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const now = Date.now();
    const config: ModelConfig = {
      id: initial?.id || crypto.randomUUID(),
      provider,
      model_id: modelId.trim(),
      display_name: displayName.trim(),
      api_key: apiKey.trim(),
      api_endpoint: apiEndpoint.trim() || null,
      temperature: Math.max(0, Math.min(2, temperature)),
      max_tokens: Math.max(1, maxTokens),
      top_p: Math.max(0, Math.min(1, topP)),
      thinking_level: modelId.includes('gemini-3') ? 'MEDIUM' : null,
      is_default: isDefault,
      created_at: initial?.created_at ?? now,
      updated_at: now,
    };
    onSave(config);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Provider */}
      <div>
        <label className="block text-xs font-bold text-ink-300 mb-1.5">Provider</label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(PROVIDER_LABELS) as AIProvider[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`px-2 py-2 rounded-xl text-xs font-semibold transition-all border ${
                provider === p
                  ? 'bg-ink-400 dark:bg-accent-600 text-white border-ink-400 dark:border-accent-600 shadow-sm'
                  : 'bg-sand-200 text-ink-200 border-sand-400/40 hover:border-sand-400/80'
              }`}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-100">{PROVIDER_HINTS[provider]}</p>
      </div>

      {/* Model ID */}
      <div>
        <label className="block text-xs font-bold text-ink-300 mb-1.5">模型 ID</label>
        <input
          value={modelId}
          onChange={e => setModelId(e.target.value)}
          placeholder={provider === 'openrouter' ? 'anthropic/claude-sonnet-4' : 'gemini-3-flash-preview'}
          className="w-full bg-sand-200/50 dark:bg-sand-300/50 text-ink-300 text-sm placeholder:text-ink-100 px-3 py-2.5 rounded-xl border border-sand-400/40 focus:border-sand-500 focus:shadow-input-hover outline-none transition-all"
        />
        {errors.modelId && <p className="mt-1 text-[11px] text-red-500">{errors.modelId}</p>}
      </div>

      {/* Display Name */}
      <div>
        <label className="block text-xs font-bold text-ink-300 mb-1.5">显示名称</label>
        <input
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="给模型起个名字"
          className="w-full bg-sand-200/50 dark:bg-sand-300/50 text-ink-300 text-sm placeholder:text-ink-100 px-3 py-2.5 rounded-xl border border-sand-400/40 focus:border-sand-500 focus:shadow-input-hover outline-none transition-all"
        />
        {errors.displayName && <p className="mt-1 text-[11px] text-red-500">{errors.displayName}</p>}
      </div>

      {/* API Key */}
      <div>
        <label className="block text-xs font-bold text-ink-300 mb-1.5">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="w-full bg-sand-200/50 dark:bg-sand-300/50 text-ink-300 text-sm placeholder:text-ink-100 px-3 py-2.5 rounded-xl border border-sand-400/40 focus:border-sand-500 focus:shadow-input-hover outline-none transition-all"
        />
        {errors.apiKey && <p className="mt-1 text-[11px] text-red-500">{errors.apiKey}</p>}
      </div>

      {/* API Endpoint */}
      <div>
        <label className="block text-xs font-bold text-ink-300 mb-1.5">
          API Endpoint {provider !== 'openai_compatible' && <span className="font-normal text-ink-100">（可选，留空使用默认）</span>}
        </label>
        <input
          value={apiEndpoint}
          onChange={e => setApiEndpoint(e.target.value)}
          placeholder={DEFAULT_ENDPOINTS[provider] || 'https://your-api.com/v1/'}
          className="w-full bg-sand-200/50 dark:bg-sand-300/50 text-ink-300 text-sm placeholder:text-ink-100 px-3 py-2.5 rounded-xl border border-sand-400/40 focus:border-sand-500 focus:shadow-input-hover outline-none transition-all"
        />
        {errors.apiEndpoint && <p className="mt-1 text-[11px] text-red-500">{errors.apiEndpoint}</p>}
      </div>

      {/* Parameters */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-bold text-ink-300 mb-1.5">Temperature</label>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={e => setTemperature(parseFloat(e.target.value) || 0)}
            className="w-full bg-sand-200/50 text-ink-300 text-sm px-3 py-2.5 rounded-xl border border-sand-400/40 focus:border-sand-500 outline-none transition-all"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-ink-300 mb-1.5">Max Tokens</label>
          <input
            type="number"
            min={1}
            step={1}
            value={maxTokens}
            onChange={e => setMaxTokens(parseInt(e.target.value) || 1)}
            className="w-full bg-sand-200/50 text-ink-300 text-sm px-3 py-2.5 rounded-xl border border-sand-400/40 focus:border-sand-500 outline-none transition-all"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-ink-300 mb-1.5">Top-P</label>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={topP}
            onChange={e => setTopP(parseFloat(e.target.value) || 0)}
            className="w-full bg-sand-200/50 text-ink-300 text-sm px-3 py-2.5 rounded-xl border border-sand-400/40 focus:border-sand-500 outline-none transition-all"
          />
        </div>
      </div>

      {/* Default */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={e => setIsDefault(e.target.checked)}
          className="w-4 h-4 rounded border-sand-400 text-ink-400 dark:text-accent-500 focus:ring-ink-400 dark:focus:ring-accent-500"
        />
        <span className="text-xs font-semibold text-ink-300">设为默认模型</span>
      </label>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-ink-200 hover:text-ink-400 hover:bg-sand-200 rounded-xl transition-colors cursor-pointer"
        >
          取消
        </button>
        <button
          type="submit"
          className="px-5 py-2 text-sm font-semibold text-white bg-ink-400 hover:bg-ink-300 dark:bg-accent-600 dark:hover:bg-accent-500 rounded-xl transition-colors shadow-sm cursor-pointer"
        >
          {initial ? '保存修改' : '添加模型'}
        </button>
      </div>
    </form>
  );
};

export default ModelForm;
