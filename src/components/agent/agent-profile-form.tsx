'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveAgentProfile } from '@/lib/actions/agent';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

export function AgentProfileForm({
  profile,
}: {
  profile: { companyName: string; phone: string | null; website: string | null };
}) {
  const [draft, setDraft] = useState({
    companyName: profile.companyName,
    phone: profile.phone ?? '',
    website: profile.website ?? '',
  });
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function set<K extends keyof typeof draft>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const res = await saveAgentProfile(draft);
      if (res.ok) {
        toast.success('Profile saved');
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  return (
    <form
      className="max-w-lg space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Company name" required>
        {({ id }) => (
          <Input id={id} value={draft.companyName} onChange={(e) => set('companyName', e.target.value)} required />
        )}
      </Field>
      <Field label="Phone">
        {({ id }) => <Input id={id} type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+62 …" />}
      </Field>
      <Field label="Website">
        {({ id }) => <Input id={id} type="url" value={draft.website} onChange={(e) => set('website', e.target.value)} placeholder="https://youragency.com" />}
      </Field>
      <Button type="submit" size="md" loading={pending}>
        Save profile
      </Button>
    </form>
  );
}
