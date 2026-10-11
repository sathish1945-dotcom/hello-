import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  CalendarCheck,
  Megaphone,
  AlertOctagon,
  FileText,
  Plus,
  Play,
  Pause,
  Archive,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { getApiUrl, getStoredAuthToken } from '../lib/api.ts';
import type { User } from '../types/index.ts';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
}

interface AdminDailyTask {
  id: string;
  created_by: string;
  title: string;
  description: string;
  language: string;
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

interface AdminPromotion {
  id: string;
  created_by: string;
  title: string;
  description: string;
  label: 'Sponsored' | 'Advertisement';
  destination_url: string;
  format: 'card' | 'spoken' | 'both';
  status: 'draft' | 'preview' | 'approved' | 'scheduled' | 'paused' | 'archived';
  spoken_text?: string;
  max_frequency_per_day: number;
  created_at: string;
  updated_at: string;
}

interface AdminAuditEvent {
  id: string;
  actor_id: string;
  actor_email: string;
  action: string;
  target_id: string;
  target_type: 'task' | 'promotion' | 'emergency_switch';
  timestamp: string;
}

interface EmergencyKillswitchState {
  campaigns_disabled: boolean;
  reason?: string;
  toggled_by?: string;
  toggled_at?: string;
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  isOpen,
  onClose,
  user,
}) => {
  const [activeTab, setActiveTab] = useState<'tasks' | 'promotions' | 'emergency' | 'audit'>('tasks');
  const [tasks, setTasks] = useState<AdminDailyTask[]>([]);
  const [promotions, setPromotions] = useState<AdminPromotion[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditEvent[]>([]);
  const [emergencySwitch, setEmergencySwitch] = useState<EmergencyKillswitchState>({ campaigns_disabled: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New Task Form
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskLanguage, setTaskLanguage] = useState('all');
  const [taskStatus, setTaskStatus] = useState<AdminDailyTask['status']>('draft');
  const [taskLink, setTaskLink] = useState('');
  const [taskAllowParticipation, setTaskAllowParticipation] = useState(true);
  const [taskAllowDismiss, setTaskAllowDismiss] = useState(true);
  const [taskAllowReminder, setTaskAllowReminder] = useState(false);
  const [taskSpokenReminder, setTaskSpokenReminder] = useState('');

  // New Promotion Form
  const [isCreatingPromo, setIsCreatingPromo] = useState(false);
  const [promoTitle, setPromoTitle] = useState('');
  const [promoDescription, setPromoDescription] = useState('');
  const [promoLabel, setPromoLabel] = useState<'Sponsored' | 'Advertisement'>('Sponsored');
  const [promoDestination, setPromoDestination] = useState('');
  const [promoFormat, setPromoFormat] = useState<'card' | 'spoken' | 'both'>('card');
  const [promoStatus, setPromoStatus] = useState<AdminPromotion['status']>('draft');
  const [promoSpokenText, setPromoSpokenText] = useState('');
  const [promoFreq, setPromoFreq] = useState(1);

  // Emergency Switch Form
  const [killswitchReason, setKillswitchReason] = useState('');

  const getHeaders = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getStoredAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  const fetchAdminData = async () => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    try {
      const headers = getHeaders();
      const [tasksRes, promosRes, switchRes, auditRes] = await Promise.all([
        fetch(getApiUrl('/api/admin/tasks'), { headers, credentials: 'include' }),
        fetch(getApiUrl('/api/admin/promotions'), { headers, credentials: 'include' }),
        fetch(getApiUrl('/api/admin/emergency-switch'), { headers, credentials: 'include' }),
        fetch(getApiUrl('/api/admin/audit-logs'), { headers, credentials: 'include' }),
      ]);

      if (tasksRes.status === 403 || promosRes.status === 403) {
        setError('Access denied: You must be signed in as Sathish / Admin (server-enforced role).');
        setLoading(false);
        return;
      }

      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.tasks || []);
      }
      if (promosRes.ok) {
        const data = await promosRes.json();
        setPromotions(data.promotions || []);
      }
      if (switchRes.ok) {
        const data = await switchRes.json();
        setEmergencySwitch(data.switch || { campaigns_disabled: false });
      }
      if (auditRes.ok) {
        const data = await auditRes.json();
        setAuditLogs(data.logs || []);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAdminData();
    }
  }, [isOpen]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    setError(null);
    try {
      const res = await fetch(getApiUrl('/api/admin/tasks'), {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          title: taskTitle.trim(),
          description: taskDescription.trim(),
          language: taskLanguage,
          status: taskStatus,
          link: taskLink.trim() || undefined,
          allow_participation: taskAllowParticipation,
          allow_dismiss: taskAllowDismiss,
          allow_reminder: taskAllowReminder,
          spoken_reminder_text: taskSpokenReminder.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create daily task');

      setSuccessMsg('Daily task created successfully.');
      setIsCreatingTask(false);
      setTaskTitle('');
      setTaskDescription('');
      setTaskLink('');
      setTaskSpokenReminder('');
      fetchAdminData();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err?.message || 'Task creation failed');
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, newStatus: AdminDailyTask['status']) => {
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/admin/tasks/${taskId}`), {
        method: 'PUT',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update task status');
      fetchAdminData();
    } catch (err: any) {
      setError(err?.message || 'Status update failed');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/admin/tasks/${taskId}`), {
        method: 'DELETE',
        headers: getHeaders(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete task');
      fetchAdminData();
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
    }
  };

  const handleCreatePromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoTitle.trim() || !promoDestination.trim()) return;
    setError(null);
    try {
      const res = await fetch(getApiUrl('/api/admin/promotions'), {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          title: promoTitle.trim(),
          description: promoDescription.trim(),
          label: promoLabel,
          destination_url: promoDestination.trim(),
          format: promoFormat,
          status: promoStatus,
          spoken_text: promoSpokenText.trim() || undefined,
          max_frequency_per_day: promoFreq,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create promotion');

      setSuccessMsg('Promotion created successfully.');
      setIsCreatingPromo(false);
      setPromoTitle('');
      setPromoDescription('');
      setPromoDestination('');
      setPromoSpokenText('');
      fetchAdminData();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err?.message || 'Promotion creation failed');
    }
  };

  const handleUpdatePromoStatus = async (promoId: string, newStatus: AdminPromotion['status']) => {
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/admin/promotions/${promoId}`), {
        method: 'PUT',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update promotion');
      fetchAdminData();
    } catch (err: any) {
      setError(err?.message || 'Status update failed');
    }
  };

  const handleDeletePromotion = async (promoId: string) => {
    if (!window.confirm('Delete this promotion permanently?')) return;
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/admin/promotions/${promoId}`), {
        method: 'DELETE',
        headers: getHeaders(),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete promotion');
      fetchAdminData();
    } catch (err: any) {
      setError(err?.message || 'Delete failed');
    }
  };

  const handleToggleKillswitch = async (disable: boolean) => {
    setError(null);
    try {
      const res = await fetch(getApiUrl('/api/admin/emergency-switch'), {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          disabled: disable,
          reason: killswitchReason.trim() || 'Manual founder override',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to toggle killswitch');
      setEmergencySwitch(data.switch);
      setSuccessMsg(`Emergency killswitch ${disable ? 'ACTIVATED' : 'DISENGAGED'}.`);
      fetchAdminData();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err?.message || 'Killswitch toggle failed');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-600/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="admin-title" className="text-lg font-bold text-slate-900 dark:text-white">
                  Founder Admin Panel
                </h2>
                <span className="px-2 py-0.5 text-xs font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 rounded-full border border-purple-200 dark:border-purple-800">
                  Sathish Enforced
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Server-enforced role verification • Daily Tasks • Safe Promotions • Emergency Killswitch
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            aria-label="Close Admin Panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Notifications */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl flex items-center gap-2.5 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-4 p-3 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900/60 rounded-xl flex items-center gap-2.5 text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Emergency Killswitch Warning Banner if active */}
        {emergencySwitch.campaigns_disabled && (
          <div className="mx-6 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between gap-3 text-amber-700 dark:text-amber-400">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <AlertOctagon className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>EMERGENCY KILLSWITCH ACTIVE: All public tasks and promotions are paused.</span>
            </div>
            <button
              onClick={() => setActiveTab('emergency')}
              className="text-xs font-bold underline hover:no-underline"
            >
              Manage Switch
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 bg-slate-50/50 dark:bg-slate-900/40">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 text-sm font-medium transition ${
              activeTab === 'tasks'
                ? 'border-purple-600 text-purple-600 dark:border-purple-400 dark:text-purple-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <CalendarCheck className="w-4 h-4" />
            Daily Tasks ({tasks.length})
          </button>
          <button
            onClick={() => setActiveTab('promotions')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 text-sm font-medium transition ${
              activeTab === 'promotions'
                ? 'border-purple-600 text-purple-600 dark:border-purple-400 dark:text-purple-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Megaphone className="w-4 h-4" />
            Promotions ({promotions.length})
          </button>
          <button
            onClick={() => setActiveTab('emergency')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 text-sm font-medium transition ${
              activeTab === 'emergency'
                ? 'border-amber-600 text-amber-600 dark:border-amber-400 dark:text-amber-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <AlertOctagon className="w-4 h-4" />
            Emergency Switch {emergencySwitch.campaigns_disabled ? '(ACTIVE)' : ''}
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-2 py-3 px-4 border-b-2 text-sm font-medium transition ${
              activeTab === 'audit'
                ? 'border-purple-600 text-purple-600 dark:border-purple-400 dark:text-purple-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            Audit Logs ({auditLogs.length})
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: DAILY TASKS */}
          {activeTab === 'tasks' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Daily Learning & Productivity Tasks</h3>
                  <p className="text-xs text-slate-500">Draft, publish, schedule and monitor user daily tasks.</p>
                </div>
                <button
                  onClick={() => setIsCreatingTask(!isCreatingTask)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold shadow-sm transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {isCreatingTask ? 'Cancel' : 'New Daily Task'}
                </button>
              </div>

              {/* Create Task Form */}
              {isCreatingTask && (
                <form onSubmit={handleCreateTask} className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Create Daily Task</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Title *</label>
                      <input
                        type="text"
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder="e.g. Daily Tamil Idiom Practice"
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Language</label>
                      <select
                        value={taskLanguage}
                        onChange={(e) => setTaskLanguage(e.target.value)}
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      >
                        <option value="all">All Languages</option>
                        <option value="ta">Tamil (தமிழ்)</option>
                        <option value="tanglish">Tanglish</option>
                        <option value="en">English</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Description</label>
                    <textarea
                      value={taskDescription}
                      onChange={(e) => setTaskDescription(e.target.value)}
                      placeholder="Explain what the user will achieve today..."
                      rows={2}
                      className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Safe Action Link (https:// only)</label>
                      <input
                        type="url"
                        value={taskLink}
                        onChange={(e) => setTaskLink(e.target.value)}
                        placeholder="https://example.com/daily-vocab"
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Status</label>
                      <select
                        value={taskStatus}
                        onChange={(e) => setTaskStatus(e.target.value as any)}
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      >
                        <option value="draft">Draft</option>
                        <option value="preview">Preview</option>
                        <option value="published">Published</option>
                        <option value="paused">Paused</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4 pt-2">
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={taskAllowParticipation}
                        onChange={(e) => setTaskAllowParticipation(e.target.checked)}
                        className="rounded text-purple-600 focus:ring-purple-500"
                      />
                      Allow Participation Check
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={taskAllowDismiss}
                        onChange={(e) => setTaskAllowDismiss(e.target.checked)}
                        className="rounded text-purple-600 focus:ring-purple-500"
                      />
                      Allow User Dismissal
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={taskAllowReminder}
                        onChange={(e) => setTaskAllowReminder(e.target.checked)}
                        className="rounded text-purple-600 focus:ring-purple-500"
                      />
                      Allow Spoken Reminder
                    </label>
                  </div>

                  {taskAllowReminder && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Spoken Reminder Prompt (Friend Mode reads this only if user explicitly enabled reminders)
                      </label>
                      <input
                        type="text"
                        value={taskSpokenReminder}
                        onChange={(e) => setTaskSpokenReminder(e.target.value)}
                        placeholder="Macha, ready to finish today's Tamil idiom challenge?"
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsCreatingTask(false)}
                      className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-sm"
                    >
                      Save Task
                    </button>
                  </div>
                </form>
              )}

              {/* Task List */}
              {tasks.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-xs">
                  No daily tasks created yet. Click "New Daily Task" to publish one.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-3.5 bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl flex items-start justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-700 transition"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white">{task.title}</h4>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              task.status === 'published'
                                ? 'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-400'
                                : task.status === 'paused'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {task.status.toUpperCase()}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-500">
                            {task.language.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400">{task.description}</p>
                        {task.link && (
                          <a
                            href={task.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-purple-600 dark:text-purple-400 hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {task.link}
                          </a>
                        )}
                        {task.spoken_reminder_text && (
                          <p className="text-[10px] text-purple-600 dark:text-purple-400 italic">
                            Spoken: "{task.spoken_reminder_text}"
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {task.status === 'published' ? (
                          <button
                            onClick={() => handleUpdateTaskStatus(task.id, 'paused')}
                            title="Pause task"
                            className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUpdateTaskStatus(task.id, 'published')}
                            title="Publish task"
                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/40 rounded"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleUpdateTaskStatus(task.id, 'archived')}
                          title="Archive task"
                          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTask(task.id)}
                          title="Delete task"
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PROMOTIONS */}
          {activeTab === 'promotions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Promotions & Sponsorships</h3>
                  <p className="text-xs text-slate-500">
                    Strict "Sponsored" label enforcement • Verified HTTP(S) destinations • User opt-out controls.
                  </p>
                </div>
                <button
                  onClick={() => setIsCreatingPromo(!isCreatingPromo)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold shadow-sm transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {isCreatingPromo ? 'Cancel' : 'New Promotion'}
                </button>
              </div>

              {/* Create Promotion Form */}
              {isCreatingPromo && (
                <form onSubmit={handleCreatePromotion} className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Create Promotion</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Title *</label>
                      <input
                        type="text"
                        value={promoTitle}
                        onChange={(e) => setPromoTitle(e.target.value)}
                        placeholder="e.g. Learn Spoken English with Cambridge"
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Mandatory Label *</label>
                      <select
                        value={promoLabel}
                        onChange={(e) => setPromoLabel(e.target.value as any)}
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white font-semibold"
                      >
                        <option value="Sponsored">Sponsored</option>
                        <option value="Advertisement">Advertisement</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Description</label>
                    <textarea
                      value={promoDescription}
                      onChange={(e) => setPromoDescription(e.target.value)}
                      placeholder="Clear, factual summary of the sponsored service..."
                      rows={2}
                      className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Destination URL * (Safe http:// or https:// only)
                      </label>
                      <input
                        type="url"
                        value={promoDestination}
                        onChange={(e) => setPromoDestination(e.target.value)}
                        placeholder="https://partner.example.com/course"
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Display Format</label>
                      <select
                        value={promoFormat}
                        onChange={(e) => setPromoFormat(e.target.value as any)}
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      >
                        <option value="card">Display Card Only</option>
                        <option value="spoken">Spoken Audio Only (Requires User Opt-In)</option>
                        <option value="both">Both Display Card & Spoken Audio</option>
                      </select>
                    </div>
                  </div>

                  {(promoFormat === 'spoken' || promoFormat === 'both') && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Spoken Text (Delivered strictly after completed turn; user can stop anytime)
                      </label>
                      <input
                        type="text"
                        value={promoSpokenText}
                        onChange={(e) => setPromoSpokenText(e.target.value)}
                        placeholder="Sponsored: Check out today's recommended vocabulary partner."
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Max Daily Frequency per User</label>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={promoFreq}
                        onChange={(e) => setPromoFreq(Number(e.target.value))}
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Status</label>
                      <select
                        value={promoStatus}
                        onChange={(e) => setPromoStatus(e.target.value as any)}
                        className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                      >
                        <option value="draft">Draft</option>
                        <option value="preview">Preview</option>
                        <option value="approved">Approved & Active</option>
                        <option value="paused">Paused</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsCreatingPromo(false)}
                      className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-sm"
                    >
                      Save Promotion
                    </button>
                  </div>
                </form>
              )}

              {/* Promotions List */}
              {promotions.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-xs">
                  No promotions created yet. Click "New Promotion" to configure one.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {promotions.map((promo) => (
                    <div
                      key={promo.id}
                      className="p-3.5 bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl flex items-start justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-700 transition"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] font-bold rounded border border-amber-500/20">
                            {promo.label}
                          </span>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white">{promo.title}</h4>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              promo.status === 'approved'
                                ? 'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-400'
                                : promo.status === 'paused'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {promo.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400">{promo.description}</p>
                        <a
                          href={promo.destination_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-purple-600 dark:text-purple-400 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {promo.destination_url}
                        </a>
                        {promo.spoken_text && (
                          <p className="text-[10px] text-purple-600 dark:text-purple-400 italic">
                            Spoken text: "{promo.spoken_text}"
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {promo.status === 'approved' ? (
                          <button
                            onClick={() => handleUpdatePromoStatus(promo.id, 'paused')}
                            title="Pause promotion"
                            className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUpdatePromoStatus(promo.id, 'approved')}
                            title="Approve & Activate"
                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/40 rounded"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleUpdatePromoStatus(promo.id, 'archived')}
                          title="Archive promotion"
                          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeletePromotion(promo.id)}
                          title="Delete promotion"
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: EMERGENCY KILLSWITCH */}
          {activeTab === 'emergency' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-xl space-y-3">
                <div className="flex items-center gap-2.5">
                  <AlertOctagon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Emergency Feature & Campaign Killswitch</h3>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  This narrow-scoped safety mechanism allows Sathish to immediately disable all active public daily tasks
                  and promotional broadcasts in case of misconfiguration, provider error, or content anomalies. It does NOT
                  grant remote code execution or expose private user chats.
                </p>

                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Current Status:{' '}
                      <span
                        className={
                          emergencySwitch.campaigns_disabled
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-green-600 dark:text-green-400'
                        }
                      >
                        {emergencySwitch.campaigns_disabled ? 'ENGAGED (CAMPAIGNS DISABLED)' : 'NORMAL OPERATION'}
                      </span>
                    </div>
                    {emergencySwitch.toggled_at && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Last toggled by {emergencySwitch.toggled_by} at{' '}
                        {new Date(emergencySwitch.toggled_at).toLocaleString()}
                        {emergencySwitch.reason && ` • Reason: "${emergencySwitch.reason}"`}
                      </div>
                    )}
                  </div>

                  <div>
                    {emergencySwitch.campaigns_disabled ? (
                      <button
                        onClick={() => handleToggleKillswitch(false)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg shadow-sm"
                      >
                        Disengage Switch (Resume Normal)
                      </button>
                    ) : (
                      <button
                        onClick={() => handleToggleKillswitch(true)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm"
                      >
                        Engage Killswitch (Halt All)
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Audit Reason for Switch State Change
                  </label>
                  <input
                    type="text"
                    value={killswitchReason}
                    onChange={(e) => setKillswitchReason(e.target.value)}
                    placeholder="e.g. Investigation of partner destination URL issue"
                    className="w-full text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: AUDIT LOGS */}
          {activeTab === 'audit' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Admin Audit Log</h3>
                  <p className="text-xs text-slate-500">
                    Immutable event records with actor, action, target and timestamp. Private chat content is never stored here.
                  </p>
                </div>
                <button
                  onClick={fetchAdminData}
                  className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 hover:underline"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
              </div>

              {auditLogs.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-xs">
                  No audit events recorded yet.
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="p-2.5 font-semibold">Timestamp</th>
                        <th className="p-2.5 font-semibold">Actor</th>
                        <th className="p-2.5 font-semibold">Action</th>
                        <th className="p-2.5 font-semibold">Target Type</th>
                        <th className="p-2.5 font-semibold">Target ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="p-2.5 font-mono text-[11px] text-slate-500">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="p-2.5 font-semibold text-slate-900 dark:text-white">
                            {log.actor_email}
                          </td>
                          <td className="p-2.5 font-mono text-[11px] text-purple-600 dark:text-purple-400">
                            {log.action}
                          </td>
                          <td className="p-2.5">
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 font-medium">
                              {log.target_type}
                            </span>
                          </td>
                          <td className="p-2.5 font-mono text-[11px] text-slate-400">
                            {log.target_id.slice(0, 16)}...
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            <span>Protected endpoint: <code>/api/admin/*</code> strictly requires verified admin session.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
