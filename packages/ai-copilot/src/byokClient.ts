import type { AnyParamFieldSpec } from '@physforge/sim-sdk';
import { loadSimulationById, simulationCatalog } from '@physforge/simulations/catalog';
import { routePhysicsProblemPrompt } from './router.js';

export interface ByokConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export type ByokErrorCode = 'TIMEOUT' | 'CORS_OR_NETWORK' | 'HTTP_ERROR' | 'INVALID_JSON';

export class ByokClientError extends Error {
  constructor(
    public readonly code: ByokErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ByokClientError';
  }
}

export function extractJsonFromLlmOutput(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ByokClientError('INVALID_JSON', '模型返回内容为空，无法解析 SceneDSL JSON');
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // The model may wrap the object in a Markdown fence or explanatory prose.
  }

  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch = fencePattern.exec(trimmed);
  while (fenceMatch !== null) {
    const candidate = fenceMatch[1]?.trim();
    if (candidate) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        // Continue through later fences and then scan balanced object braces.
      }
    }
    fenceMatch = fencePattern.exec(trimmed);
  }

  let sawObjectStart = false;
  let sawBalancedObject = false;
  let lastParseError = '';
  for (let start = 0; start < trimmed.length; start++) {
    if (trimmed[start] !== '{') continue;
    sawObjectStart = true;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < trimmed.length; index++) {
      const char = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          sawBalancedObject = true;
          try {
            return JSON.parse(trimmed.slice(start, index + 1)) as unknown;
          } catch (error) {
            lastParseError = error instanceof Error ? error.message : String(error);
            break;
          }
        }
      }
    }
  }

  if (!sawObjectStart) {
    throw new ByokClientError('INVALID_JSON', '未在模型回复中找到 JSON 起始符 “{”');
  }
  if (sawBalancedObject) {
    throw new ByokClientError('INVALID_JSON', `提取到的 JSON 语法不合法：${lastParseError}`);
  }
  throw new ByokClientError('INVALID_JSON', 'JSON 大括号未闭合（模型输出可能被截断）');
}

export async function fetchWithTimeoutAndCorsHint(
  url: string,
  init: RequestInit,
  timeoutMs = 25_000,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(0, timeoutMs));
  const callerSignal = init.signal;
  const forwardCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) forwardCallerAbort();
  else callerSignal?.addEventListener('abort', forwardCallerAbort, { once: true });

  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new ByokClientError(
        'HTTP_ERROR',
        `API 返回 HTTP ${response.status}：${responseText.slice(0, 200) || response.statusText}`,
        response.status
      );
    }
    return response;
  } catch (error) {
    if (error instanceof ByokClientError) throw error;
    if (timedOut) {
      throw new ByokClientError(
        'TIMEOUT',
        `模型请求超时（超过 ${timeoutMs} ms），请检查网络或切换更快的模型端点`
      );
    }
    throw new ByokClientError(
      'CORS_OR_NETWORK',
      '网络请求失败，可能被浏览器 CORS 跨域策略拦截。请改用允许浏览器直连的 API 中转地址，或配置本地代理后重试。'
    );
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', forwardCallerAbort);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compact deterministic signature; callers load only the relevant plugin. */
export function formatModelSchemaHint(modelId: string, schema: readonly AnyParamFieldSpec[]): string {
  const fields = schema.map((field) => {
    if (field.kind === 'number') {
      return `${field.key}: number[${field.min}..${field.max}]${field.unit ? ` ${field.unit}` : ''}`;
    }
    if (field.kind === 'select') {
      return `${field.key}: select(${field.options.map((option) => option.value).join('|')})`;
    }
    return `${field.key}: boolean`;
  });
  return `Schema ${modelId}: ${fields.join('; ')}`;
}

/** Test the provider's models endpoint, not the selected model's generation ability. */
export async function probeByokConnection(
  config: ByokConfig,
  timeoutMs = 10_000,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const endpoint = `${config.baseUrl.trim().replace(/\/+$/, '')}/models`;
  const response = await fetchWithTimeoutAndCorsHint(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    cache: 'no-store',
    redirect: 'error'
  }, timeoutMs, fetchImpl);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ByokClientError('INVALID_JSON', '模型目录响应不是合法 JSON');
  }
  if (!isRecord(data) || !Array.isArray(data['data'])) {
    throw new ByokClientError('INVALID_JSON', '响应缺少 OpenAI 兼容模型目录 data 数组');
  }
}

export function buildByokSystemPrompt(schemaHint?: string): string {
  const ids = simulationCatalog.map((c) => `${c.meta.id} (${c.meta.title})`).join('\n');
  return [
    '你是 PhysForge 物理逆向建模助手。请把用户的物理题描述转为一个合法的 JSON SceneDSL (schemaVersion: "2.0")。',
    '可用模型 ID 列表：',
    ids,
    '优先匹配合法 modelId。params 只能使用该模型 Schema 声明的键、类型、枚举值和数值范围；不确定的参数应省略，由引擎采用默认值。禁止猜造参数键。',
    ...(schemaHint ? ['本地题干路由的候选模型 Schema（仅供匹配参考，不强制选择此模型）：', schemaHint] : []),
    '若更换模型，应使用该模型自己的 Schema；修正轮次以审计反馈中对应 modelId 的签名为准。',
    '仅输出纯 JSON 对象：{ "schemaVersion": "2.0", "modelId": "...", "title": "...", "params": { ... } }。'
  ].join('\n');
}

export async function requestByokSceneCandidate(
  config: ByokConfig,
  userPrompt: string,
  feedback?: string
): Promise<unknown> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const content = feedback
    ? `${userPrompt}\n\n[上轮无头物理引擎检验未通过，请针对下列报错修正参数后重试]:\n${feedback}`
    : userPrompt;

  // Keep the catalog lightweight: lazy-load only the locally suggested model.
  // Refine rounds already carry the actual selected model's schema on validation errors.
  const route = routePhysicsProblemPrompt(userPrompt);
  const suggested = feedback ? undefined : await loadSimulationById(route.modelId);
  const schemaHint = suggested ? formatModelSchemaHint(suggested.meta.id, suggested.paramSchema) : undefined;

  const res = await fetchWithTimeoutAndCorsHint(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: buildByokSystemPrompt(schemaHint) },
        { role: 'user', content }
      ]
    })
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ByokClientError('INVALID_JSON', 'BYOK API 返回的响应体不是合法 JSON');
  }

  const choices = isRecord(data) && Array.isArray(data['choices']) ? data['choices'] : [];
  const firstChoice: unknown = choices[0];
  const message = isRecord(firstChoice) ? firstChoice['message'] : undefined;
  const rawContent = isRecord(message) ? message['content'] : undefined;
  return extractJsonFromLlmOutput(typeof rawContent === 'string' ? rawContent : '');
}
