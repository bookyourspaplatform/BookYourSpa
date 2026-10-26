'use client';

import { useState, useTransition } from 'react';
import { Leaf, X } from 'lucide-react';
import { adminGetTreatments, adminSaveTreatment, adminSetTreatmentStatus } from '@/lib/actions/admin';
import { TreatmentManager, type TreatmentRow } from '@/components/provider/treatment-manager';
import { Modal } from '@/components/ui/modal';
import { buttonClasses } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/**
 * Admin DB → Providers → "Treatments". Loads the spa's treatment menu and
 * opens it in a dialog using the supplier's own TreatmentManager, backed by
 * the admin actions — add, edit, publish treatments for any spa (the usual
 * tool for listings without an owner yet).
 */
export function AdminTreatmentsButton({ providerId, name }: { providerId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ currency: string; treatments: TreatmentRow[] } | null>(null);
  const [loading, startLoad] = useTransition();
  const toast = useToast();

  function load() {
    startLoad(async () => {
      const res = await adminGetTreatments(providerId);
      if (!res.ok) {
        toast.error('Could not load treatments', res.error);
        return;
      }
      if (!res.data) return;
      setData(res.data);
      setOpen(true);
    });
  }

  if (!open || !data) {
    return (
      <button type="button" onClick={load} disabled={loading} className={buttonClasses('outline', 'sm')}>
        <Leaf className="size-3.5" /> Treatments
      </button>
    );
  }

  return (
    <Modal
      open
      onClose={() => !loading && setOpen(false)}
      title={`Treatments — ${name}`}
      description="Same menu suppliers manage themselves; new treatments are offered at every active branch."
      size="xl"
    >
      <TreatmentManager
        treatments={data.treatments}
        currency={data.currency}
        save={(input) => adminSaveTreatment({ providerId, ...input })}
        toggleStatus={(treatmentId, status) => adminSetTreatmentStatus(providerId, treatmentId, status)}
        onChanged={load}
      />
      <div className="mt-4 flex justify-end border-t border-ink-100 pt-4">
        <button type="button" onClick={() => setOpen(false)} className={buttonClasses('ghost', 'sm')}>
          <X className="size-4" /> Close
        </button>
      </div>
    </Modal>
  );
}
