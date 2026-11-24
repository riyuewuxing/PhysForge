import type { AnyParamFieldSpec } from '@physforge/sim-sdk';
import { loadSimulationById, simulationCatalog } from '@physforge/simulations/catalog';
import { routePhysicsProblemPrompt } from './router.js';

export interface ByokConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export type ByokErrorCode = 'TIMEOUT' | 'CORS_OR_NETWORK' | 'HTTP_ERROR' | 'INVALID_JSON' | 'CONFIG' | 'CANCELLED';

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

/** Do not send credentials in plaintext or to a URL with embedded credentials/query/fragment. */
export function validateByokConfig(config: ByokConfig): URL {
  let url: URL;
  try { url = new URL(config.baseUrl.trim()); }
  catch { throw new ByokClientError('CONFIG', '请填写有效的 API Base URL。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash
      || /\/(?:chat\/completions|models)\/?$/i.test(url.pathname)) {
    throw new ByokClientError('CONFIG', '请使用 HTTPS Base URL（仅本机代理允许 HTTP），不得包含凭据、查询参数、片段或完整 API 路径。');
  }
  if (!config.apiKey.trim() || !config.model.trim()) {
    throw new ByokClientError('CONFIG', '请填写 API Key 和模型名称。');
  }
  return url;
}

function byokEndpoint(config: ByokConfig, suffix: string): string {
  return validateByokConfig(config).href.replace(/\/+$/, '') + suffix;
}

export function describeByokError(error: unknown): string {
  if (!(error instanceof ByokClientError)) return '操作失败，请检查配置与网络后重试。';
  if (error.code !== 'HTTP_ERROR') return error.message;
  const hint: Record<number, string> = {
    400: '请求参数或模型不兼容', 401: '密钥无效或已失效', 402: '余额不足',
    403: '没有访问权限', 404: '端点或模型不存在', 422: '请求格式不兼容',
    429: '达到速率或额度限制', 500: '服务商内部错误', 502: '上游服务异常', 503: '服务商暂不可用'
  };
  return `HTTP ${error.status ?? '未知'}：${hint[error.status ?? 0] ?? '服务商拒绝请求，请检查配置'}。`;
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
          } catch {
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
    throw new ByokClientError('INVALID_JSON', '提取到的 JSON 语法不合法');
  }
  throw new ByokClientError('INVALID_JSON', 'JSON 大括号未闭合（模型输出可能被截断）');
}

async function withByokResponse<T>(
  url: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<T> {
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
      // Upstream error bodies can echo credentials or other sensitive data.
      void response.body?.cancel().catch(() => {});
      throw new ByokClientError('HTTP_ERROR', `API 返回 HTTP ${response.status}`, response.status);
    }
    return await consume(response);
  } catch (error) {
    if (timedOut) {
      throw new ByokClientError(
        'TIMEOUT',
        `模型请求超时（超过 ${timeoutMs} ms），请检查网络或切换更快的模型端点`
      );
    }
    if (callerSignal?.aborted) throw new ByokClientError('CANCELLED', '请求已取消。');
    if (error instanceof ByokClientError) throw error;
    throw new ByokClientError(
      'CORS_OR_NETWORK',
      '网络请求失败，可能被浏览器 CORS 跨域策略拦截。请检查网络和服务商的跨域许可；如需代理，仅使用自己信任的 HTTPS 或本机端点。'
    );
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', forwardCallerAbort);
  }
}

/** Legacy response-level helper; JSON callers below keep the deadline through body consumption. */
export function fetchWithTimeoutAndCorsHint(
  url: string,
  init: RequestInit,
  timeoutMs = 25_000,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  return withByokResponse(url, init, async response => response, timeoutMs, fetchImpl);
}

function fetchByokJson(
  url: string,
  init: RequestInit,
  invalidJsonMessage: string,
  timeoutMs = 25_000,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  return withByokResponse(url, init, async response => {
    try {
      return await response.json() as unknown;
    } catch (error) {
      if (error instanceof SyntaxError) throw new ByokClientError('INVALID_JSON', invalidJsonMessage);
      throw error;
    }
  }, timeoutMs, fetchImpl);
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

/** List models without generating billable text. No claim about generation availability. */
export async function listByokModels(
  config: ByokConfig,
  timeoutMs = 10_000,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<string[]> {
  const data = await fetchByokJson(byokEndpoint(config, '/models'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    redirect: 'error',
    ...(signal ? { signal } : {})
  }, '模型目录响应不是合法 JSON', timeoutMs, fetchImpl);
  if (!isRecord(data) || !Array.isArray(data['data'])) {
    throw new ByokClientError('INVALID_JSON', '响应缺少 OpenAI 兼容模型目录 data 数组');
  }
  return [...new Set(data['data'].flatMap((item: unknown) =>
    isRecord(item) && typeof item['id'] === 'string' && item['id'].trim()
      && !item['id'].includes(config.apiKey.trim()) ? [item['id']] : []
  ))].sort();
}

/** Preserve the existing connectivity probe contract. */
export async function probeByokConnection(
  config: ByokConfig,
  timeoutMs = 10_000,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  await listByokModels(config, timeoutMs, fetchImpl);
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
  feedback?: string,
  signal?: AbortSignal
): Promise<unknown> {
  const endpoint = byokEndpoint(config, '/chat/completions');
  const deepseek = validateByokConfig(config).origin === 'https://api.deepseek.com';
  if (signal?.aborted) throw new ByokClientError('CANCELLED', '请求已取消。');
  const content = feedback
    ? `${userPrompt}\n\n[上轮无头物理引擎检验未通过，请针对下列报错修正参数后重试]:\n${feedback}`
    : userPrompt;

  // Keep the catalog lightweight: lazy-load only the locally suggested model.
  // Refine rounds already carry the actual selected model's schema on validation errors.
  const route = routePhysicsProblemPrompt(userPrompt);
  const suggested = feedback ? undefined : await loadSimulationById(route.modelId);
  const schemaHint = suggested ? formatModelSchemaHint(suggested.meta.id, suggested.paramSchema) : undefined;

  const data = await fetchByokJson(endpoint, {
    method: 'POST',
    redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    ...(signal ? { signal } : {}),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey.trim()}`
    },
    body: JSON.stringify({
      model: config.model.trim(),
      ...(deepseek ? {
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        max_tokens: 2048
      } : {}),
      temperature: 0.1,
      stream: false,
      messages: [
        { role: 'system', content: buildByokSystemPrompt(schemaHint) },
        { role: 'user', content }
      ]
    })
  }, 'BYOK API 返回的响应体不是合法 JSON', deepseek ? 60_000 : 25_000);

  const choices = isRecord(data) && Array.isArray(data['choices']) ? data['choices'] : [];
  const firstChoice: unknown = choices[0];
  const message = isRecord(firstChoice) ? firstChoice['message'] : undefined;
  const rawContent = isRecord(message) ? message['content'] : undefined;
  if (isRecord(firstChoice) && firstChoice['finish_reason'] === 'length') {
    throw new ByokClientError('INVALID_JSON', '模型输出达到长度限制，未生成完整场景。');
  }
  if (typeof rawContent === 'string' && rawContent.includes(config.apiKey.trim())) {
    throw new ByokClientError('INVALID_JSON', '模型响应包含敏感内容，已拒绝显示。');
  }
  return extractJsonFromLlmOutput(typeof rawContent === 'string' ? rawContent : '');
}
