import express, { type RequestHandler, type ErrorRequestHandler } from 'express';
import { verifyGoogleIdentity } from './src/server/google-auth.ts';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnvironment } from './src/server/env.ts';

// Load environment variables safely (never override production secrets)
loadEnvironment();

import { db } from './src/server/db.ts';
import {
  generateToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  hashPassword,
  verifyPassword,
  getSessionFromRequest,
} from './src/server/auth.ts';
import {
  handleOpenRouterConnect,
  handleOpenRouterCallback,
  handleOpenRouterStatus,
  handleOpenRouterDisconnect,
  handleOpenRouterSaveKey,
  getAppUrl,
} from './src/server/openrouter-oauth.ts';
import { handleChatStream, handleChatCancel } from './src/server/chat-service.ts';
import { chatRateLimit, apiRateLimit } from './src/server/rate-limit.ts';
import { validateAndGetEncryptionKey } from './src/server/encryption.ts';
import { decryptCredential } from './src/server/encryption.ts';
import { getFreeChatModels } from './src/server/model-registry.ts';
import { connectorRegistry } from './src/server/plugins/registry.ts';
import { handleGoogleDriveConnect, handleGoogleDriveCallback } from './src/server/plugins/google-drive-oauth.ts';
import {
  handleGetMemories,
  handleSaveMemory,
  handleUpdateMemory,
  handleDeleteMemory,
  handleClearMemories,
} from './src/server/friend-memories-service.ts';
import {
  requireAdmin,
  handleAdminListTasks,
  handleAdminCreateTask,
  handleAdminUpdateTask,
  handleAdminDeleteTask,
  handleAdminListPromotions,
  handleAdminCreatePromotion,
  handleAdminUpdatePromotion,
  handleAdminDeletePromotion,
  handleAdminGetEmergencySwitch,
  handleAdminToggleEmergencySwitch,
  handleAdminGetAuditLogs,
  handleUserGetActiveTasks,
  handleUserInteractTask,
  handleUserGetActivePromotions,
  handleUserOptOutSpokenPromotions,
} from './src/server/admin-service.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

// Configuration checks happen inside requests so errors remain JSON.
app.use('/api', (_req, res, next) => {
  try {
    validateAndGetEncryptionKey();
    if (isProduction && !process.env.AUTH_SECRET) throw new Error('AUTH_SECRET is required');
    next();
  } catch (error) {
    console.error('[API] Required server configuration is invalid');
    res.status(503).json({ error: 'Server configuration is incomplete. Please contact support.' });
  }
});

// Basic middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    if (
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.startsWith('capacitor://') ||
      origin.includes('vercel.app')
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    }
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(apiRateLimit);


// --- Public Config Endpoint (NO SECRETS) ---
app.get('/api/health', asyncRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  await db.checkHealth();
  res.json({ status: 'ok' });
}));

app.get('/api/config', asyncRoute(async (req, res) => {
  res.json({
    appName: 'hello',
    appUrl: getAppUrl(req),
    hasGoogleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  });
}));

// --- Authentication Endpoints ---

// Register with email/password
app.post('/api/auth/register', asyncRoute(async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await db.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const user = await db.createUser({
      email,
      name: (name && String(name).trim()) || email.split('@')[0],
      password_hash: passwordHash,
      auth_provider: 'email',
    });

    const token = generateToken(user);
    setSessionCookie(res, token);

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        auth_provider: user.auth_provider,
        created_at: user.created_at,
      },
      token,
    });
  } catch (err) {
    console.error('[Auth] Registration error:', (err as any)?.code || (err as any)?.name);
    if ((err as any)?.code === '23505') return res.status(409).json({ error: 'An account with this email already exists' });
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
}));

// Login with email/password
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await db.findUserByEmail(email);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await verifyPassword(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user);
    setSessionCookie(res, token);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        auth_provider: user.auth_provider,
        created_at: user.created_at,
      },
      token,
    });
  } catch (err) {
    console.error('[Auth] Login error:', (err as any)?.code || (err as any)?.name);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}));

// Google Sign-in / SSO
app.post('/api/auth/google', asyncRoute(async (req, res) => {
  try {
    let identity;
    try {
      identity = await verifyGoogleIdentity(req.body?.idToken);
    } catch {
      return res.status(401).json({ error: 'Google sign-in could not be verified. Please sign in again.' });
    }
    const { email: userEmail, name: userName } = identity;

    let user = await db.findUserByEmail(userEmail);
    if (user && user.auth_provider !== 'google') {
      return res.status(409).json({ error: 'This account uses email and password. Please sign in with your password.' });
    }
    if (!user) {
      user = await db.createUser({
        email: userEmail,
        name: userName || userEmail.split('@')[0],
        auth_provider: 'google',
      });
    }

    const token = generateToken(user);
    setSessionCookie(res, token);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        auth_provider: user.auth_provider,
        created_at: user.created_at,
      },
      token,
    });
  } catch (err) {
    console.error('[Google Auth] Sign in error:', err);
    return res.status(500).json({ error: 'Google sign in failed' });
  }
}));

// Get current logged-in user
app.get('/api/auth/me', asyncRoute(async (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.json({ user: null });
  }
  const user = await db.findUserById(session.userId);
  if (!user) {
    clearSessionCookie(res);
    return res.json({ user: null });
  }
  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      auth_provider: user.auth_provider,
      created_at: user.created_at,
    },
  });
}));

// Logout
app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  clearSessionCookie(res);
  return res.json({ success: true, message: 'Logged out successfully' });
}));

// --- OpenRouter OAuth Routes ---
app.get('/api/openrouter/connect', requireAuth, asyncRoute(handleOpenRouterConnect));
app.post('/api/openrouter/connect', requireAuth, asyncRoute(handleOpenRouterConnect));
app.get(['/api/openrouter/callback', '/api/openrouter/callback/'], asyncRoute(handleOpenRouterCallback));
app.get('/api/openrouter/status', requireAuth, asyncRoute(handleOpenRouterStatus));
app.post('/api/openrouter/key', requireAuth, asyncRoute(handleOpenRouterSaveKey));
app.post('/api/openrouter/disconnect', requireAuth, asyncRoute(handleOpenRouterDisconnect));

app.get('/api/models', asyncRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ models: await getFreeChatModels() });
}));
app.get('/api/models/usage', requireAuth, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const conn = await db.getProviderConnection((req as any).user.id, 'openrouter');
  if (!conn?.encrypted_credential) return res.status(409).json({ error: 'Connect OpenRouter to see usage.' });
  const response = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${decryptCredential(conn.encrypted_credential)}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return res.status(502).json({ error: 'OpenRouter usage is temporarily unavailable.' });
  const payload = await response.json() as { data?: { free_model_daily_requests?: { used: number; limit: number; remaining: number } } };
  res.json({ daily: payload.data?.free_model_daily_requests ?? null });
}));

// --- Google Drive integrations (all account data is scoped to the session user) ---
app.get('/api/integrations', requireAuth, asyncRoute(async (req, res) => {
  res.json({ integrations: await connectorRegistry.getSummaries((req as any).user.id) });
}));
app.get('/api/integrations/audit-logs', requireAuth, asyncRoute(async (req, res) => {
  res.json({ logs: await db.getAuditLogs((req as any).user.id) });
}));
app.get('/api/integrations/google-drive/connect', requireAuth, asyncRoute(handleGoogleDriveConnect));
app.get('/api/integrations/google-drive/callback', asyncRoute(handleGoogleDriveCallback));
app.post('/api/integrations/google-drive/disconnect', requireAuth, asyncRoute(async (req, res) => {
  const connector = connectorRegistry.getConnector('google-drive');
  if (!connector) return res.status(503).json({ error: 'Google Drive connector unavailable' });
  await connector.disconnect((req as any).user.id);
  res.json({ success: true });
}));

// --- Chat History Routes ---
app.get('/api/chats', requireAuth, asyncRoute(async (req, res) => {
  const user = (req as any).user;
  const chats = await db.getUserChats(user.id);
  res.json({ chats });
}));

app.post('/api/chats', requireAuth, asyncRoute(async (req, res) => {
  const user = (req as any).user;
  const title = (req.body.title && String(req.body.title).trim()) || 'New Chat';
  const chat = await db.createChat(user.id, title);
  res.status(201).json({ chat });
}));

app.get('/api/chats/:id', requireAuth, asyncRoute(async (req, res) => {
  const user = (req as any).user;
  const chat = await db.getChatById(req.params.id, user.id);
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  const messages = await db.getChatMessages(chat.id);
  res.json({ chat, messages });
}));

app.delete('/api/chats/:id', requireAuth, asyncRoute(async (req, res) => {
  const user = (req as any).user;
  const success = await db.deleteChat(req.params.id, user.id);
  if (!success) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  res.json({ success: true });
}));

// --- Streaming Chat Route ---
app.post('/api/chat', requireAuth, chatRateLimit, asyncRoute(handleChatStream));
app.post('/api/chat/cancel', requireAuth, asyncRoute(handleChatCancel));

// --- Friend Mode Persistent Memories Routes (Step 10) ---
app.get('/api/friend/memories', requireAuth, asyncRoute(handleGetMemories));
app.post('/api/friend/memories', requireAuth, asyncRoute(handleSaveMemory));
app.put('/api/friend/memories/:id', requireAuth, asyncRoute(handleUpdateMemory));
app.delete('/api/friend/memories/:id', requireAuth, asyncRoute(handleDeleteMemory));
app.delete('/api/friend/memories', requireAuth, asyncRoute(handleClearMemories));

// --- Daily Tasks & Promotions (User Endpoints) ---
app.get('/api/tasks/active', asyncRoute(handleUserGetActiveTasks));
app.post('/api/tasks/:id/interact', requireAuth, asyncRoute(handleUserInteractTask));
app.get('/api/promotions/active', asyncRoute(handleUserGetActivePromotions));
app.post('/api/promotions/opt-out', requireAuth, asyncRoute(handleUserOptOutSpokenPromotions));

// --- Founder Admin Panel Routes (Sathish / Server-Enforced Role) ---
app.get('/api/admin/tasks', requireAuth, requireAdmin, asyncRoute(handleAdminListTasks));
app.post('/api/admin/tasks', requireAuth, requireAdmin, asyncRoute(handleAdminCreateTask));
app.put('/api/admin/tasks/:id', requireAuth, requireAdmin, asyncRoute(handleAdminUpdateTask));
app.delete('/api/admin/tasks/:id', requireAuth, requireAdmin, asyncRoute(handleAdminDeleteTask));

app.get('/api/admin/promotions', requireAuth, requireAdmin, asyncRoute(handleAdminListPromotions));
app.post('/api/admin/promotions', requireAuth, requireAdmin, asyncRoute(handleAdminCreatePromotion));
app.put('/api/admin/promotions/:id', requireAuth, requireAdmin, asyncRoute(handleAdminUpdatePromotion));
app.delete('/api/admin/promotions/:id', requireAuth, requireAdmin, asyncRoute(handleAdminDeletePromotion));

app.get('/api/admin/emergency-switch', requireAuth, requireAdmin, asyncRoute(handleAdminGetEmergencySwitch));
app.post('/api/admin/emergency-switch', requireAuth, requireAdmin, asyncRoute(handleAdminToggleEmergencySwitch));
app.get('/api/admin/audit-logs', requireAuth, requireAdmin, asyncRoute(handleAdminGetAuditLogs));

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
const apiErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  console.error('[API request]', error?.code || error?.name || 'Error');
  if (res.headersSent) return next(error);
  const status = error?.type === 'entity.parse.failed' ? 400 :
    error?.type === 'entity.too.large' ? 413 : error?.code === '23505' ? 409 : 503;
  res.status(status).json({ error: status === 400 ? 'Invalid JSON request' :
    status === 413 ? 'Request is too large' : status === 409 ? 'Account already exists' :
    'The service is temporarily unavailable. Please try again.' });
};
app.use(apiErrorHandler);

export default app;

// --- Setup Vite or Static File Serving ---
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[hello Server] Running at http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL && process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch((err) => {
    console.error('[hello Server] Fatal startup error:', err);
    process.exitCode = 1;
  });
}
