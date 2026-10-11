import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'oauth-return-test-'));
process.chdir(temporaryDirectory);
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = randomBytes(48).toString('base64');
process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const { default: app } = await import('../server.ts');
const { db } = await import('../src/server/db.ts');
const {
  ALLOWED_RETURN_SCREENS,
  validateReturnScreen,
  sanitizePendingAction,
} = await import('../src/server/openrouter-oauth.ts');

const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address() as { port: number };
const base = `http://127.0.0.1:${address.port}`;

const post = (path: string, body: unknown, cookie = '') =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  try {
    rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {}
});

test('validateReturnScreen strictly preserves allowlisted destinations and safely defaults unknown inputs to chat', () => {
  // All allowlisted destinations must return their exact values
  for (const screen of ALLOWED_RETURN_SCREENS) {
    assert.equal(validateReturnScreen(screen), screen);
  }

  // Any unknown, malicious, empty, or unexpected values must fallback to 'chat'
  assert.equal(validateReturnScreen('dashboard'), 'chat');
  assert.equal(validateReturnScreen('/root/admin'), 'chat');
  assert.equal(validateReturnScreen('../evil'), 'chat');
  assert.equal(validateReturnScreen('<script>alert(1)</script>'), 'chat');
  assert.equal(validateReturnScreen(''), 'chat');
  assert.equal(validateReturnScreen(null), 'chat');
  assert.equal(validateReturnScreen(undefined), 'chat');
  assert.equal(validateReturnScreen(123), 'chat');
  assert.equal(validateReturnScreen({}), 'chat');
});

test('sanitizePendingAction preserves safe actions and sanitizes malicious or invalid payloads', () => {
  // send_prompt action
  const promptAction = sanitizePendingAction({
    type: 'send_prompt',
    prompt: '  Hello OpenRouter free model!  ',
    chatId: 'chat-1234',
  });
  assert.deepEqual(promptAction, {
    type: 'send_prompt',
    prompt: 'Hello OpenRouter free model!',
    chatId: 'chat-1234',
  });

  // prompt length bounding
  const longPrompt = 'a'.repeat(5000);
  const boundedPromptAction = sanitizePendingAction({
    type: 'send_prompt',
    prompt: longPrompt,
  });
  assert.equal(boundedPromptAction?.type, 'send_prompt');
  if (boundedPromptAction && boundedPromptAction.type === 'send_prompt' && boundedPromptAction.prompt) {
    assert.equal(boundedPromptAction.prompt.length, 4000);
    assert.equal(boundedPromptAction.chatId, null);
  }

  // resume_friend_mode action
  const friendAction = sanitizePendingAction({ type: 'resume_friend_mode' });
  assert.deepEqual(friendAction, { type: 'resume_friend_mode' });

  // JSON string inputs
  const jsonParsedAction = sanitizePendingAction(
    JSON.stringify({ type: 'resume_friend_mode' })
  );
  assert.deepEqual(jsonParsedAction, { type: 'resume_friend_mode' });

  // Invalid / rejected actions
  assert.equal(sanitizePendingAction(null), undefined);
  assert.equal(sanitizePendingAction(undefined), undefined);
  assert.equal(sanitizePendingAction(''), undefined);
  assert.equal(sanitizePendingAction('not json'), undefined);
  assert.equal(sanitizePendingAction({ type: 'malicious_eval', code: 'doBad()' }), undefined);
  assert.equal(sanitizePendingAction({ type: 'send_prompt', prompt: '   ' }), undefined);
  assert.equal(sanitizePendingAction({ type: 'send_prompt' }), undefined);
});

test('OpenRouter connect endpoint requires authenticated user session', async () => {
  // Unauthenticated GET
  const getRes = await fetch(base + '/api/openrouter/connect');
  assert.equal(getRes.status, 401);
  const getJson = await getRes.json();
  assert.equal(getJson.error, 'Authentication required');

  // Unauthenticated POST
  const postRes = await post('/api/openrouter/connect', { returnScreen: 'friend-mode' });
  assert.equal(postRes.status, 401);
  const postJson = await postRes.json();
  assert.equal(postJson.error, 'Authentication required');
});

test('OAuth state single-use consumption and replay defense', async () => {
  const stateId = `test_state_${Date.now()}`;
  const codeVerifier = 'verifier_1234567890abcdefghijklmnopqrstuvwxyz';
  const userId = 'user_test_replay';

  // Save state with return screen and pending action
  await db.saveOAuthState(
    stateId,
    codeVerifier,
    userId,
    'friend-mode',
    JSON.stringify({ type: 'resume_friend_mode' })
  );

  // First consumption: MUST succeed
  const consumed = await db.consumeOAuthState(stateId);
  assert.ok(consumed, 'First consumption must return the state');
  assert.equal(consumed?.code_verifier, codeVerifier);
  assert.equal(consumed?.user_id, userId);
  assert.equal(consumed?.return_screen, 'friend-mode');
  assert.equal(consumed?.pending_action, JSON.stringify({ type: 'resume_friend_mode' }));

  // Replay attempt with the EXACT SAME state: MUST return undefined (single-use invariant)
  const replay = await db.consumeOAuthState(stateId);
  assert.equal(replay, undefined, 'Second consumption of same state must return undefined to prevent replay');

  // Non-existent state: MUST return undefined
  const nonExistent = await db.consumeOAuthState('random_nonexistent_state');
  assert.equal(nonExistent, undefined);
});

test('Authenticated user initiates connect: generates PKCE, preserves returnScreen and pendingAction', async () => {
  // 1. Register a test user
  const userPayload = {
    email: 'oauth_tester@example.com',
    password: 'secure-password-12345',
    name: 'OAuth Tester',
  };
  const regRes = await post('/api/auth/register', userPayload);
  assert.equal(regRes.status, 201);
  const cookie = regRes.headers.get('set-cookie')!.split(';')[0];

  // 2. Initial status: must be disconnected
  const statusRes = await fetch(base + '/api/openrouter/status', {
    headers: { Cookie: cookie },
  });
  assert.equal(statusRes.status, 200);
  const initialStatus = await statusRes.json();
  assert.equal(initialStatus.connected, false);

  // 3. Initiate connect requesting 'settings' returnScreen
  const connectRes = await post(
    '/api/openrouter/connect',
    {
      returnScreen: 'settings',
      pendingAction: {
        type: 'send_prompt',
        prompt: 'Hello after connecting!',
      },
    },
    cookie
  );

  assert.equal(connectRes.status, 200);
  const connectData = await connectRes.json();
  assert.ok(connectData.url, 'Must return authorization URL');
  assert.ok(connectData.state, 'Must return state');
  assert.equal(connectData.returnScreen, 'settings');
  assert.deepEqual(connectData.pendingAction, {
    type: 'send_prompt',
    prompt: 'Hello after connecting!',
    chatId: null,
  });

  // Verify auth URL has PKCE S256 parameters and state
  const authUrl = new URL(connectData.url);
  assert.equal(authUrl.origin, 'https://openrouter.ai');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authUrl.searchParams.get('code_challenge'));
  assert.equal(authUrl.searchParams.get('state'), connectData.state);

  // 4. Verify that state was persisted with returnScreen in DB and can be consumed
  const savedState = await db.consumeOAuthState(connectData.state);
  assert.ok(savedState);
  assert.equal(savedState?.return_screen, 'settings');
  assert.ok(savedState?.pending_action);
  const parsedAction = JSON.parse(savedState!.pending_action!);
  assert.equal(parsedAction.prompt, 'Hello after connecting!');

  // Replay consumption returns undefined
  assert.equal(await db.consumeOAuthState(connectData.state), undefined);
});

test('Authenticated user initiates connect via GET with query params: preserves friend-mode returnScreen and pendingAction', async () => {
  // Use registered user session
  const loginRes = await post('/api/auth/login', {
    email: 'oauth_tester@example.com',
    password: 'secure-password-12345',
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get('set-cookie')!.split(';')[0];

  const pendingActionPayload = { type: 'resume_friend_mode' };
  const query = new URLSearchParams({
    return_screen: 'friend-mode',
    pending_action: JSON.stringify(pendingActionPayload),
  });

  const getConnectRes = await fetch(`${base}/api/openrouter/connect?${query.toString()}`, {
    method: 'GET',
    headers: { Cookie: cookie },
  });

  assert.equal(getConnectRes.status, 200);
  const data = await getConnectRes.json();
  assert.ok(data.url, 'Must return authorization URL');
  assert.ok(data.state, 'Must return state');
  assert.equal(data.returnScreen, 'friend-mode');
  assert.deepEqual(data.pendingAction, { type: 'resume_friend_mode' });

  // Verify auth URL has PKCE S256 parameters and state
  const authUrl = new URL(data.url);
  assert.equal(authUrl.origin, 'https://openrouter.ai');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authUrl.searchParams.get('code_challenge'));
  assert.equal(authUrl.searchParams.get('state'), data.state);

  // Verify DB state persistence
  const savedState = await db.consumeOAuthState(data.state);
  assert.ok(savedState);
  assert.equal(savedState?.return_screen, 'friend-mode');
  assert.ok(savedState?.pending_action);
  const parsedAction = JSON.parse(savedState!.pending_action!);
  assert.equal(parsedAction.type, 'resume_friend_mode');
});

test('OAuth callback error handling preserves originating screen and renders Android return deep link without credentials', async () => {
  // Pre-save an OAuth state for 'models' screen
  const stateId = `state_err_${Date.now()}`;
  await db.saveOAuthState(stateId, 'verifier_err', 'user_err', 'models');

  // Simulate user cancellation / access denial callback
  const callbackUrl = `${base}/api/openrouter/callback?error=access_denied&error_description=User+declined&state=${encodeURIComponent(stateId)}`;
  const res = await fetch(callbackUrl);
  assert.equal(res.status, 200);

  const html = await res.text();
  // Must render error notice
  assert.ok(html.includes('Connection Incomplete'));
  // Must reference destination screen 'models'
  assert.ok(html.includes('models'));
  // Must contain deep link URLs with return_screen=models and status=error
  assert.ok(html.includes('intent://oauth-callback?provider=openrouter&status=error&return_screen=models'));
  assert.ok(html.includes('hello://oauth-callback?provider=openrouter&status=error&return_screen=models'));
  // Must NEVER expose any credentials or keys
  assert.ok(!html.includes('api_key'));
  assert.ok(!html.includes('access_token'));
  assert.ok(!html.includes('client_secret'));
});

test('OAuth callback with expired or missing state rejects gracefully', async () => {
  const callbackUrl = `${base}/api/openrouter/callback?code=mock_code_123&state=expired_or_invalid_state`;
  const res = await fetch(callbackUrl);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Authorization session expired or was already used'));
  assert.ok(html.includes('status=error'));
});
