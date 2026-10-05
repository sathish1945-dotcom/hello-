import React, { useState, useEffect } from 'react';
import { X, CalendarDays, Bell, BellRing, Clock, Check, Sparkles, MessageCircle, AlertCircle } from 'lucide-react';

interface SchedulingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartChat: (prompt: string) => void;
}

interface RoutineItem {
  id: string;
  name: string;
  desc: string;
  time: string;
  enabled: boolean;
  prompt: string;
}

export const SchedulingModal: React.FC<SchedulingModalProps> = ({
  isOpen,
  onClose,
  onStartChat,
}) => {
  const [notificationPermission, setNotificationPermission] = useState<string>('default');
  const [routines, setRoutines] = useState<RoutineItem[]>([
    {
      id: 'morning',
      name: 'Morning Intentions',
      desc: 'Set top priorities, review your calendar, and focus your mindset',
      time: '09:00',
      enabled: true,
      prompt: 'Good morning! Please guide me through a 3-minute morning intention setup: top 3 goals, key calendar events, and a positive mindset focus.',
    },
    {
      id: 'midday',
      name: 'Midday Focus Check',
      desc: 'Quick progress review, energy re-calibration, and afternoon adjustment',
      time: '13:00',
      enabled: true,
      prompt: 'Midday check-in! Ask me what I have completed this morning and what my primary focus should be for this afternoon.',
    },
    {
      id: 'evening',
      name: 'Evening Reflection & Wrap-up',
      desc: 'Celebrate daily accomplishments, write down loose ends, and prepare for tomorrow',
      time: '20:30',
      enabled: false,
      prompt: 'Evening wrap-up! Please help me review what went well today, note down any unresolved tasks for tomorrow, and disconnect peacefully.',
    },
  ]);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
    }

    try {
      const stored = localStorage.getItem('hello_scheduling_routines');
      if (stored) {
        setRoutines(JSON.parse(stored));
      }
    } catch {
      // Ignore parse error
    }
  }, [isOpen]);

  const handleRequestNotification = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      alert('Browser notifications are not supported in this environment.');
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      setNotificationPermission(perm);
      if (perm === 'granted') {
        new Notification('hello👋 Notifications Active', {
          body: 'You will receive reminders for your scheduled AI check-ins.',
          icon: '/favicon.ico',
        });
      }
    } catch (err) {
      console.error('Notification permission error:', err);
    }
  };

  const handleSave = () => {
    try {
      localStorage.setItem('hello_scheduling_routines', JSON.stringify(routines));
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch {
      // Ignore
    }
  };

  const toggleRoutine = (id: string) => {
    setRoutines((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const updateRoutineTime = (id: string, time: string) => {
    setRoutines((prev) =>
      prev.map((r) => (r.id === id ? { ...r, time } : r))
    );
  };

  const handleRunNow = (routine: RoutineItem) => {
    handleSave();
    onStartChat(routine.prompt);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-center items-center p-2 sm:p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Scheduling and Routines"
        className="w-full max-w-xl max-h-[92dvh] flex flex-col bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                Daily Scheduling
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  Routines
                </span>
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Automated daily check-ins, focus prompts, and routine pacing
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Scheduling dialog"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
          {/* Notification Permission Card */}
          <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                {notificationPermission === 'granted' ? (
                  <BellRing className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Bell className="w-4 h-4 text-blue-500" />
                )}
              </div>
              <div>
                <strong className="block text-xs text-zinc-900 dark:text-zinc-100">
                  Browser Notifications
                </strong>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {notificationPermission === 'granted'
                    ? 'Enabled · You will receive check-in alerts on time'
                    : notificationPermission === 'denied'
                    ? 'Blocked by browser. Enable permissions in browser address bar.'
                    : 'Get prompted at your scheduled check-in times'}
                </span>
              </div>
            </div>

            {notificationPermission !== 'granted' && (
              <button
                type="button"
                onClick={handleRequestNotification}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs shrink-0 transition-colors"
              >
                Enable
              </button>
            )}
          </div>

          {/* Routine List */}
          <div className="space-y-2.5">
            <label className="font-semibold text-zinc-900 dark:text-zinc-100 block">
              Configured Daily Routines
            </label>

            {routines.map((routine) => (
              <div
                key={routine.id}
                className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col gap-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      id={`chk-${routine.id}`}
                      checked={routine.enabled}
                      onChange={() => toggleRoutine(routine.id)}
                      className="rounded text-amber-500 focus:ring-amber-500 mt-0.5"
                    />
                    <div>
                      <label
                        htmlFor={`chk-${routine.id}`}
                        className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 cursor-pointer block"
                      >
                        {routine.name}
                      </label>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {routine.desc}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="time"
                      aria-label={`${routine.name} time`}
                      value={routine.time}
                      disabled={!routine.enabled}
                      onChange={(e) => updateRoutineTime(routine.id, e.target.value)}
                      className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-xs font-mono disabled:opacity-40"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400 truncate max-w-[260px] sm:max-w-xs">
                    Prompt: "{routine.prompt}"
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRunNow(routine)}
                    className="px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors flex items-center gap-1 shrink-0"
                  >
                    <MessageCircle className="w-3 h-3" />
                    <span>Run Now</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between gap-3 bg-zinc-50/50 dark:bg-zinc-950/50">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {savedSuccess ? 'Preferences saved!' : 'Routines sync across your active session'}
          </span>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-md hover:shadow-amber-500/20 transition-all flex items-center gap-1.5 active:scale-95"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Save Routines</span>
          </button>
        </div>
      </div>
    </div>
  );
};
