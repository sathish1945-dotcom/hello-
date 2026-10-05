import React, { useState } from 'react';
import { X, Sparkles, Bell, Check, Clock, Layers } from 'lucide-react';

export interface FeatureNoticeConfig {
  title: string;
  badge?: string;
  tagline: string;
  description: string;
  highlights: string[];
  status: 'In Development' | 'Planned' | 'Private Beta';
}

interface FeatureNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  feature: FeatureNoticeConfig | null;
}

export const FeatureNoticeModal: React.FC<FeatureNoticeModalProps> = ({
  isOpen,
  onClose,
  feature,
}) => {
  const [notified, setNotified] = useState(false);

  if (!isOpen || !feature) return null;

  const handleNotifyMe = () => {
    try {
      const waitlist = JSON.parse(localStorage.getItem('hello_feature_waitlist') || '[]');
      if (!waitlist.includes(feature.title)) {
        waitlist.push(feature.title);
        localStorage.setItem('hello_feature_waitlist', JSON.stringify(waitlist));
      }
      setNotified(true);
      setTimeout(() => setNotified(false), 3000);
    } catch {
      // Ignore
    }
  };

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
        aria-label={`${feature.title} Roadmap`}
        className="w-full max-w-md max-h-[90dvh] flex flex-col bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                  {feature.title}
                </h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                  {feature.status}
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {feature.tagline}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close feature details"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4 text-xs">
          <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
            {feature.description}
          </p>

          <div className="space-y-2 p-3.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/40">
            <span className="font-semibold text-zinc-800 dark:text-zinc-200 block text-[11px] uppercase tracking-wider">
              Planned Capabilities
            </span>
            <ul className="space-y-1.5">
              {feature.highlights.map((point, index) => (
                <li key={index} className="flex items-start gap-2 text-zinc-600 dark:text-zinc-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1.5 shrink-0" />
                  <span className="leading-snug">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between gap-3 bg-zinc-50/50 dark:bg-zinc-950/50">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            Close
          </button>

          <button
            type="button"
            onClick={handleNotifyMe}
            className="px-4 py-2 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-md hover:shadow-purple-500/20 transition-all flex items-center gap-1.5 active:scale-95"
          >
            {notified ? (
              <>
                <Check className="w-3.5 h-3.5 text-white" />
                <span>You're on the list!</span>
              </>
            ) : (
              <>
                <Bell className="w-3.5 h-3.5" />
                <span>Notify Me</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
