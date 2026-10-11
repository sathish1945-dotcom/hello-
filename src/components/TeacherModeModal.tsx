import React, { useState } from 'react';
import { X, GraduationCap, BookOpen, BrainCircuit, HelpCircle, Sparkles, ArrowRight, Zap } from 'lucide-react';

interface TeacherModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartChat: (prompt: string) => void;
}

export const TeacherModeModal: React.FC<TeacherModeModalProps> = ({
  isOpen,
  onClose,
  onStartChat,
}) => {
  const [topic, setTopic] = useState('');
  const [learningStyle, setLearningStyle] = useState<'step_by_step' | 'quiz' | 'eli5' | 'deep_dive'>('step_by_step');
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');

  if (!isOpen) return null;

  const quickTopics = [
    'Machine Learning & Neural Networks',
    'Python Async Programming',
    'How Modern CPU Architecture Works',
    'Financial Statements & Accounting Basics',
    'Microeconomics & Market Supply/Demand',
    'Spanish Conversation Essentials',
  ];

  const handleStart = (customTopic?: string) => {
    const subject = (customTopic || topic).trim() || 'General Learning';
    
    let styleDescription = '';
    switch (learningStyle) {
      case 'step_by_step':
        styleDescription = 'Break the topic into progressive modules with clear examples and check for understanding before advancing.';
        break;
      case 'quiz':
        styleDescription = 'Run an interactive quiz mode. Explain key concepts briefly, then quiz me with multiple-choice and conceptual questions to test my recall and understanding.';
        break;
      case 'eli5':
        styleDescription = 'Explain the concepts using plain language, real-world analogies, and zero unnecessary technical jargon (Explain Like I am 5).';
        break;
      case 'deep_dive':
        styleDescription = 'Provide an in-depth technical analysis covering internal architecture, edge cases, best practices, and underlying theory.';
        break;
    }

    const prompt = `[Teacher Mode: ${level.toUpperCase()} LEVEL - ${learningStyle.replace('_', ' ').toUpperCase()}]
I want to study: "${subject}".
Teaching Instructions:
- Target audience level: ${level}.
- Approach: ${styleDescription}
- Greet me as my personal tutor, present a brief 3-point curriculum overview for "${subject}", and ask if I'm ready to begin with Module 1.`;

    onStartChat(prompt);
    onClose();
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
        aria-label="Teacher Mode Learning Setup"
        className="w-full max-w-xl max-h-[92dvh] flex flex-col bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                Teacher Mode
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  In development
                </span>
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                AI interactive tutor and learning modules
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Teacher Mode dialog"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
          {/* Prominent In-Development Notice Banner */}
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 space-y-1">
            <div className="flex items-center gap-2 font-semibold text-xs text-amber-700 dark:text-amber-400">
              <Sparkles className="w-4 h-4" />
              <span>Feature In Active Development</span>
            </div>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
              Adaptive pacing, multi-module learning curriculums, and interactive quiz grading are currently being built for the next major release. This feature is not yet ready for production courses.
            </p>
          </div>
          {/* Topic Input */}
          <div className="space-y-1.5">
            <label htmlFor="topic-input" className="font-semibold text-zinc-900 dark:text-zinc-100 block">
              What would you like to study?
            </label>
            <input
              id="topic-input"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleStart();
              }}
              placeholder="e.g. Distributed Systems, Calculus, Quantum Physics, Marketing Funnels..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 text-xs focus:outline-hidden focus:border-blue-500 ring-0"
            />
          </div>

          {/* Quick Subjects */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              Popular subjects:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {quickTopics.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTopic(item)}
                  className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-blue-400 bg-zinc-50/50 dark:bg-zinc-900/50 text-[11px] text-zinc-700 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {/* Learning Style Grid */}
          <div className="space-y-2">
            <label className="font-semibold text-zinc-900 dark:text-zinc-100 block">
              Learning Approach
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  id: 'step_by_step',
                  icon: BookOpen,
                  title: 'Step-by-Step Curriculum',
                  desc: 'Structured modules with clear concepts & examples',
                },
                {
                  id: 'quiz',
                  icon: HelpCircle,
                  title: 'Interactive Quiz Mode',
                  desc: 'Frequent questions & active recall to test knowledge',
                },
                {
                  id: 'eli5',
                  icon: Sparkles,
                  title: 'Explain Like I\'m 5',
                  desc: 'Intuitive analogies & everyday comparisons',
                },
                {
                  id: 'deep_dive',
                  icon: BrainCircuit,
                  title: 'Deep Architectural Dive',
                  desc: 'Rigorous technical depths, benchmarks & theory',
                },
              ].map((style) => {
                const Icon = style.icon;
                const isSelected = learningStyle === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setLearningStyle(style.id as any)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-500/10 text-blue-950 dark:text-blue-100 font-medium ring-1 ring-blue-500/30'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-950/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-blue-500' : 'text-zinc-400'}`} />
                      <strong className="text-xs">{style.title}</strong>
                    </div>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
                      {style.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Difficulty Level */}
          <div className="space-y-1.5">
            <label className="font-semibold text-zinc-900 dark:text-zinc-100 block">
              Knowledge Level
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'beginner', label: 'Beginner', desc: 'No prior experience needed' },
                { id: 'intermediate', label: 'Intermediate', desc: 'Familiar with fundamentals' },
                { id: 'advanced', label: 'Advanced', desc: 'Deep mastery & nuance' },
              ].map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => setLevel(lvl.id as any)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    level === lvl.id
                      ? 'border-blue-500 bg-blue-500/10 text-blue-950 dark:text-blue-100 font-medium'
                      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-950/40'
                  }`}
                >
                  <div className="font-semibold text-xs">{lvl.label}</div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">{lvl.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-zinc-200/80 dark:border-zinc-800/80 flex items-center justify-between gap-3 bg-zinc-50/50 dark:bg-zinc-950/50">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Teacher Mode learning engine is currently in development
          </span>
          <button
            type="button"
            disabled={true}
            className="px-5 py-2 text-xs font-semibold rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 cursor-not-allowed flex items-center gap-2"
          >
            <span>In development</span>
          </button>
        </div>
      </div>
    </div>
  );
};
