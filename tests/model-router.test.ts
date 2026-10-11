import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModelRoute } from '../src/server/model-router.ts';

test('task routes select explicit available chat models, never the random free router', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [
    'cohere/north-mini-code:free',
    'google/gemma-4-31b-it:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'inclusionai/ling-3.0-flash-fin:free',
    'inclusionai/ling-3.0-flash:free',
    'qwen/qwen3.8-27b:free',
  ].map((id) => ({ id, pricing: { prompt: '0', completion: '0' } })) }), { status: 200 });
  try {
    const coding = await resolveModelRoute('coding');
    const reasoning = await resolveModelRoute('reasoning');
    const finance = await resolveModelRoute('finance');
    const chat = await resolveModelRoute('general');
    const selected = await resolveModelRoute('general', undefined, 'qwen/qwen3.8-27b:free');
    assert.equal(selected.selectedModel, 'qwen/qwen3.8-27b:free');
    assert.ok(selected.fallbackModels.length > 2);
    assert.ok(!selected.fallbackModels.includes(selected.selectedModel));
    const retired = await resolveModelRoute('general', undefined, 'retired/model:free');
    assert.notEqual(retired.selectedModel, 'retired/model:free');
    assert.equal(coding.selectedModel, 'cohere/north-mini-code:free');
    assert.equal(reasoning.selectedModel, 'nvidia/nemotron-3-ultra-550b-a55b:free');
    assert.equal(finance.selectedModel, 'inclusionai/ling-3.0-flash-fin:free');
    assert.equal(chat.selectedModel, 'google/gemma-4-31b-it:free');
    assert.equal(chat.fallbackModels[0], 'inclusionai/ling-3.0-flash:free');
    assert.equal(chat.fallbackModels[1], 'qwen/qwen3.8-27b:free');
    for (const route of [coding, reasoning, finance, chat]) {
      assert.ok([route.selectedModel, ...route.fallbackModels].every((id) => id.endsWith(':free') && id !== 'openrouter/free'));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
