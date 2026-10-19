import type { ComponentProps } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type TabItem = { value: string; label: string; count?: number };

/** Client-side state tabs (horizontal scroll on mobile). */
export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-ink-100', className)} role="tablist">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn(
              'relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors',
              active ? 'text-brand-800' : 'text-ink-500 hover:text-ink-800',
            )}
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[11px]', active ? 'bg-brand-100 text-brand-800' : 'bg-ink-100 text-ink-600')}>
                {item.count}
              </span>
            )}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-700" />}
          </button>
        );
      })}
    </div>
  );
}

/** URL-backed tabs (server-safe: plain links). */
export function TabLinks({
  items,
  activeValue,
  basePath,
  params,
  className,
}: {
  items: TabItem[];
  activeValue: string;
  basePath: string;
  params?: Record<string, string>;
  className?: string;
}) {
  return (
    <div className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-ink-100', className)}>
      {items.map((item) => {
        const active = item.value === activeValue;
        const search = new URLSearchParams({ ...(params ?? {}), tab: item.value });
        return (
          <Link
            key={item.value}
            href={`${basePath}?${search.toString()}`}
            className={cn(
              'relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors',
              active ? 'text-brand-800' : 'text-ink-500 hover:text-ink-800',
            )}
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[11px]', active ? 'bg-brand-100 text-brand-800' : 'bg-ink-100 text-ink-600')}>
                {item.count}
              </span>
            )}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-700" />}
          </Link>
        );
      })}
    </div>
  );
}

export function SegmentedControl({
  options,
  value,
  onChange,
  className,
  ...rest
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
} & Omit<ComponentProps<'div'>, 'onChange'>) {
  return (
    <div className={cn('inline-flex rounded-full border border-ink-200 bg-white p-1', className)} {...rest}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
            value === o.value ? 'bg-brand-700 text-white shadow-sm' : 'text-ink-600 hover:text-ink-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
