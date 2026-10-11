import crypto from 'crypto';
import type { Request, Response } from 'express';
import { db } from './db.ts';
import { encryptCredential } from './encryption.ts';
import { generateToken, setSessionCookie } from './auth.ts';

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generates a secure random code_verifier (32 random bytes, base64url-encoded).
 */
function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

/**
 * Generates an S256 code_challenge: SHA-256 hash of code_verifier, base64url-encoded.
 */
function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64UrlEncode(hash);
}

import {
  ALLOWED_RETURN_SCREENS,
  validateReturnScreen,
  type ReturnScreen,
  type PendingAction,
} from '../types/index.ts';

export {
  ALLOWED_RETURN_SCREENS,
  validateReturnScreen,
  type ReturnScreen,
  type PendingAction,
};

export function sanitizePendingAction(rawAction: unknown): PendingAction | undefined {
  if (!rawAction) return undefined;
  let parsed = rawAction;
  if (typeof rawAction === 'string') {
    try {
      parsed = JSON.parse(rawAction);
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const action = parsed as Record<string, any>;
  const type = String(action.type || '').trim();

  if (type === 'send_prompt' && typeof action.prompt === 'string') {
    const cleanPrompt = action.prompt.trim().slice(0, 4000);
    if (!cleanPrompt) return undefined;
    return {
      type: 'send_prompt',
      prompt: cleanPrompt,
      chatId: typeof action.chatId === 'string' && action.chatId.trim() ? action.chatId.trim().slice(0, 100) : null,
    };
  }

  if (type === 'open_modal') {
    return {
      type: 'open_modal',
      screen: validateReturnScreen(action.screen),
    };
  }

  if (type === 'resume_friend_mode') {
    return { type: 'resume_friend_mode' };
  }

  return undefined;
}

export function getAppUrl(req: Request): string {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, '');
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
  return `${protocol}://${host}`;
}

/**
 * Generates OpenRouter official PKCE authorization URL:
 * Redirect user to https://openrouter.ai/auth with:
 * - callback_url
 * - code_challenge
 * - code_challenge_method=S256
 * Note: OpenRouter PKCE does NOT require client_id or client_secret.
 * GET/POST /api/openrouter/connect
 */
export async function handleOpenRouterConnect(req: Request, res: Response) {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const rawReturnScreen = req.query.return_screen || req.body?.returnScreen || req.query.returnScreen;
    const returnScreen = validateReturnScreen(rawReturnScreen);

    const rawPendingAction = req.body?.pendingAction || req.query.pending_action || req.query.pendingAction;
    const pendingAction = sanitizePendingAction(rawPendingAction);

    const state = base64UrlEncode(crypto.randomBytes(24));
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Persist state + code_verifier + returnScreen + pendingAction securely on backend
    await db.saveOAuthState(
      state,
      codeVerifier,
      user.id,
      returnScreen,
      pendingAction ? JSON.stringify(pendingAction) : undefined
    );

    const appUrl = getAppUrl(req);
    // Include state in callback URL query string so state is preserved across redirects
    const callbackUrl = `${appUrl}/api/openrouter/callback?state=${encodeURIComponent(state)}`;

    const params = new URLSearchParams({
      callback_url: callbackUrl,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });

    const authUrl = `https://openrouter.ai/auth?${params.toString()}`;

    return res.json({
      url: authUrl,
      callbackUrl,
      state,
      returnScreen,
      pendingAction: pendingAction || null,
    });
  } catch (err: any) {
    console.error('[OpenRouter OAuth] Failed to generate connect URL:', err);
    return res.status(500).json({ error: 'Failed to initiate OpenRouter authorization' });
  }
}

/**
 * Handles callback from OpenRouter after user authorizes:
 * Receive authorization code on the callback.
 * Exchange code + code_verifier at https://openrouter.ai/api/v1/auth/keys.
 * Receive user's OpenRouter API key.
 * Encrypt the key server-side using AES-256-GCM.
 * Store the encrypted key in the database linked only to that user.
 * Verify provider connection through backend before rendering success.
 * GET /api/openrouter/callback
 */
export async function handleOpenRouterCallback(req: Request, res: Response) {
  const { code, state, error, error_description } = req.query;

  const rawState = state;
  const stateStr = Array.isArray(rawState) ? String(rawState[0]) : typeof rawState === 'string' ? rawState : '';
  const codeStr = Array.isArray(code) ? String(code[0]) : typeof code === 'string' ? code : '';

  const renderResponse = (success: boolean, message: string, returnScreen: ReturnScreen = 'chat', pendingAction?: PendingAction) => {
    const origin = new URL(getAppUrl(req)).origin;
    const safeMessage = message.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
    const payload = JSON.stringify({
      type: success ? 'OAUTH_AUTH_SUCCESS' : 'OAUTH_AUTH_ERROR',
      provider: 'openrouter',
      returnScreen,
      state: stateStr || undefined,
      pendingAction: success ? pendingAction : undefined,
      error: success ? null : message,
    }).replace(/</g, '\\u003c');

    const returnParam = `return_screen=${encodeURIComponent(returnScreen)}`;
    const statusParam = `status=${success ? 'success' : 'error'}`;
    const stateParam = stateStr ? `&state=${encodeURIComponent(stateStr)}` : '';
    const errorParam = !success ? `&error=${encodeURIComponent(safeMessage)}` : '';
    const androidIntentUrl = `intent://oauth-callback?provider=openrouter&${statusParam}&${returnParam}${stateParam}${errorParam}#Intent;scheme=hello;package=com.hello.ai;end`;
    const androidSchemeUrl = `hello://oauth-callback?provider=openrouter&${statusParam}&${returnParam}${stateParam}${errorParam}`;
    const webRedirect = `${origin}/?integration_connected=openrouter&${returnParam}${success ? '' : '&integration_error=' + encodeURIComponent(safeMessage)}`;

    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>hello - OpenRouter Connection</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background-color: #09090b;
              color: #f4f4f5;
              padding: 16px;
              box-sizing: border-box;
            }
            .card {
              max-width: 440px;
              width: 100%;
              text-align: center;
              padding: 32px 24px;
              background: #18181b;
              border: 1px solid #27272a;
              border-radius: 16px;
              box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
            }
            .icon { font-size: 2.5rem; margin-bottom: 12px; }
            h2 { margin-top: 0; font-size: 1.35rem; font-weight: 600; }
            p { font-size: 0.95rem; color: #a1a1aa; line-height: 1.5; }
            .btn {
              margin-top: 12px;
              display: inline-block;
              background: #2563eb;
              color: #fff;
              padding: 12px 24px;
              border-radius: 10px;
              text-decoration: none;
              font-size: 0.95rem;
              font-weight: 600;
              cursor: pointer;
              border: none;
              transition: background 0.15s ease;
            }
            .btn:hover { background: #1d4ed8; }
            .btn-secondary {
              background: #27272a;
              color: #e4e4e7;
            }
            .btn-secondary:hover { background: #3f3f46; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">${success ? '👋' : '⚠️'}</div>
            <h2>${success ? 'OpenRouter Connected!' : 'Connection Incomplete'}</h2>
            <p>${safeMessage}</p>
            <p style="font-size: 0.85rem; color: #71717a;">Returning to ${returnScreen}...</p>
            <div style="margin-top: 20px; display: flex; flex-direction: column; gap: 10px; align-items: center;">
              <a class="btn" href="${androidIntentUrl}">Return to Hello App</a>
              <a class="btn btn-secondary" href="${androidSchemeUrl}">Open Hello Directly</a>
              <button class="btn btn-secondary" onclick="window.close()" style="font-size: 0.85rem; padding: 8px 16px;">Close Browser</button>
            </div>
            <script>
              try {
                if (window.opener && window.opener !== window) {
                  window.opener.postMessage(${payload}, ${JSON.stringify(origin)});
                  setTimeout(() => window.close(), 1200);
                } else {
                  // Attempt automatic handoff back to native app or web
                  setTimeout(() => {
                    window.location.href = ${JSON.stringify(androidIntentUrl)};
                  }, 600);
                }
              } catch (e) {
                // Keep manual buttons visible
              }
            </script>
          </div>
        </body>
      </html>
    `);
  };

  if (error || error_description) {
    console.warn('[OpenRouter OAuth] Error from callback:', error, error_description);
    let errorReturnScreen: ReturnScreen = 'chat';
    if (stateStr) {
      const s = await db.consumeOAuthState(stateStr);
      if (s?.return_screen) {
        errorReturnScreen = validateReturnScreen(s.return_screen);
      }
    }
    return renderResponse(false, 'Authorization was cancelled or rejected by the provider.', errorReturnScreen);
  }

  if (!codeStr || !stateStr) {
    return renderResponse(false, 'Missing required authorization code or state parameters.', 'chat');
  }

  // Verify and consume state (atomic single-use check)
  const oauthState = await db.consumeOAuthState(stateStr);
  if (!oauthState) {
    return renderResponse(false, 'Authorization session expired or was already used. Please try connecting again.', 'chat');
  }

  const returnScreen = validateReturnScreen(oauthState.return_screen);
  let pendingAction: PendingAction | undefined;
  if (oauthState.pending_action) {
    try {
      pendingAction = JSON.parse(oauthState.pending_action);
    } catch {}
  }

  try {
    // Official OpenRouter PKCE exchange:
    // POST https://openrouter.ai/api/v1/auth/keys with { code, code_verifier, code_challenge_method: "S256" }
    const exchangeBody: Record<string, string> = {
      code: codeStr,
      code_verifier: oauthState.code_verifier,
      code_challenge_method: 'S256',
    };

    const exchangeRes = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'hello/1.0',
      },
      body: JSON.stringify(exchangeBody),
    });

    if (!exchangeRes.ok) {
      const errText = await exchangeRes.text();
      console.error('[OpenRouter OAuth] Key exchange failed with status', exchangeRes.status, errText);
      return renderResponse(false, 'Failed to exchange authorization code with OpenRouter. Please try again.', returnScreen);
    }

    const data = (await exchangeRes.json()) as { key?: string };
    if (!data.key || typeof data.key !== 'string') {
      return renderResponse(false, 'OpenRouter did not return a valid key.', returnScreen);
    }

    // Encrypt received key server-side using AES-256-GCM
    const encryptedKey = encryptCredential(data.key);

    // Store encrypted key in database linked strictly to the authenticated user
    await db.saveProviderConnection(oauthState.user_id, 'openrouter', encryptedKey, 'connected');

    // Verify provider connection through backend before reporting success
    const verifiedConn = await db.getProviderConnection(oauthState.user_id, 'openrouter');
    if (!verifiedConn || verifiedConn.connection_status !== 'connected') {
      return renderResponse(false, 'Failed to verify provider connection after key exchange.', returnScreen);
    }

    // Restore and refresh user session cookie
    const user = await db.findUserById(oauthState.user_id);
    if (user) {
      setSessionCookie(res, generateToken(user));
    }

    return renderResponse(
      true,
      'Your OpenRouter account has been connected securely. Returning to hello...',
      returnScreen,
      pendingAction
    );
  } catch (err: any) {
    console.error('[OpenRouter OAuth] Error during key exchange or encryption:', err);
    return renderResponse(false, 'An unexpected error occurred during connection. Please retry.', returnScreen);
  }
}

/**
 * Returns connection status for current user (never exposes decrypted or raw keys)
 * GET /api/openrouter/status
 */
export async function handleOpenRouterStatus(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const conn = await db.getProviderConnection(user.id, 'openrouter');
  return res.json({
    connected: !!conn && conn.connection_status === 'connected',
    provider: 'openrouter',
    mode: 'free_only',
    updatedAt: conn?.updated_at || null,
  });
}

/**
 * Disconnects OpenRouter credential for current user
 * POST /api/openrouter/disconnect
 */
export async function handleOpenRouterDisconnect(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const success = await db.disconnectProvider(user.id, 'openrouter');
  return res.json({
    success,
    connected: false,
    message: 'OpenRouter account disconnected.',
  });
}

/**
 * Saves OpenRouter API key directly for current user
 * POST /api/openrouter/key
 */
export async function handleOpenRouterSaveKey(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { apiKey } = req.body || {};
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim().startsWith('sk-or-')) {
    return res.status(400).json({ error: 'Invalid OpenRouter API key. It should start with sk-or-' });
  }

  try {
    const encryptedKey = encryptCredential(apiKey.trim());
    await db.saveProviderConnection(user.id, 'openrouter', encryptedKey, 'connected');
    return res.json({
      success: true,
      connected: true,
      message: 'OpenRouter API key saved securely.',
    });
  } catch (err: any) {
    console.error('[OpenRouter] Failed to encrypt and save manual API key:', err);
    return res.status(500).json({ error: 'Failed to securely store OpenRouter key' });
  }
}

