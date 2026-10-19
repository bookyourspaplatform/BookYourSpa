'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'error' | 'info';
type Toast = { id: number; title: string; description?: string; tone: Tone };

type ToastApi = {
  push: (t: { title: string; description?: string; tone?: Tone }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const TONE_CLS: Record<Tone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-rose-200 bg-rose-50 text-rose-900',
  info: 'border-brand-200 bg-brand-50 text-brand-900',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback<ToastApi['push']>((t) => {
    const id = ++seq.current;
    setToasts((prev) => [...prev, { id, tone: 'info', ...t }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, description) => push({ title, description, tone: 'success' }),
      error: (title, description) => push({ title, description, tone: 'error' }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[80] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-80"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto toast-in rounded-xl border px-4 py-3 text-sm shadow-lg',
              TONE_CLS[t.tone],
            )}
          >
            <p className="font-semibold">{t.title}</p>
            {t.description && <p className="mt-0.5 text-[13px] opacity-80">{t.description}</p>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
