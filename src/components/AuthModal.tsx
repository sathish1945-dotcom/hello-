import { readApiResponse } from '../lib/api-response.ts';
import { getApiUrl, setStoredAuthToken } from '../lib/api.ts';
import { performGoogleSignIn } from '../lib/native-google-auth.ts';
import React, { useState } from 'react';
import { X, Mail, Lock, User as UserIcon, AlertCircle, ArrowRight, ShieldCheck, Check } from 'lucide-react';
import type { User } from '../types/index.ts';
import { ProviderAnimation } from './ProviderAnimation.tsx';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: User) => void;
  initialTab?: 'login' | 'register';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  initialTab = 'register',
}) => {
  const [tab, setTab] = useState<'login' | 'register'>(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = tab === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = tab === 'register' ? { email, password, name } : { email, password };

      const res = await fetch(getApiUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await readApiResponse(res);
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      if (data.token) {
        setStoredAuthToken(data.token);
      }

      onAuthSuccess(data.user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const { idToken } = await performGoogleSignIn();

      const res = await fetch(getApiUrl('/api/auth/google'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ idToken }),
      });

      const data = await readApiResponse(res);
      if (!res.ok) {
        throw new Error(data.error || 'Google sign-in failed');
      }

      if (data.token) {
        setStoredAuthToken(data.token);
      }

      onAuthSuccess(data.user);
      onClose();
    } catch (err: any) {
      if (err?.code === 'auth/unauthorized-domain') {
        setError(`Google sign-in is not enabled for ${window.location.hostname}. You can use email sign-in here. The site owner must add this hostname in Firebase Authentication → Settings → Authorized domains.`);
      } else if (err?.code === 'auth/popup-blocked') {
        setError('Your browser blocked the Google sign-in window. Allow popups for this site, then try again, or use email sign-in.');
      } else if (err?.code === 'auth/popup-closed-by-user' || err?.message?.includes('cancelled')) {
        setError('Google sign-in was cancelled. You can try again or use email sign-in.');
      } else if (err?.message?.includes('code 10') || err?.message?.includes('DEVELOPER_ERROR')) {
        setError('Google Sign-In on Android requires adding SHA-1 to Firebase Console. Alternatively, sign in using Email and Password above.');
      } else {
        setError(err.message || 'Google sign-in failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-zinc-950/70 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      {/* Onboarding Page Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="hello Onboarding"
        className="relative w-full max-w-xl min-h-screen sm:min-h-0 sm:my-auto overflow-hidden
          bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl
          rounded-none sm:rounded-3xl shadow-2xl border-0 sm:border border-zinc-200/80 dark:border-zinc-800/80
          flex flex-col transition-all duration-300"
      >
        {/* Subtle background ambient gradient */}
        <div className="absolute top-0 inset-x-0 h-40 bg-gradient-to-b from-indigo-500/10 via-purple-500/5 to-transparent pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 z-20 w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Natural Vertical Flow:
            1. AI Provider 3D visual
            2. hello branding
            3. Headline
            4. Short explanation
            5. Registration/Login form fields
            6. Google sign-in
            7. Switch tab
            8. Privacy & Terms
        */}
        <div className="p-6 sm:p-9 space-y-5 overflow-y-auto">
          {/* 1. TOP: AI Provider 3D Visual */}
          <div className="pt-2">
            <ProviderAnimation />
          </div>

          {/* 2 & 3 & 4. Branding, Headline & Explanation */}
          <div className="text-center space-y-1.5 max-w-md mx-auto">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900/50 text-blue-700 dark:text-blue-300 text-[10px] font-semibold tracking-wider uppercase mb-1">
              <ShieldCheck className="w-3 h-3" />
              <span>Multi-Provider Intelligence</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight">
              {tab === 'register' ? 'Get Started with hello' : 'Welcome Back to hello'}
            </h1>
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {tab === 'register'
                ? 'Automatic intelligent routing between premier AI models with instant failover and private session tracking.'
                : 'Sign in to seamlessly access your personal chats, custom integrations, and free AI model routing.'}
            </p>
          </div>

          {/* Value prop highlights for registration */}
          {tab === 'register' && (
            <div className="grid grid-cols-2 gap-2 max-w-md mx-auto pt-1">
              <div className="flex items-center gap-1.5 p-2 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-800/60 text-[11px] text-zinc-600 dark:text-zinc-300 font-medium">
                <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Zero configuration needed</span>
              </div>
              <div className="flex items-center gap-1.5 p-2 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/40 border border-zinc-200/60 dark:border-zinc-800/60 text-[11px] text-zinc-600 dark:text-zinc-300 font-medium">
                <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Always free models included</span>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-400 animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* 5. Registration / Login Form Fields */}
          <form onSubmit={handleSubmit} className="space-y-3.5 max-w-md mx-auto pt-1">
            {tab === 'register' && (
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 absolute left-3.5 top-3 text-zinc-400" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Sathish"
                    className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl bg-zinc-50/80 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-3 text-zinc-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl bg-zinc-50/80 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-3 text-zinc-400" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl bg-zinc-50/80 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-md shadow-blue-500/15 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{loading ? 'Please wait...' : tab === 'register' ? 'Create Account' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* 6. Google Sign-In Option */}
          <div className="space-y-3.5 max-w-md mx-auto pt-1">
            <div className="relative flex items-center justify-center">
              <div className="border-t border-zinc-200 dark:border-zinc-800 w-full" />
              <span className="bg-white dark:bg-zinc-900 px-3 text-[11px] font-medium text-zinc-400 uppercase tracking-wider absolute">
                or continue with
              </span>
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 bg-zinc-50/90 hover:bg-zinc-100 dark:bg-zinc-800/90 dark:hover:bg-zinc-700/80 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs sm:text-sm font-semibold text-zinc-800 dark:text-zinc-200 transition-all active:scale-[0.98] shadow-xs cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>

          {/* 7. Switch Tab / Login Link */}
          <div className="text-center pt-1 max-w-md mx-auto">
            {tab === 'register' ? (
              <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setTab('login');
                    setError(null);
                  }}
                  className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Sign in
                </button>
              </p>
            ) : (
              <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setTab('register');
                    setError(null);
                  }}
                  className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Create one
                </button>
              </p>
            )}
          </div>

          {/* 8. BOTTOM: Privacy & Terms and Legal Notice */}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 text-center space-y-1 max-w-md mx-auto">
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-normal">
              By continuing, you agree to hello{' '}
              <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-600 dark:hover:text-zinc-300">
                Terms
              </a>{' '}
              and{' '}
              <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-600 dark:hover:text-zinc-300">
                Privacy Policy
              </a>.
            </p>
            <p className="text-[10px] text-zinc-400/80 dark:text-zinc-500/80">
              Provider marks referenced for descriptive routing compatibility only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
