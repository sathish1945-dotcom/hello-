import type { RequestHandler } from 'express';
import crypto from 'crypto';
import { db } from './db.ts';

export interface AdminDailyTask {
  id: string;
  created_by: string;
  title: string;
  description: string;
  language: string; // 'ta' | 'en' | 'tanglish' | 'all'
  status: 'draft' | 'preview' | 'published' | 'scheduled' | 'paused' | 'archived';
  start_time?: string;
  end_time?: string;
  link?: string;
  allow_participation: boolean;
  allow_dismiss: boolean;
  allow_reminder: boolean;
  spoken_reminder_text?: string;
  created_at: string;
  updated_at: string;
}

export interface AdminPromotion {
  id: string;
  created_by: string;
  title: string;
  description: string;
  label: 'Sponsored' | 'Advertisement'; // Strictly required label
  destination_url: string;
  format: 'card' | 'spoken' | 'both';
  status: 'draft' | 'preview' | 'approved' | 'scheduled' | 'paused' | 'archived';
  spoken_text?: string;
  max_frequency_per_day: number;
  created_at: string;
  updated_at: string;
}

export interface AdminAuditEvent {
  id: string;
  actor_id: string;
  actor_email: string;
  action: string;
  target_id: string;
  target_type: 'task' | 'promotion' | 'emergency_switch';
  timestamp: string;
}

export interface EmergencyKillswitchState {
  campaigns_disabled: boolean;
  reason?: string;
  toggled_by?: string;
  toggled_at?: string;
}

/**
 * Validates destination URLs against unsafe schemes (disallow javascript:, file:, data:, etc.)
 */
export function isValidDestinationUrl(urlStr?: string): boolean {
  if (!urlStr || !urlStr.trim()) return true;
  try {
    const parsed = new URL(urlStr.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Server-side role verification for Sathish / Admin.
 * Strictly verifies against authenticated session and server configuration.
 * Never trusts client-side admin flags.
 */
export function isAdminUser(user: { id: string; email: string; role?: string } | null | undefined): boolean {
  if (!user || !user.id) return false;
  // Strictly enforce server-verified role 'admin' on the authenticated user session.
  // Optionally support explicitly provisioned admin user IDs from server environment (never hardcoded email strings).
  const provisionedAdminIds = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return user.role === 'admin' || (provisionedAdminIds.length > 0 && provisionedAdminIds.includes(user.id));
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  const user = (req as any).user;
  if (!user || !isAdminUser(user)) {
    return res.status(403).json({
      error: 'Forbidden: Admin access required',
      code: 'ADMIN_ACCESS_REQUIRED',
    });
  }
  next();
};

export async function recordAdminAudit(
  actor: { id: string; email: string },
  action: string,
  targetId: string,
  targetType: 'task' | 'promotion' | 'emergency_switch'
): Promise<void> {
  const log: AdminAuditEvent = {
    id: crypto.randomUUID(),
    actor_id: actor.id,
    actor_email: actor.email,
    action,
    target_id: targetId,
    target_type: targetType,
    timestamp: new Date().toISOString(),
  };
  await db.recordAdminAudit(log);
}

// --- Admin Daily Task Handlers ---

export const handleAdminListTasks: RequestHandler = async (_req, res) => {
  const tasks = await db.getAdminTasks();
  res.json({ tasks });
};

export const handleAdminCreateTask: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const {
    title,
    description,
    language = 'all',
    status = 'draft',
    start_time,
    end_time,
    link,
    allow_participation = true,
    allow_dismiss = true,
    allow_reminder = false,
    spoken_reminder_text,
  } = req.body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Task title is required' });
  }

  if (link && !isValidDestinationUrl(link)) {
    return res.status(400).json({ error: 'Unsafe or invalid task link URL scheme' });
  }

  const task: AdminDailyTask = {
    id: crypto.randomUUID(),
    created_by: user.id,
    title: title.trim().slice(0, 150),
    description: (description && String(description).trim().slice(0, 500)) || '',
    language: String(language).slice(0, 20),
    status: ['draft', 'preview', 'published', 'scheduled', 'paused', 'archived'].includes(status)
      ? status
      : 'draft',
    start_time,
    end_time,
    link: link ? String(link).trim() : undefined,
    allow_participation: Boolean(allow_participation),
    allow_dismiss: Boolean(allow_dismiss),
    allow_reminder: Boolean(allow_reminder),
    spoken_reminder_text: spoken_reminder_text ? String(spoken_reminder_text).trim().slice(0, 300) : undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const saved = await db.saveAdminTask(task);
  await recordAdminAudit(user, 'task_created', task.id, 'task');

  res.status(201).json({ task: saved });
};

export const handleAdminUpdateTask: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const taskId = req.params.id;

  const {
    title,
    description,
    language,
    status,
    start_time,
    end_time,
    link,
    allow_participation,
    allow_dismiss,
    allow_reminder,
    spoken_reminder_text,
  } = req.body || {};

  if (link && !isValidDestinationUrl(link)) {
    return res.status(400).json({ error: 'Unsafe or invalid task link URL scheme' });
  }

  const updates: Partial<AdminDailyTask> = {
    ...(title && { title: String(title).trim().slice(0, 150) }),
    ...(description !== undefined && { description: String(description).trim().slice(0, 500) }),
    ...(language && { language: String(language).slice(0, 20) }),
    ...(status && { status }),
    ...(start_time !== undefined && { start_time }),
    ...(end_time !== undefined && { end_time }),
    ...(link !== undefined && { link: link ? String(link).trim() : undefined }),
    ...(allow_participation !== undefined && { allow_participation: Boolean(allow_participation) }),
    ...(allow_dismiss !== undefined && { allow_dismiss: Boolean(allow_dismiss) }),
    ...(allow_reminder !== undefined && { allow_reminder: Boolean(allow_reminder) }),
    ...(spoken_reminder_text !== undefined && { spoken_reminder_text: spoken_reminder_text ? String(spoken_reminder_text).trim().slice(0, 300) : undefined }),
  };

  const updated = await db.updateAdminTask(taskId, updates);
  if (!updated) {
    return res.status(404).json({ error: 'Task not found' });
  }

  await recordAdminAudit(user, `task_updated_${status || 'edit'}`, taskId, 'task');
  res.json({ task: updated });
};

export const handleAdminDeleteTask: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const taskId = req.params.id;

  const deleted = await db.deleteAdminTask(taskId);
  if (!deleted) {
    return res.status(404).json({ error: 'Task not found' });
  }

  await recordAdminAudit(user, 'task_deleted', taskId, 'task');
  res.json({ success: true });
};

// --- Admin Promotion Handlers ---

export const handleAdminListPromotions: RequestHandler = async (_req, res) => {
  const promotions = await db.getAdminPromotions();
  res.json({ promotions });
};

export const handleAdminCreatePromotion: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const {
    title,
    description,
    label = 'Sponsored',
    destination_url,
    format = 'card',
    status = 'draft',
    spoken_text,
    max_frequency_per_day = 1,
  } = req.body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Promotion title is required' });
  }

  if (!destination_url || !isValidDestinationUrl(destination_url)) {
    return res.status(400).json({ error: 'Safe and valid http(s) destination URL is required' });
  }

  const promo: AdminPromotion = {
    id: crypto.randomUUID(),
    created_by: user.id,
    title: title.trim().slice(0, 150),
    description: (description && String(description).trim().slice(0, 500)) || '',
    label: label === 'Advertisement' ? 'Advertisement' : 'Sponsored',
    destination_url: destination_url.trim(),
    format: ['card', 'spoken', 'both'].includes(format) ? format : 'card',
    status: ['draft', 'preview', 'approved', 'scheduled', 'paused', 'archived'].includes(status)
      ? status
      : 'draft',
    spoken_text: spoken_text ? String(spoken_text).trim().slice(0, 300) : undefined,
    max_frequency_per_day: Math.max(1, Math.min(5, Number(max_frequency_per_day) || 1)),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const saved = await db.saveAdminPromotion(promo);
  await recordAdminAudit(user, 'promotion_created', promo.id, 'promotion');

  res.status(201).json({ promotion: saved });
};

export const handleAdminUpdatePromotion: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const promoId = req.params.id;

  const {
    title,
    description,
    label,
    destination_url,
    format,
    status,
    spoken_text,
    max_frequency_per_day,
  } = req.body || {};

  if (destination_url && !isValidDestinationUrl(destination_url)) {
    return res.status(400).json({ error: 'Safe and valid http(s) destination URL is required' });
  }

  const updates: Partial<AdminPromotion> = {
    ...(title && { title: String(title).trim().slice(0, 150) }),
    ...(description !== undefined && { description: String(description).trim().slice(0, 500) }),
    ...(label && { label: label === 'Advertisement' ? 'Advertisement' : 'Sponsored' }),
    ...(destination_url && { destination_url: destination_url.trim() }),
    ...(format && { format }),
    ...(status && { status }),
    ...(spoken_text !== undefined && { spoken_text: spoken_text ? String(spoken_text).trim().slice(0, 300) : undefined }),
    ...(max_frequency_per_day && { max_frequency_per_day: Math.max(1, Math.min(5, Number(max_frequency_per_day) || 1)) }),
  };

  const updated = await db.updateAdminPromotion(promoId, updates);
  if (!updated) {
    return res.status(404).json({ error: 'Promotion not found' });
  }

  await recordAdminAudit(user, `promotion_updated_${status || 'edit'}`, promoId, 'promotion');
  res.json({ promotion: updated });
};

export const handleAdminDeletePromotion: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const promoId = req.params.id;

  const deleted = await db.deleteAdminPromotion(promoId);
  if (!deleted) {
    return res.status(404).json({ error: 'Promotion not found' });
  }

  await recordAdminAudit(user, 'promotion_deleted', promoId, 'promotion');
  res.json({ success: true });
};

// --- Emergency Killswitch ---

export const handleAdminGetEmergencySwitch: RequestHandler = async (_req, res) => {
  const sw = await db.getEmergencySwitch();
  res.json({ switch: sw });
};

export const handleAdminToggleEmergencySwitch: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const { disabled, reason } = req.body || {};

  const sw: EmergencyKillswitchState = {
    campaigns_disabled: Boolean(disabled),
    reason: reason ? String(reason).trim().slice(0, 200) : undefined,
    toggled_by: user.email,
    toggled_at: new Date().toISOString(),
  };

  const saved = await db.setEmergencySwitch(sw);
  await recordAdminAudit(
    user,
    `emergency_killswitch_${saved.campaigns_disabled ? 'engaged' : 'disengaged'}`,
    'global_emergency_switch',
    'emergency_switch'
  );

  res.json({ switch: saved });
};

// --- Audit Logs ---

export const handleAdminGetAuditLogs: RequestHandler = async (_req, res) => {
  const logs = await db.getAdminAuditLogs();
  res.json({ logs });
};

// --- Public User Endpoints ---

export const handleUserGetActiveTasks: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const emergencySwitch = await db.getEmergencySwitch();
  if (emergencySwitch.campaigns_disabled) {
    return res.json({ tasks: [] });
  }

  const allTasks = await db.getAdminTasks();
  const publishedTasks = allTasks.filter((t) => t.status === 'published');

  const tasksWithInteractions = await Promise.all(
    publishedTasks.map(async (t) => {
      const interaction = user ? await db.getUserTaskInteraction(user.id, t.id) : null;
      return {
        ...t,
        user_interaction: interaction || null,
      };
    })
  );

  const active = tasksWithInteractions.filter((t) => t.user_interaction?.status !== 'dismissed');
  res.json({ tasks: active });
};

export const handleUserInteractTask: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const taskId = req.params.id;
  const { status, reminder_enabled } = req.body || {};

  const interaction = await db.setUserTaskInteraction(
    user.id,
    taskId,
    status || 'viewed',
    Boolean(reminder_enabled)
  );

  res.json({ success: true, interaction });
};

export const handleUserGetActivePromotions: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const emergencySwitch = await db.getEmergencySwitch();
  if (emergencySwitch.campaigns_disabled) {
    return res.json({ promotions: [] });
  }

  // Spoken promotions strictly disabled by default: require explicit opt-in
  const hasSpokenOptIn = user ? await db.getUserPromotionPreference(user.id) : false;

  const allPromos = await db.getAdminPromotions();
  const active = allPromos
    .filter((p) => p.status === 'approved')
    .map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      label: p.label,
      destination_url: p.destination_url,
      format: p.format,
      spoken_text: hasSpokenOptIn ? p.spoken_text : undefined,
    }));

  res.json({ promotions: active, user_opted_in_spoken: Boolean(hasSpokenOptIn) });
};

export const handleUserSetSpokenPromotionConsent: RequestHandler = async (req, res) => {
  const user = (req as any).user;
  const { opt_in } = req.body || {};

  const consented = await db.setUserPromotionPreference(user.id, Boolean(opt_in));
  res.json({ success: true, user_opted_in_spoken: consented });
};

export const handleUserOptOutSpokenPromotions = handleUserSetSpokenPromotionConsent;
