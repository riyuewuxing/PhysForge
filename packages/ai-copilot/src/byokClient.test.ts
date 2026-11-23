import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ByokClientError,
  extractJsonFromLlmOutput,
  fetchWithTimeoutAndCorsHint,
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

  it('routes the existing request function through the parser without persisting its key', async () => {
    const fetchMock: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('https://api.example.test/v1/chat/completions');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer unit-test-key');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'SceneDSL:\n```json\n{"schemaVersion":"2.0","modelId":"mech-vertical-circular","params":{}}\n```' } }]
      }), { headers: { 'Content-Type': 'application/json' } });
    };
    vi.stubGlobal('fetch', fetchMock);

    const scene = await requestByokSceneCandidate(
      { baseUrl: 'https://api.example.test/v1/', apiKey: 'unit-test-key', model: 'test-model' },
      '竖直圆周运动'
    );

    expect(scene).toEqual({ schemaVersion: '2.0', modelId: 'mech-vertical-circular', params: {} });
  });
});
