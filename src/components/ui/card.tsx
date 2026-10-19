import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-ink-100 bg-white shadow-[0_1px_2px_rgba(23,32,29,0.05)]',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4', className)}>
      <div>
        <h3 className="text-[15px] font-semibold text-ink-900 font-sans tracking-normal">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-ink-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...rest} />;
}
