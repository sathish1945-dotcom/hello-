import assert from 'node:assert/strict';
import test from 'node:test';
import { streamWithFallback, ChatProviderError } from '../src/server/chat-fallback.ts';

const encode = new TextEncoder();
const event = (value: unknown) => `data:${JSON.stringify(value)}\n\n`;
const chunk = (content: string) => event({ choices: [{ delta: { content } }] });
const good = () => new Response(chunk('Hello') + 'data: [DONE]\n\n');
function opts(fetchImpl: typeof fetch, extra: Record<string, any> = {}) {
  return { models: ['first/model:free', 'second/model:free', 'third/model:free', 'fourth/model:free'], apiKey: 'test-only', appUrl: 'https://example.com', messages: [{ role: 'user', content: 'Hello' }], signal: new AbortController().signal, onChunk: (_: string) => {}, onSwitch: () => {}, fetchImpl, ...extra };
}

test('busy selected model cascades through more than three distinct free models', async () => {
  const attempts: string[] = [];
  const fetchImpl: typeof fetch = async (_, init) => {
    const body = JSON.parse(init!.body as string); attempts.push(body.model);
    assert.equal(body.provider.allow_fallbacks, true);
    return attempts.length < 4 ? new Response(JSON.stringify({ error: { message: 'Provider returned error', metadata: { provider_name: 'test' } } }), { status: 429 }) : good();
  };
  const result = await streamWithFallback(opts(fetchImpl));
  assert.equal(result.model, 'fourth/model:free'); assert.equal(result.text, 'Hello'); assert.equal(new Set(attempts).size, 4);
});

test('provider 5xx, retired model and network failures fall through', async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => { attempts++; if (attempts === 1) throw new TypeError('Network error'); if (attempts < 4) return new Response('{}', { status: attempts === 2 ? 503 : 404 }); return good(); };
  assert.equal((await streamWithFallback(opts(fetchImpl))).text, 'Hello'); assert.equal(attempts, 4);
});

test('broken partial stream is discarded before the successful fallback', async () => {
  let attempts = 0, displayed = '', cancelled = 0;
  const fetchImpl: typeof fetch = async () => ++attempts === 1 ? new Response(new ReadableStream({ start(c) { c.enqueue(encode.encode(chunk('Wrong partial') + event({ error: { code: 503, message: 'Provider error' } }))); }, cancel() { cancelled++; } })) : good();
  const result = await streamWithFallback(opts(fetchImpl, { onChunk: (s: string) => displayed += s, onSwitch: (_a: string, _b: string, reset: boolean) => { assert.equal(reset, true); displayed = ''; } }));
  assert.equal(result.text, 'Hello'); assert.equal(displayed, 'Hello'); assert.equal(cancelled, 1);
});

test('first-token timeout cancels stalled body and switches models', async () => {
  let attempts = 0, cancelled = false;
  const fetchImpl: typeof fetch = async () => ++attempts === 1 ? new Response(new ReadableStream({ cancel() { cancelled = true; } })) : good();
  assert.equal((await streamWithFallback(opts(fetchImpl, { firstTokenMs: 15 }))).text, 'Hello'); assert.equal(cancelled, true);
});

test('idle timeout replaces an unfinished partial answer', async () => {
  let attempts = 0, reset = false;
  const fetchImpl: typeof fetch = async () => ++attempts === 1 ? new Response(new ReadableStream({ start(c) { c.enqueue(encode.encode(chunk('partial'))); } })) : good();
  const result = await streamWithFallback(opts(fetchImpl, { idleMs: 15, onSwitch: (_a: string, _b: string, flag: boolean) => reset = flag }));
  assert.equal(result.text, 'Hello'); assert.equal(reset, true);
});

test('account quota and invalid credentials stop instead of hammering providers', async () => {
  for (const [status, message, code] of [[401,'Unauthorized','AUTH_REQUIRED'],[402,'Insufficient credits','ACCOUNT_QUOTA'],[429,'Rate limit exceeded: free-models-per-day','ACCOUNT_QUOTA'],[429,'Rate limit exceeded: free-models-per-min','ACCOUNT_RATE_LIMIT']] as const) {
    let attempts = 0;
    const fetchImpl: typeof fetch = async () => { attempts++; return new Response(JSON.stringify({ error: { message } }), { status }); };
    await assert.rejects(streamWithFallback(opts(fetchImpl)), (e: ChatProviderError) => e.code === code); assert.equal(attempts, 1);
  }
});

test('account-wide streaming errors stop fallback too', async () => {
  let attempts = 0;
  await assert.rejects(streamWithFallback(opts(async () => { attempts++; return new Response(event({ error: { code: 402, message: 'Insufficient credits' } })); })), (e: ChatProviderError) => e.code === 'ACCOUNT_QUOTA');
  assert.equal(attempts, 1);
});

test('client cancellation stops upstream and never starts fallback', async () => {
  const controller = new AbortController(); let attempts = 0, cancelled = false;
  const fetchImpl: typeof fetch = async () => { attempts++; return new Response(new ReadableStream({ start() { setTimeout(() => controller.abort(new Error('User stopped')), 5); }, cancel() { cancelled = true; } })); };
  await assert.rejects(streamWithFallback(opts(fetchImpl, { signal: controller.signal })), /User stopped/);
  assert.equal(attempts, 1); assert.equal(cancelled, true);
});

test('truncated and empty streams retry instead of saving incomplete answers', async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => ++attempts === 1 ? new Response(chunk('truncated')) : attempts === 2 ? new Response('data: [DONE]\n\n') : good();
  assert.equal((await streamWithFallback(opts(fetchImpl))).text, 'Hello'); assert.equal(attempts, 3);
});

test('completion without final newline and repeated deltas are preserved', async () => {
  const fetchImpl: typeof fetch = async () => new Response(chunk('ha') + chunk('ha') + 'data:{"choices":[{"delta":{},"finish_reason":"stop"}]}');
  assert.equal((await streamWithFallback(opts(fetchImpl))).text, 'haha');
});

test('global time budget and unique-attempt cap prevent endless retry loops', async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => { attempts++; return new Response(new ReadableStream()); };
  await assert.rejects(streamWithFallback(opts(fetchImpl, { budgetMs: 20, firstTokenMs: 100 })), (e: ChatProviderError) => e.code === 'ALL_PROVIDERS_BUSY');
  assert.equal(attempts, 1);
  const calls: string[] = [];
  await assert.rejects(streamWithFallback(opts(async (_, init) => { calls.push(JSON.parse(init!.body as string).model); return new Response('{}', { status: 503 }); }, { models: ['paid/model', 'openrouter/free', ...Array.from({ length: 12 }, (_, i) => `test/${i}:free`), 'test/0:free'] })), (e: ChatProviderError) => e.code === 'ALL_PROVIDERS_BUSY');
  assert.equal(calls.length, 8); assert.equal(new Set(calls).size, 8); assert.ok(calls.every(id => id.endsWith(':free')));
});

test('generic platform rate limit with exhausted headers is not retried across models', async () => {
  let attempts = 0;
  await assert.rejects(streamWithFallback(opts(async () => { attempts++; return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), { status: 429, headers: { 'X-RateLimit-Remaining': '0' } }); })), (e: ChatProviderError) => e.code === 'ACCOUNT_RATE_LIMIT');
  assert.equal(attempts, 1);
});

test('timeout before response headers moves to a working provider', async () => {
  let attempts = 0;
  const fetchImpl: typeof fetch = async () => ++attempts === 1 ? new Promise<Response>(() => {}) : good();
  assert.equal((await streamWithFallback(opts(fetchImpl, { firstTokenMs: 15 }))).text, 'Hello');
  assert.equal(attempts, 2);
});

test('split UTF-8 tokens and SSE frames reconstruct Tamil correctly', async () => {
  const bytes = encode.encode(': keepalive\n\n' + chunk('வணக்கம்') + 'data: [DONE]\n\n');
  const fetchImpl: typeof fetch = async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i++) c.enqueue(bytes.slice(i, i + 1)); c.close(); } }));
  assert.equal((await streamWithFallback(opts(fetchImpl))).text, 'வணக்கம்');
});
