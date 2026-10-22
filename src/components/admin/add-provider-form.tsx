'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { adminCreateProvider } from '@/lib/actions/admin';
import { Button, buttonClasses } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

type CountryCode = 'ID' | 'AE' | 'SG' | 'TH' | 'MY' | 'IN' | 'GB' | 'US' | 'AU';

const COUNTRIES: [CountryCode, string][] = [
  ['ID', 'Indonesia'],
  ['AE', 'United Arab Emirates'],
  ['SG', 'Singapore'],
  ['TH', 'Thailand'],
  ['MY', 'Malaysia'],
  ['IN', 'India'],
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
  ['AU', 'Australia'],
];

export function AddProviderForm() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [country, setCountry] = useState<CountryCode>('ID');
  const [tagline, setTagline] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [publish, setPublish] = useState(false);
  const router = useRouter();
  const toast = useToast();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await adminCreateProvider({ name, country, tagline, ownerEmail, publish });
      if (res.ok) {
        toast.success(
          publish ? 'Spa business published' : 'Spa business added — hidden until published',
          res.data?.invited ? `Owner invite created for ${ownerEmail.toLowerCase()}.` : undefined,
        );
        setName('');
        setTagline('');
        setOwnerEmail('');
        setPublish(false);
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses('outline')}>
        <Plus className="size-4" /> Add spa business
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="w-full space-y-4 text-left">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-medium">Add a Provider / Spa Business</h2>
          <p className="mt-0.5 text-[13px] text-ink-500">
            The listing stays unowned until its owner claims it and you approve the claim.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded-full p-2 text-ink-500 hover:bg-ink-100"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Spa business name" required>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bali Orchid Spa"
              minLength={2}
              maxLength={120}
              required
            />
          )}
        </Field>
        <Field label="Country" required>
          {({ id }) => (
            <Select id={id} value={country} onChange={(e) => setCountry(e.target.value as CountryCode)}>
              {COUNTRIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tagline" hint="Optional — shown under the spa name.">
          {({ id }) => (
            <Input
              id={id}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. Authentic Balinese wellness"
              maxLength={160}
            />
          )}
        </Field>
        <Field
          label="Owner email"
          hint="Optional — invites this email to claim the spa from their account."
        >
          {({ id }) => (
            <Input
              id={id}
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@example.com"
              maxLength={200}
            />
          )}
        </Field>
      </div>

      <Checkbox
        checked={publish}
        onChange={(e) => setPublish(e.target.checked)}
        label={
          publish
            ? 'Published — visible on the site now, with a “Claim This Spa” card on its page.'
            : 'Hidden — stays off every page until you publish it (recommended for drafts).'
        }
      />

      {error && (
        <p role="alert" className="text-[12.5px] text-rose-600">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Add spa business
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
