'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveProviderProfile } from '@/lib/actions/provider';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

type Profile = {
  name: string;
  tagline: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

export function ProviderProfileForm({ profile }: { profile: Profile }) {
  const [draft, setDraft] = useState({
    name: profile.name,
    tagline: profile.tagline ?? '',
    description: profile.description ?? '',
    phone: profile.phone ?? '',
    email: profile.email ?? '',
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
      const res = await saveProviderProfile(draft);
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
      className="max-w-2xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Spa company name" required>
        {({ id }) => <Input id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} required />}
      </Field>
      <Field label="Tagline" hint="One line shown under your name in search results">
        {({ id }) => <Input id={id} value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={140} placeholder="Authentic Balinese healing since 2009" />}
      </Field>
      <Field label="About your spa" hint="Shown on your public listing — describe your philosophy, team and facilities.">
        {({ id }) => (
          <Textarea id={id} value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact phone">
          {({ id }) => <Input id={id} type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+62 …" />}
        </Field>
        <Field label="Contact email">
          {({ id }) => <Input id={id} type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} placeholder="hello@yourspa.com" />}
        </Field>
        <Field label="Website" className="sm:col-span-2">
          {({ id }) => <Input id={id} type="url" value={draft.website} onChange={(e) => set('website', e.target.value)} placeholder="https://yourspa.com" />}
        </Field>
      </div>
      <Button type="submit" size="md" loading={pending}>
        Save profile
      </Button>
    </form>
  );
}
