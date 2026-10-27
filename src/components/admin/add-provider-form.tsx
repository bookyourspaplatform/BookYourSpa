'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { adminSaveSpa } from '@/lib/actions/admin';
import { BranchEditor } from '@/components/provider/branch-editor';
import { buttonClasses } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/field';

/**
 * Admin-only fields shown under the cloned supplier form: invite an owner to
 * the listing and publish/unpublish it. Shared by the Add and Edit buttons.
 */
export function AdminSpaExtras({
  ownerEmail,
  onOwnerEmail,
  publish,
  onPublish,
  unclaimed = false,
}: {
  ownerEmail: string;
  onOwnerEmail: (v: string) => void;
  publish: boolean;
  onPublish: (v: boolean) => void;
  unclaimed?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-ink-100 bg-sand-50 p-3.5">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">Admin</p>
        {unclaimed && (
          <p className="mt-0.5 text-[12.5px] text-ink-500">
            This listing is unclaimed — you manage everything guests see until its owner claims it.
          </p>
        )}
      </div>

      <Field
        label="Owner email"
        hint="Optional — invites this email to claim the spa from their account. You approve the claim from the claims queue."
      >
        {({ id }) => (
          <Input
            id={id}
            type="email"
            value={ownerEmail}
            onChange={(e) => onOwnerEmail(e.target.value)}
            placeholder="owner@example.com"
            maxLength={200}
          />
        )}
      </Field>

      <Checkbox
        checked={publish}
        onChange={(e) => onPublish(e.target.checked)}
        label={
          publish
            ? 'Published — visible on the site now, with a “Claim This Spa” card on its page.'
            : 'Hidden — stays off every page until you publish it (recommended for drafts).'
        }
      />
    </div>
  );
}

/**
 * Admin DB → Providers → "Add spa business". Opens the supplier's full
 * New/Edit spa business form (BranchEditor) with the admin action behind it,
 * so admins create listings with every detail the owner's own form collects.
 */
export function AddSpaButton() {
  const [open, setOpen] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [publish, setPublish] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses('outline')}>
        <Plus className="size-4" /> Add spa business
      </button>
    );
  }

  return (
    <BranchEditor
      branch={null}
      admin
      onClose={() => setOpen(false)}
      saveBranch={(input) => adminSaveSpa({ ...input, ownerEmail, publish })}
      extras={
        <AdminSpaExtras ownerEmail={ownerEmail} onOwnerEmail={setOwnerEmail} publish={publish} onPublish={setPublish} />
      }
    />
  );
}
