import { simulationCatalog } from '@physforge/simulations/catalog';

export interface ByokConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
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

  const res = await fetch(endpoint, {
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
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    throw new Error(`BYOK API HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const rawText = data.choices?.[0]?.message?.content ?? '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`BYOK response did not contain valid JSON: ${rawText.slice(0, 120)}`);
  }
  return JSON.parse(jsonMatch[0]) as unknown;
}
