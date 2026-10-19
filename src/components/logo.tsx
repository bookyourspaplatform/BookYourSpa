import Link from 'next/link';
import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-5">
        <path
          d="M12 3c2.2 2.1 3.3 4.3 3.3 6.6 0 2-1 3.7-3.3 5.4-2.3-1.7-3.3-3.4-3.3-5.4C8.7 7.3 9.8 5.1 12 3Z"
          fill="currentColor"
          opacity="0.95"
        />
        <path
          d="M4.5 10.5c2.7.3 4.6 1.3 5.7 3 1 1.6 1 3.4.1 5.4-2.6-.4-4.4-1.5-5.4-3.2-.9-1.5-1-3.2-.4-5.2Zm15 0c-2.7.3-4.6 1.3-5.7 3-1 1.6-1 3.4-.1 5.4 2.6-.4 4.4-1.5 5.4-3.2.9-1.5 1-3.2.4-5.2Z"
          fill="currentColor"
          opacity="0.7"
        />
      </svg>
    </span>
  );
}

export function Logo({
  href = '/',
  className,
  onDark = false,
  size = 'md',
}: {
  href?: string;
  className?: string;
  onDark?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <Link
      href={href}
      className={cn('inline-flex items-center gap-2.5 transition-opacity hover:opacity-85', className)}
      aria-label="BookYourSpa home"
    >
      <LogoMark className={size === 'sm' ? 'size-7' : 'size-8'} />
      <span
        className={cn(
          'font-display leading-none tracking-tight',
          size === 'sm' ? 'text-[17px]' : 'text-[19px]',
          onDark ? 'text-white' : 'text-ink-900',
        )}
      >
        BookYourSpa
      </span>
    </Link>
  );
}
