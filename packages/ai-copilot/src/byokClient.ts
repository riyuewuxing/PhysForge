import { simulationCatalog } from '@physforge/simulations/catalog';

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

export function buildByokSystemPrompt(): string {
  const ids = simulationCatalog.map((c) => `${c.meta.id} (${c.meta.title})`).join('\n');
  return [
    '你是 PhysForge 物理逆向建模助手。请把用户的物理题描述转为一个合法的 JSON SceneDSL (schemaVersion: "2.0")。',
    '可用模型 ID 列表：',
    ids,
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
        { role: 'system', content: buildByokSystemPrompt() },
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
