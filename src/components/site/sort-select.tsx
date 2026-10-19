'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { inputCls } from '@/components/ui/classes';

const OPTIONS: [string, string][] = [
  ['featured', 'Recommended'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['name', 'Name A–Z'],
];

export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-500">
      Sort
      <select
        aria-label="Sort results"
        className={inputCls() + ' w-auto h-9 py-0 pr-8 text-[13px]'}
        value={params.get('sort') ?? 'featured'}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set('sort', e.target.value);
          next.delete('page');
          router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        }}
      >
        {OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
