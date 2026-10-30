'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import { setProviderFeatured } from '@/lib/actions/admin';
import { buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * One icon flips a listing between featured and not: red star = off,
 * green star = on. It controls the "Featured" badge on the public spa card,
 * in search results and on the home page's featured rail.
 */
export function FeatureToggle({ id, featured, name }: { id: string; featured: boolean; name: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function toggle() {
    startTransition(async () => {
      const res = await setProviderFeatured(id, !featured);
      if (res.ok) {
        if (featured) toast.success('Removed from Featured', `${name} no longer shows the Featured badge.`);
        else toast.success('Now featured', `${name} shows the Featured badge across the site.`);
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={toggle}
      aria-pressed={featured}
      aria-label={featured ? `Remove ${name} from Featured` : `Feature ${name}`}
      title={featured ? 'Featured — click to switch off' : 'Not featured — click to switch on'}
      className={buttonClasses(
        'outline',
        'sm',
        featured
          ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
          : 'border-rose-300 text-rose-600 hover:bg-rose-50',
      )}
    >
      <Star className={cn('size-3.5', featured && 'fill-emerald-500 text-emerald-500')} />
    </button>
  );
}
