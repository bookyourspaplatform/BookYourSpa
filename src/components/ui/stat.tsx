import type { ComponentProps } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'brand' | 'clay' | 'success' | 'warning' | 'danger' | 'neutral';
  className?: string;
}) {
  const toneCls =
    tone === 'clay'
      ? 'bg-clay-50 text-clay-700'
      : tone === 'success'
        ? 'bg-emerald-50 text-emerald-700'
        : tone === 'warning'
          ? 'bg-amber-50 text-amber-700'
          : tone === 'danger'
            ? 'bg-rose-50 text-rose-700'
            : tone === 'neutral'
              ? 'bg-ink-100 text-ink-600'
              : 'bg-brand-50 text-brand-700';
  return (
    <Card className={cn('flex items-center gap-3.5 p-4', className)}>
      {icon && (
        <div className={cn('hidden size-10 shrink-0 items-center justify-center rounded-xl sm:flex', toneCls)}>
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-medium uppercase tracking-wide text-ink-500">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">{value}</p>
        {hint && <p className="mt-0.5 text-[12.5px] text-ink-500">{hint}</p>}
      </div>
    </Card>
  );
}

/** Tiny inline bar chart (no charting dependency). */
export function BarSeries({ data, className }: { data: { label: string; value: number }[]; className?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={cn('flex h-32 items-end gap-1.5', className)}>
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`} className="group flex h-full flex-1 flex-col justify-end gap-1" title={`${d.label}: ${d.value}`}>
          <div
            className="w-full rounded-t-md bg-brand-500/85 transition-all group-hover:bg-brand-700"
            style={{ height: `${Math.max(4, (d.value / max) * 100)}%` }}
          />
          <span className="truncate text-center text-[9.5px] text-ink-400">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  basePath,
  params,
  className,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  params?: Record<string, string>;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const hrefFor = (p: number) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
    }
    if (p > 1) search.set('page', String(p));
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <nav className={cn('flex items-center justify-between gap-3 border-t border-ink-100 px-4 py-3', className)} aria-label="Pagination">
      <Link
        href={hrefFor(Math.max(1, page - 1))}
        aria-disabled={page <= 1}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-ink-200 px-3.5 py-1.5 text-sm text-ink-700 hover:bg-sand-50',
          page <= 1 && 'pointer-events-none opacity-40',
        )}
      >
        <ChevronLeft className="size-4" /> Previous
      </Link>
      <span className="text-[13px] text-ink-500">
        Page {page} of {totalPages}
      </span>
      <Link
        href={hrefFor(Math.min(totalPages, page + 1))}
        aria-disabled={page >= totalPages}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-ink-200 px-3.5 py-1.5 text-sm text-ink-700 hover:bg-sand-50',
          page >= totalPages && 'pointer-events-none opacity-40',
        )}
      >
        Next <ChevronRight className="size-4" />
      </Link>
    </nav>
  );
}
