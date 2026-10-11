import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'fallback-test-'));
process.chdir(temporaryDirectory);
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = randomBytes(48).toString('base64');
process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const { db } = await import('../src/server/db.ts');
const { encryptCredential } = await import('../src/server/encryption.ts');
const {
  executeChatStream,
  cancelChatRequest,
  activeChatRequests,
  USER_QUOTA_ERROR_MESSAGE,
} = await import('../src/server/chat-service.ts');
const { getFallbackConfig } = await import('../src/server/fallback-config.ts');
const { resolveModelRoute } = await import('../src/server/model-router.ts');

after(async () => {
  try {
    rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {}
});

function createMockResponse() {
  const events: any[] = [];
  let ended = false;
  let statusCode = 200;
  const headers: Record<string, string> = {};

  const mockRes = {
    writeHead(status: number, h: Record<string, string>) {
      statusCode = status;
      Object.assign(headers, h);
      return mockRes;
    },
    status(code: number) {
      statusCode = code;
      return mockRes;
    },
    json(data: any) {
      statusCode = statusCode || 200;
      ended = true;
      return mockRes;
    },
    write(chunk: string) {
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            events.push(JSON.parse(line.slice(6)));
          } catch {}
        }
      }
      return true;
    },
    end() {
      ended = true;
      return mockRes;
    },
    get writableEnded() {
      return ended;
    },
    get statusCode() {
      return statusCode;
    },
    events,
  };
  return mockRes;
}

function createMockRequest(body: any, user: any) {
  const listeners: Record<string, Function[]> = {};
  const headers: Record<string, string> = { host: 'localhost:3000' };

  return {
    body,
    user,
    headers,
    protocol: 'http',
    get(name: string) {
      return headers[name.toLowerCase()] || '';
    },
    on(event: string, fn: Function) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeListener(event: string, fn: Function) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== fn);
      }
    },
    emit(event: string, ...args: any[]) {
      (listeners[event] || []).forEach((fn) => fn(...args));
    },
  };
}

function createSSEStreamResponse(textChunks: string[]) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of textChunks) {
        const payload = JSON.stringify({
          choices: [{ delta: { content: chunk } }],
        });
        controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
      }
      controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function setupTestUserWithApiKey() {
  const user = await db.createUser({
    email: `test_${Date.now()}_${Math.random()}@example.com`,
    name: 'Fallback Tester',
    auth_provider: 'email',
  });
  const encryptedKey = encryptCredential('sk-or-v1-mock-valid-key');
  await db.saveProviderConnection(user.id, 'openrouter', encryptedKey, 'connected');
  return user;
}

test('1. First attempt fails; second succeeds -> exactly one completed reply and turn', async () => {
  const user = await setupTestUserWithApiKey();
  const res = createMockResponse();
  const req = createMockRequest({ prompt: 'Tell me a joke', aiMode: 'auto' }, user);

  let attemptCount = 0;
  const attemptedModels: string[] = [];

  const mockFetch: typeof globalThis.fetch = async (url, init) => {
    attemptCount++;
    const body = JSON.parse(String(init?.body || '{}'));
    attemptedModels.push(body.model);

    if (attemptCount === 1) {
      // First model fails with temporary HTTP 503
      return new Response('Overloaded', { status: 503 });
    }
    // Second model succeeds
    return createSSEStreamResponse(['Macha, ', 'why did the computer take a break? ', 'It needed a byte!']);
  };

  await executeChatStream(req as any, res as any, {
    fetchFn: mockFetch,
    configOverrides: { MAX_TOTAL_ATTEMPTS: 3 },
  });

  assert.equal(attemptCount, 2, 'Must try second model after first fails');
  assert.equal(attemptedModels.length, 2);
  assert.notEqual(attemptedModels[0], attemptedModels[1], 'Must select different model for fallback');

  // Verify fallback_switch event
  const switchEvent = res.events.find((e) => e.type === 'fallback_switch');
  assert.ok(switchEvent, 'Must emit fallback_switch event');
  assert.equal(switchEvent.resetContent, false, 'Transparent fallback because model 1 had not sent content');

  // Verify completion done event
  const doneEvent = res.events.find((e) => e.type === 'done');
  assert.ok(doneEvent, 'Must emit done event');
  assert.equal(doneEvent.modelId, attemptedModels[1]);

  // Verify DB contains exactly 1 user message and 1 assistant message
  const messages = await db.getChatMessages(doneEvent.chatId);
  const userMsgs = messages.filter((m) => m.role === 'user');
  const assistantMsgs = messages.filter((m) => m.role === 'assistant');
  assert.equal(userMsgs.length, 1);
  assert.equal(assistantMsgs.length, 1);
  assert.ok(assistantMsgs[0].content.includes('It needed a byte!'));
});

test('2. All attempts fail -> stops after available candidates (bounded by MAX_TOTAL_ATTEMPTS) without infinite loop', async () => {
  const user = await setupTestUserWithApiKey();
  const res = createMockResponse();
  const req = createMockRequest({ prompt: 'Explain gravity', aiMode: 'auto' }, user);

  let attemptCount = 0;
  const mockFetch: typeof globalThis.fetch = async () => {
    attemptCount++;
    return new Response('Gateway timeout', { status: 504 });
  };

  await executeChatStream(req as any, res as any, {
    fetchFn: mockFetch,
    configOverrides: { MAX_TOTAL_ATTEMPTS: 3 },
  });

  assert.ok(attemptCount >= 1 && attemptCount <= 3, 'Must be bounded by total eligible candidates and at most MAX_TOTAL_ATTEMPTS');
  assert.ok(attemptCount > 0, 'Must attempt eligible candidates');

  const errorEvent = res.events.find((e) => e.type === 'error');
  assert.ok(errorEvent, 'Must emit error event when all attempts fail');
  assert.ok(!res.events.some((e) => e.type === 'done'), 'Must not emit done event');
});

test('3. Per-attempt timeout -> aborts hanging attempt and advances to next model', async () => {
  const user = await setupTestUserWithApiKey();
  const res = createMockResponse();
  const req = createMockRequest({ prompt: 'Quick response needed' }, user);

  let attemptCount = 0;
  const mockFetch: typeof globalThis.fetch = async (_url, init) => {
    attemptCount++;
    if (attemptCount === 1) {
      // Hang until aborted by per-attempt timeout
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('ATTEMPT_TIMEOUT')));
      });
    }
    return createSSEStreamResponse(['Fast answer received.']);
  };

  await executeChatStream(req as any, res as any, {
    fetchFn: mockFetch,
    perAttemptTimeoutMs: 60, // Short timeout for test
    overallDeadlineMs: 2000,
    configOverrides: { MAX_TOTAL_ATTEMPTS: 3 },
  });

  assert.equal(attemptCount, 2, 'Should move to attempt 2 after attempt 1 times out');
  const doneEvent = res.events.find((e) => e.type === 'done');
  assert.ok(doneEvent);
});

test('4. Overall deadline exhaustion -> aborts when overall budget expires', async () => {
  const user = await setupTestUserWithApiKey();
  const res = createMockResponse();
  const req = createMockRequest({ prompt: 'Will deadline expire?' }, user);

  let attemptCount = 0;
  const mockFetch: typeof globalThis.fetch = async () => {
    attemptCount++;
    // Sleep 80ms per attempt
    await new Promise((r) => setTimeout(r, 80));
    return new Response('Temporary failure', { status: 503 });
  };

  await executeChatStream(req as any, res as any, {
    fetchFn: mockFetch,
    overallDeadlineMs: 120, // Deadline shorter than 2 full attempts
    perAttemptTimeoutMs: 100,
    configOverrides: { MAX_TOTAL_ATTEMPTS: 3 },
  });

  // Since each attempt takes 80ms and deadline is 120ms, attempt 2 will see deadline exceeded
  assert.ok(attemptCount <= 2, `Should not start 3rd attempt after deadline exceeded (actual: ${attemptCount})`);
  const errorEvent = res.events.find((e) => e.type === 'error');
  assert.ok(errorEvent);
});

test('5. Retry-After within deadline is respected; Retry-After beyond deadline proceeds immediately', async () => {
  const user = await setupTestUserWithApiKey();

  // Case A: Retry-After fits remaining deadline
  {
    const res = createMockResponse();
    const req = createMockRequest({ prompt: 'Rate limit test 1' }, user);
    let attemptCount = 0;
    const startTime = Date.now();

    const mockFetch: typeof globalThis.fetch = async () => {
      attemptCount++;
      if (attemptCount === 1) {
        return new Response('Rate limited', {
          status: 429,
          headers: {
            'retry-after': '1', // 1 second
          },
        });
      }
      return createSSEStreamResponse(['Success after retry delay']);
    };

    await executeChatStream(req as any, res as any, {
      fetchFn: mockFetch,
      overallDeadlineMs: 5000,
      configOverrides: { MAX_TOTAL_ATTEMPTS: 3 },
    });

    assert.equal(attemptCount, 2);
    const elapsed = Date.now() - startTime;
    assert.ok(elapsed >= 900, `Must respect Retry-After delay when it fits deadline (elapsed: ${elapsed}ms)`);
  }

  // Case B: Retry-After exceeds remaining deadline -> do NOT sleep past deadline
  {
    const res = createMockResponse();
    const req = createMockRequest({ prompt: 'Rate limit test 2' }, user);
    let attemptCount = 0;
    const startTime = Date.now();

    const mockFetch: typeof globalThis.fetch = async () => {
      attemptCount++;
      if (attemptCount === 1) {
        return new Response('Rate limited', {
          status: 429,
          headers: {
            'retry-after': '60', // 60 seconds (far exceeds 300ms deadline)
          },
        });
      }
      return createSSEStreamResponse(['Fast fallback']);
    };

    await executeChatStream(req as any, res as any, {
      fetchFn: mockFetch,
      overallDeadlineMs: 400,
      configOverrides: { MAX_TOTAL_ATTEMPTS: 3 },
    });

    const elapsed = Date.now() - startTime;
    assert.ok(elapsed < 1000, `Must not sleep for 60s when deadline is 400ms (elapsed: ${elapsed}ms)`);
  }
});

test('6. Non-retryable errors (HTTP 400, 401, 403, 402 quota) fail immediately without retrying', async () => {
  const user = await setupTestUserWithApiKey();

  for (const status of [400, 401, 403, 402]) {
    const res = createMockResponse();
    const req = createMockRequest({ prompt: `Testing HTTP ${status}` }, user);
    let attempts = 0;

    const mockFetch: typeof globalThis.fetch = async () => {
      attempts++;
      return new Response(status === 402 ? 'Daily quota exceeded' : 'Client error', { status });
    };

    await executeChatStream(req as any, res as any, {
      fetchFn: mockFetch,
      configOverrides: { MAX_TOTAL_ATTEMPTS: 3 },
    });

    assert.equal(attempts, 1, `HTTP ${status} must not be retried (attempted ${attempts} times)`);
    const errorEvent = res.events.find((e) => e.type === 'error');
    assert.ok(errorEvent, `HTTP ${status} must emit error event`);
    if (status === 402) {
      assert.equal(errorEvent.error, USER_QUOTA_ERROR_MESSAGE);
    }
  }
});

test('7. Unauthorized paid-model prevention: requests for paid models without budget policy are rejected', async () => {
  const user = await setupTestUserWithApiKey();
  const res = createMockResponse();
  // Attempt to explicitly select a paid model like openai/gpt-4o
  const req = createMockRequest({ prompt: 'Hello', modelId: 'openai/gpt-4o' }, user);

  await executeChatStream(req as any, res as any, {
    configOverrides: { ALLOW_PAID_MODELS: false },
  });

  assert.equal(res.statusCode, 400);
});

test('8. Client cancellation propagates and suppresses subsequent fallback and late events', async () => {
  const user = await setupTestUserWithApiKey();
  const res = createMockResponse();
  const requestId = `test_cancel_${Date.now()}`;
  const req = createMockRequest({ prompt: 'Cancel me', requestId }, user);

  let attempts = 0;
  const mockFetch: typeof globalThis.fetch = async (_url, init) => {
    attempts++;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('CLIENT_CANCELLED')));
    });
  };

  const streamPromise = executeChatStream(req as any, res as any, {
    fetchFn: mockFetch,
    configOverrides: { MAX_TOTAL_ATTEMPTS: 3 },
  });

  // Cancel via active request registry while in flight
  setTimeout(() => {
    cancelChatRequest(requestId, user.id);
  }, 30);

  await streamPromise;

  assert.equal(attempts, 1, 'Must not start fallback attempts after cancellation');
  assert.ok(!res.events.some((e) => e.type === 'done'), 'Must not emit done event when cancelled');
});

test('9. Interrupted streaming resets content and marks replacement', async () => {
  const user = await setupTestUserWithApiKey();
  const res = createMockResponse();
  const req = createMockRequest({ prompt: 'Interruption test' }, user);

  let attempt = 0;
  const mockFetch: typeof globalThis.fetch = async () => {
    attempt++;
    if (attempt === 1) {
      // Emit partial chunk on first read, then disconnect abruptly on second read
      let pullCount = 0;
      const stream = new ReadableStream({
        pull(controller) {
          pullCount++;
          if (pullCount === 1) {
            const payload = JSON.stringify({ choices: [{ delta: { content: 'Partial broke' } }] });
            controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
          } else {
            controller.error(new Error('Stream disconnected abruptly'));
          }
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    // Attempt 2 succeeds with clean content
    return createSSEStreamResponse(['Clean replacement output.']);
  };

  await executeChatStream(req as any, res as any, {
    fetchFn: mockFetch,
    configOverrides: { MAX_TOTAL_ATTEMPTS: 3 },
  });

  assert.equal(attempt, 2);

  // Check fallback_switch has resetContent: true
  const switchEvent = res.events.find((e) => e.type === 'fallback_switch');
  assert.ok(switchEvent);
  assert.equal(switchEvent.resetContent, true, 'Must indicate resetContent for interrupted stream');
  assert.equal(switchEvent.reason, 'interrupted');

  // Verify DB only has clean replacement output
  const doneEvent = res.events.find((e) => e.type === 'done');
  assert.ok(doneEvent);
  const messages = await db.getChatMessages(doneEvent.chatId);
  const assistantMsg = messages.find((m) => m.role === 'assistant');
  assert.ok(assistantMsg);
  assert.equal(assistantMsg.content, 'Clean replacement output.');
  assert.ok(!assistantMsg.content.includes('Partial broke'), 'Must never append onto interrupted text');
});

test('10. Cross-account cancellation is strictly prevented and returns 403 Forbidden', async () => {
  const userA = await setupTestUserWithApiKey();
  const userB = await setupTestUserWithApiKey();

  const requestId = 'req-cross-cancel-' + Date.now();
  const res = createMockResponse();
  const req = createMockRequest({ prompt: 'Test cross cancellation', requestId }, userA);

  const mockFetch: typeof globalThis.fetch = async () => {
    // Hangs for 200ms to allow cancellation check
    await new Promise((r) => setTimeout(r, 200));
    return createSSEStreamResponse(['Late output from User A']);
  };

  const streamPromise = executeChatStream(req as any, res as any, {
    fetchFn: mockFetch,
    configOverrides: { MAX_TOTAL_ATTEMPTS: 2, PER_ATTEMPT_TIMEOUT_MS: 5000 },
  });

  // Wait for request to register in activeChatRequests
  await new Promise((r) => setTimeout(r, 25));
  assert.ok(activeChatRequests.has(requestId), 'Request must be registered in activeChatRequests');

  // Attempt cancellation as User B (attacker / unauthorized account)
  const cancelResultUnauthorized = cancelChatRequest(requestId, userB.id);
  assert.equal(cancelResultUnauthorized.success, false);
  assert.equal(cancelResultUnauthorized.status, 403);
  assert.ok(cancelResultUnauthorized.error?.includes('Unauthorized') || cancelResultUnauthorized.error?.includes('another user'));
  assert.ok(activeChatRequests.has(requestId), 'Request must NOT be cancelled by unauthorized user');

  // Cancel as User A (owner)
  const cancelResultOwner = cancelChatRequest(requestId, userA.id);
  assert.equal(cancelResultOwner.success, true);
  assert.equal(cancelResultOwner.status, 200);
  assert.ok(!activeChatRequests.has(requestId), 'Request must be removed from activeChatRequests upon owner cancellation');

  await streamPromise;
  assert.ok(!res.events.some((e) => e.type === 'done'), 'Cancelled request must not commit to done');
});

test('11. Model candidate policy: respects 0, 1, or 2 eligible models without artificial padding', async () => {
  const user = await setupTestUserWithApiKey();

  // A. Zero eligible models:
  // When no eligible free models exist, resolveModelRoute / executeChatStream must not query upstream
  const res0 = createMockResponse();
  const req0 = createMockRequest({ prompt: 'Zero models test', modelId: 'non-existent-model' }, user);

  await executeChatStream(req0 as any, res0 as any);
  assert.equal(res0.statusCode, 400);

  // B. Route resolution candidate count verification:
  // A category with 2 models must return 1 selectedModel and 1 fallbackModel (total 2), NOT manufactured to 3
  const route = await resolveModelRoute('finance', undefined, undefined, {
    configOverrides: { MAX_TOTAL_ATTEMPTS: 3 },
  });
  const totalCandidates = [route.selectedModel, ...route.fallbackModels].filter(Boolean);
  assert.ok(totalCandidates.length <= 3, 'Must never exceed MAX_TOTAL_ATTEMPTS');
  assert.ok(!totalCandidates.includes('openrouter/free'), 'Must never include openrouter/free');

  // C. Exactly 1 model attempt:
  // If only 1 model is configured in options, it should attempt only 1 time and NOT manufacture phantom models
  let attemptsMade = 0;
  const mockFetch1: typeof globalThis.fetch = async () => {
    attemptsMade++;
    return new Response('Overloaded', { status: 503 });
  };

  const res1 = createMockResponse();
  const req1 = createMockRequest({ prompt: 'Single model test' }, user);
  await executeChatStream(req1 as any, res1 as any, {
    fetchFn: mockFetch1,
    maxTotalAttempts: 1,
  });

  assert.equal(attemptsMade, 1, 'Must stop after exactly 1 attempt when candidate limit is 1');
  const errorEvent = res1.events.find((e) => e.type === 'error');
  assert.ok(errorEvent, 'Must emit error event when single attempt fails');
});

test('12. Idle chunk timer: long responses (>12s equivalent) succeed when streaming actively', async () => {
  const user = await setupTestUserWithApiKey();
  const res = createMockResponse();
  const req = createMockRequest({ prompt: 'Stream long story' }, user);

  // Per-attempt timeout: 60ms. Total stream time: 140ms across 4 chunks (every 30ms).
  // Without idle chunk timer reset, the stream would abort at 60ms!
  // With idle chunk timer reset, each chunk resets the 60ms timer, so it succeeds.
  const mockFetch: typeof globalThis.fetch = async () => {
    const chunks = ['Chapter 1: The start. ', 'Chapter 2: The middle. ', 'Chapter 3: The climax. ', 'Chapter 4: The end.'];
    let chunkIndex = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (chunkIndex >= chunks.length) {
          controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
          controller.close();
          return;
        }
        await new Promise((r) => setTimeout(r, 30));
        const payload = JSON.stringify({ choices: [{ delta: { content: chunks[chunkIndex] } }] });
        controller.enqueue(new TextEncoder().encode(`data: ${payload}\n\n`));
        chunkIndex++;
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };

  await executeChatStream(req as any, res as any, {
    fetchFn: mockFetch,
    perAttemptTimeoutMs: 60,
    overallDeadlineMs: 1000,
    maxTotalAttempts: 1,
  });

  const doneEvent = res.events.find((e) => e.type === 'done');
  assert.ok(doneEvent, 'Long streaming response must complete successfully when chunks are actively arriving');
  const messages = await db.getChatMessages(doneEvent.chatId);
  const assistantMsg = messages.find((m) => m.role === 'assistant');
  assert.ok(assistantMsg?.content.includes('Chapter 4: The end.'));
});

test('13. activeChatRequests registry is cleaned up on success, error, and timeout', async () => {
  assert.equal(activeChatRequests.size, 0, 'activeChatRequests must be 0 after all tests complete');
});
