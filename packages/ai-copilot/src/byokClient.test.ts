import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ByokClientError,
  extractJsonFromLlmOutput,
  fetchWithTimeoutAndCorsHint,
  formatModelSchemaHint,
  listByokModels,
  validateByokConfig,
  describeByokError,
  probeByokConnection,
  requestByokSceneCandidate
} from './byokClient.js';

describe('BYOK client resilience', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses a plain JSON object', () => {
    expect(extractJsonFromLlmOutput('{"schemaVersion":"2.0","modelId":"mech-vertical-circular"}')).toEqual({
      schemaVersion: '2.0',
      modelId: 'mech-vertical-circular'
    });
  });

  it('extracts a JSON code fence surrounded by explanatory text', () => {
    const raw = [
      '好的，下面是生成的场景：',
      '```json',
      '{ "schemaVersion": "2.0", "title": "磁聚焦", "params": { "B": 0.5 } }',
      '```',
      '可继续载入仿真。'
    ].join('\n');
    expect(extractJsonFromLlmOutput(raw)).toEqual({
      schemaVersion: '2.0',
      title: '磁聚焦',
      params: { B: 0.5 }
    });
  });

  it('ignores braces inside JSON strings while finding the object boundary', () => {
    const raw = '说明：{"note":"集合 {a, b} 不应影响括号配对","value":42} 完毕。';
    expect(extractJsonFromLlmOutput(raw)).toEqual({
      note: '集合 {a, b} 不应影响括号配对',
      value: 42
    });
  });

  it('classifies empty or malformed model output as INVALID_JSON', () => {
    for (const raw of ['', '没有 JSON 内容', '说明 {a,b} 然后结束']) {
      try {
        extractJsonFromLlmOutput(raw);
        expect.unreachable('无效输出应拒绝');
      } catch (error) {
        expect(error).toBeInstanceOf(ByokClientError);
        expect(error).toMatchObject({ code: 'INVALID_JSON' });
      }
    }
  });

  it('classifies an aborted request as TIMEOUT', async () => {
    const slowFetch: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const abort = () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });

    await expect(fetchWithTimeoutAndCorsHint('https://example.test/chat/completions', {}, 15, slowFetch))
      .rejects.toMatchObject({ name: 'ByokClientError', code: 'TIMEOUT' });
  });

  it('adds a CORS hint when the browser rejects a network request', async () => {
    const blockedFetch: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };

    await expect(fetchWithTimeoutAndCorsHint('https://example.test/chat/completions', {}, 1000, blockedFetch))
      .rejects.toMatchObject({
        name: 'ByokClientError',
        code: 'CORS_OR_NETWORK',
        message: expect.stringContaining('CORS')
      });
  });

  it('preserves the HTTP status and a bounded response hint', async () => {
    const failedFetch: typeof fetch = async () => new Response('upstream unavailable', { status: 502 });

    await expect(fetchWithTimeoutAndCorsHint('https://example.test/chat/completions', {}, 1000, failedFetch))
      .rejects.toMatchObject({ name: 'ByokClientError', code: 'HTTP_ERROR', status: 502 });
  });

  it('formats compact parameter signatures with range, unit, enum and boolean', () => {
    expect(formatModelSchemaHint('demo', [
      { key: 'v', kind: 'number', label: 'v', min: 0, max: 10, step: 1, defaultValue: 1, unit: 'm/s' },
      { key: 'mode', kind: 'select', label: 'mode', defaultValue: 'a', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
      { key: 'show', kind: 'boolean', label: 'show', defaultValue: false }
    ])).toBe('Schema demo: v: number[0..10] m/s; mode: select(a|b); show: boolean');
  });

  it('probes the provider models endpoint without submitting a generation request', async () => {
    const config = { baseUrl: 'https://example.test/v1/', apiKey: 'unit-test-key', model: 'demo' };
    const success: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('https://example.test/v1/models');
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer unit-test-key');
      return new Response(JSON.stringify({ data: [{ id: 'demo' }] }));
    };
    await expect(probeByokConnection(config, 1000, success)).resolves.toBeUndefined();
    await expect(probeByokConnection(config, 1000, async () => new Response('<html>')))
      .rejects.toMatchObject({ code: 'INVALID_JSON' });
    await expect(probeByokConnection(config, 1000, async () => new Response('{}')))
      .rejects.toMatchObject({ code: 'INVALID_JSON' });
    await expect(probeByokConnection(config, 1000, async () => new Response('', { status: 401 })))
      .rejects.toMatchObject({ code: 'HTTP_ERROR', status: 401 });
    await expect(probeByokConnection(config, 1000, async () => { throw new TypeError('Failed to fetch'); }))
      .rejects.toMatchObject({ code: 'CORS_OR_NETWORK' });
    const stalled: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const abort = () => reject(new Error('aborted'));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
    await expect(probeByokConnection(config, 10, stalled)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('times out when headers arrive but the JSON body stalls', async () => {
    const config = { baseUrl: 'https://example.test/v1', apiKey: 'unit-test-key', model: 'demo' };
    const stalledBody: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":'));
          const abort = () => controller.error(new DOMException('Aborted', 'AbortError'));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        }
      });
      return new Response(stream);
    };
    await expect(probeByokConnection(config, 20, stalledBody))
      .rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('injects the locally suggested schema and carries actual refinement feedback', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"schemaVersion":"2.0","modelId":"modern-photoelectric-compton","params":{}}' } }]
    })));
    vi.stubGlobal('fetch', fetchMock);
    const config = { baseUrl: 'https://example.test/v1', apiKey: 'unit-test-key', model: 'demo' };
    await requestByokSceneCandidate(config, '光电效应');
    const first = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(first).toContain('Schema modern-photoelectric-compton');
    expect(first).toContain('wavelengthNm: number[200..750] nm');
    expect(first).toContain('mode: select(photoelectric|compton)');
    const feedback = 'Unknown param "fake". Schema modern-photoelectric-compton: wavelengthNm: number[200..750] nm';
    await requestByokSceneCandidate(config, '光电效应', feedback);
    const second = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(second).toContain('wavelengthNm: number[200..750] nm');
    expect(second).toContain('Unknown param');
  });

  it('routes the existing request function through the parser without persisting its key', async () => {
    const fetchMock: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('https://api.example.test/v1/chat/completions');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer unit-test-key');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'SceneDSL:\n```json\n{"schemaVersion":"2.0","modelId":"mech-vertical-circular","params":{}}\n```' } }]
      }), { headers: { 'Content-Type': 'application/json' } });
    };
    vi.stubGlobal('fetch', fetchMock);

    const scene = await requestByokSceneCandidate(
      { baseUrl: '  https://api.example.test/v1/  ', apiKey: 'unit-test-key', model: 'test-model' },
      '竖直圆周运动'
    );

    expect(scene).toEqual({ schemaVersion: '2.0', modelId: 'mech-vertical-circular', params: {} });
  });
  it('rejects unsafe API destinations before sending credentials', async () => {
    const apiKey = 'unit-test-key';
    for (const baseUrl of ['http://example.test/v1', 'https://user:pass@example.test/v1', 'https://example.test/v1?secret=1', 'https://example.test/v1/chat/completions']) {
      expect(() => validateByokConfig({ baseUrl, apiKey, model: 'demo' })).toThrow(ByokClientError);
    }
    expect(validateByokConfig({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey, model: 'demo' }).hostname).toBe('127.0.0.1');
    const never = vi.fn<typeof fetch>();
    await expect(listByokModels({ baseUrl: 'http://example.test', apiKey, model: 'demo' }, 1000, never)).rejects.toMatchObject({ code: 'CONFIG' });
    expect(never).not.toHaveBeenCalled();
  });

  it('lists unique model IDs and does not expose upstream error bodies', async () => {
    const config = { baseUrl: 'https://example.test/v1', apiKey: 'unit-test-key', model: 'demo' };
    await expect(listByokModels(config, 1000, async () => new Response(JSON.stringify({
      data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: config.apiKey }, { id: 1 }]
    })))).resolves.toEqual(['a', 'b']);
    try {
      await listByokModels(config, 1000, async () => new Response(config.apiKey, { status: 401 }));
      expect.unreachable('must reject');
    } catch (error) {
      expect(String(error)).not.toContain(config.apiKey);
      expect(describeByokError(error)).toContain('401');
    }
  });

  it('uses current DeepSeek JSON mode without default reasoning overhead', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.deepseek.com/chat/completions');
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('error');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'deepseek-flash', thinking: { type: 'disabled' },
        response_format: { type: 'json_object' }, max_tokens: 2048, stream: false
      });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
        content: '{"schemaVersion":"2.0","modelId":"mech-vertical-circular","params":{}}'
      }}] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestByokSceneCandidate({ baseUrl: 'https://api.deepseek.com', apiKey: 'unit-test-key', model: 'deepseek-flash' }, '竖直圆周运动')).resolves.toMatchObject({ modelId: 'mech-vertical-circular' });
  });
});
