'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Store } from 'lucide-react';
import { setBranchStatus } from '@/lib/actions/provider';
import { BranchEditor, type BranchRow } from '@/components/provider/branch-editor';
import { Button, buttonClasses } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export type { BranchRow };

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function BranchManager({ branches }: { branches: BranchRow[] }) {
  const [editing, setEditing] = useState<BranchRow | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function toggleStatus(b: BranchRow) {
    startTransition(async () => {
      const next = b.status === 'active' ? 'suspended' : 'active';
      const res = await setBranchStatus(b.id, next);
      if (res.ok) {
        toast.success(next === 'active' ? 'Branch reactivated' : 'Branch suspended');
        router.refresh();
      } else {
        toast.error('Could not update', res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          {branches.length} location{branches.length === 1 ? '' : 's'} · each branch owns its own hours, prices and team.
        </p>
        <button type="button" onClick={() => setEditing(EMPTY_ROW)} className={buttonClasses('primary', 'md')}>
          <Plus className="size-4" /> New branch
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
          <Store className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 text-[15px] font-medium">Add your first location</p>
          <p className="mt-1 text-sm text-ink-500">Branches are what customers see and book on the marketplace.</p>
          <button type="button" onClick={() => setEditing(EMPTY_ROW)} className={buttonClasses('primary', 'md', 'mt-4')}>
            <Plus className="size-4" /> New branch
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {branches.map((b) => (
            <li key={b.id} className="rounded-3xl border border-ink-100 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/provider/branches/${b.id}`} className="group flex items-center gap-1.5 text-[16px] font-medium hover:text-brand-700">
                      {b.name}
                      <ChevronRight className="size-4 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
                    </Link>
                    <Badge tone={b.status === 'active' ? 'success' : b.status === 'suspended' ? 'danger' : 'warning'}>
                      {b.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[13.5px] text-ink-500">
                    {b.addressLine}, {b.city}
                    {b.region ? `, ${b.region}` : ''}, {b.country} · {b.timezone} · {b.currency}
                  </p>
                  <p className="mt-1 text-[13px] text-ink-400">
                    {b.treatmentCount} treatments · {b.therapistCount} therapists ·{' '}
                    {b.paymentMethods.join(', ')}
                    {!b.onlinePaymentEnabled && ' · online payments off'}
                  </p>
                  <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
                    {b.hours.slice(0, 7).map((h) => (
                      <span
                        key={h.day}
                        className={cn(
                          'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                          h.closed ? 'bg-ink-100 text-ink-400' : 'bg-brand-50 text-brand-700',
                        )}
                      >
                        {DAY_NAMES[h.day]} {h.closed ? 'closed' : `${h.open}–${h.close}`}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Link href={`/provider/branches/${b.id}`} className={buttonClasses('outline', 'sm')}>
                    Manage
                  </Link>
                  <button type="button" onClick={() => setEditing(b)} className={buttonClasses('ghost', 'sm')}>
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggleStatus(b)}
                    className={buttonClasses('ghost', 'sm', b.status === 'active' ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50')}
                  >
                    {b.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <BranchEditor key={editing.id || 'new'} branch={editing.id ? editing : null} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Placeholder row used only to open the editor in "create" mode. */
const EMPTY_ROW: BranchRow = {
  id: '',
  name: '',
  addressLine: '',
  city: '',
  region: null,
  country: 'ID',
  timezone: 'Asia/Makassar',
  currency: 'IDR',
  phone: null,
  email: null,
  description: null,
  hours: [],
  leadTimeMinutes: 60,
  maxAdvanceDays: 90,
  bufferMinutes: 0,
  slotIntervalMinutes: 30,
  onlinePaymentEnabled: true,
  paymentMethods: ['stripe', 'paypal', 'razorpay', 'venue'],
  status: 'active',
  treatmentCount: 0,
  therapistCount: 0,
};
