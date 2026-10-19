import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...rest }: ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...rest} />
    </div>
  );
}

export function Th({ className, ...rest }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'border-b border-ink-100 bg-sand-50 px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wider text-ink-500 whitespace-nowrap',
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: ComponentProps<'td'>) {
  return <td className={cn('border-b border-ink-100 px-4 py-3 align-middle text-ink-800', className)} {...rest} />;
}

export function Tr({ className, ...rest }: ComponentProps<'tr'>) {
  return <tr className={cn('hover:bg-sand-50/70 transition-colors', className)} {...rest} />;
}
