'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateProfile } from '@/lib/actions/account';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

export function ProfileForm({ user }: { user: { name: string; email: string; phone: string | null } }) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function save() {
    startTransition(async () => {
      const res = await updateProfile({ name, phone });
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
      <Field label="Full name" required>
        {({ id }) => (
          <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        )}
      </Field>
      <Field label="Email">
        {({ id }) => <Input id={id} value={user.email} disabled />}
      </Field>
      <Field label="Phone">
        {({ id }) => (
          <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="+62 …" />
        )}
      </Field>
      <Button type="submit" size="md" loading={pending}>
        Save changes
      </Button>
    </form>
  );
}
