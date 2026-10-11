/** Bounded, cancellable failover across explicit free chat models. */
export class ChatProviderError extends Error {
  constructor(public code: string, message: string, public retryable = true) { super(message); }
}

export function providerError(status: number, payload: unknown, headers?: Headers): ChatProviderError {
  const data = typeof payload === 'object' && payload ? payload as any : {};
  const error = data.error || data;
  const message = typeof error.message === 'string' ? error.message : String(payload || '');
  const metadata = error.metadata || {};
  const upstream = Boolean(metadata.provider_name || metadata.provider_code) || /upstream|provider returned error/i.test(message);
  if (status === 401) return new ChatProviderError('AUTH_REQUIRED', 'Please reconnect your OpenRouter account.', false);
  if (status === 402 || (!upstream && /daily limit|insufficient credits|quota exceeded|free-models-per-day/i.test(message))) {
    return new ChatProviderError('ACCOUNT_QUOTA', 'Your OpenRouter allowance is exhausted. Please wait for it to reset or check your account.', false);
  }
  if (status === 429 && !upstream && (/free-models-per-min|requests per minute|account.*rate.limit/i.test(message) || headers?.get('x-ratelimit-remaining') === '0' || metadata.headers?.['X-RateLimit-Remaining'] === '0')) {
    return new ChatProviderError('ACCOUNT_RATE_LIMIT', 'Your account is sending requests too quickly. Please wait a minute before retrying.', false);
  }
  if (status === 403 && !upstream) return new ChatProviderError('REQUEST_BLOCKED', 'This request was blocked. Check your OpenRouter permissions or revise your message.', false);
  return new ChatProviderError('PROVIDER_UNAVAILABLE', 'This provider is unavailable.');
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason || new Error('Aborted'));
    if (signal.aborted) { void promise.catch(() => {}); aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

interface Options {
  models: string[];
  apiKey: string;
  appUrl: string;
  messages: Array<{ role: string; content: string }>;
  signal: AbortSignal;
  onChunk: (text: string) => void;
  onSwitch: (previousModel: string, activeModel: string, resetContent: boolean) => void;
  fetchImpl?: typeof fetch;
  budgetMs?: number;
  firstTokenMs?: number;
  idleMs?: number;
}

export async function streamWithFallback(options: Options): Promise<{ text: string; model: string }> {
  const { signal, onChunk, onSwitch } = options;
  const fetchImpl = options.fetchImpl || fetch;
  const deadline = Date.now() + Math.min(options.budgetMs ?? 45000, 45000);
  const models = [...new Set(options.models)].filter(id => id.endsWith(':free') && id !== 'openrouter/auto:free').slice(0, 8);
  let previousModel = '';
  let previousHadText = false;
  for (const model of models) {
    if (signal.aborted) throw signal.reason || new Error('Aborted');
    if (Date.now() >= deadline) break;
    if (previousModel) onSwitch(previousModel, model, previousHadText);
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    let timer: ReturnType<typeof setTimeout>;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let response: globalThis.Response | undefined;
    let text = '';
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error('Provider timed out')), Math.max(1, Math.min(ms, deadline - Date.now())));
    };
    try {
      arm(options.firstTokenMs ?? 6000);
      response = await abortable(fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': options.appUrl, 'X-Title': 'hello' },
        body: JSON.stringify({ model, messages: options.messages, stream: true, provider: { allow_fallbacks: true } }),
      }), controller.signal);
      if (!response.ok) {
        const raw = await abortable(response.text(), controller.signal);
        let payload: unknown = raw;
        try { payload = JSON.parse(raw); } catch { /* Plain-text upstream error. */ }
        throw providerError(response.status, payload, response.headers);
      }
      if (!response.body) throw new ChatProviderError('EMPTY_STREAM', 'Provider returned no stream.');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let complete = false;
      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const raw = trimmed.slice(5).trim();
        if (!raw) return;
        if (raw === '[DONE]') { complete = true; return; }
        let event: any;
        try { event = JSON.parse(raw); } catch { throw new ChatProviderError('BROKEN_STREAM', 'Malformed response from provider.'); }
        if (event.error) throw providerError(Number(event.error.code) || 502, event);
        const choice = event.choices?.[0];
        if (!choice) return;
        if (choice.finish_reason === 'error') throw new ChatProviderError('BROKEN_STREAM', 'Provider stream failed.');
        const content = choice.delta?.content;
        const chunk = typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => typeof p === 'string' ? p : p?.text || '').join('') : typeof choice.text === 'string' ? choice.text : '';
        if (chunk) { text += chunk; onChunk(chunk); arm(options.idleMs ?? 8000); }
        if (choice.finish_reason && choice.finish_reason !== 'error') complete = true;
      };
      while (!complete) {
        const item = await abortable(reader.read(), controller.signal);
        buffer += decoder.decode(item.value, { stream: !item.done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) { processLine(line); if (complete) break; }
        if (item.done) { if (buffer) processLine(buffer); break; }
      }
      const guardrailOnly = /^\s*(?:user safety\s*:\s*safe\s*)?(?:response safety\s*:\s*safe)\s*$/i.test(text);
      if (!complete || !text.trim() || guardrailOnly) throw new ChatProviderError('INCOMPLETE_STREAM', 'Provider did not finish a usable reply.');
      return { text, model };
    } catch (error) {
      if (signal.aborted) throw signal.reason || error;
      if (error instanceof ChatProviderError && !error.retryable) throw error;
      previousModel = model;
      previousHadText = text.length > 0;
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener('abort', cancel);
      controller.abort();
      if (reader) { void reader.cancel().catch(() => {}); }
      else if (response?.body && !response.body.locked) { void response.body.cancel().catch(() => {}); }
    }
  }
  throw new ChatProviderError('ALL_PROVIDERS_BUSY', 'All available free providers are busy right now. Please retry shortly; your message is saved.', false);
}
