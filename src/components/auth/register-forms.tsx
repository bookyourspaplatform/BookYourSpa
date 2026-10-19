'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import {
  registerAgentAction,
  registerCustomerAction,
  registerProviderAction,
  type AuthFormState,
} from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';

const COUNTRIES: [string, string][] = [
  ['ID', 'Indonesia'],
  ['AE', 'United Arab Emirates'],
  ['SG', 'Singapore'],
  ['TH', 'Thailand'],
  ['MY', 'Malaysia'],
  ['IN', 'India'],
  ['AU', 'Australia'],
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
];

const AGENT_TYPES: [string, string][] = [
  ['travel_agent', 'Travel agent'],
  ['hotel_concierge', 'Hotel concierge'],
  ['tour_operator', 'Tour operator'],
  ['affiliate', 'Affiliate'],
  ['reseller', 'Reseller'],
];

function FormError({ state }: { state: AuthFormState }) {
  if (!state?.error) return null;
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
      {state.error}
    </div>
  );
}

function PasswordHint() {
  return <p className="text-[12.5px] text-ink-500">At least 8 characters with a letter and a number.</p>;
}

export function RegisterCustomerForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(registerCustomerAction, null);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label="Full name" error={state?.fieldErrors?.name} required>
        {({ id, invalid }) => <Input id={id} name="name" autoComplete="name" placeholder="Jordan Blake" invalid={invalid} required />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" error={state?.fieldErrors?.email} required>
          {({ id, invalid }) => <Input id={id} name="email" type="email" autoComplete="email" placeholder="you@example.com" invalid={invalid} required />}
        </Field>
        <Field label="Phone (optional)" error={state?.fieldErrors?.phone}>
          {({ id, invalid }) => <Input id={id} name="phone" type="tel" autoComplete="tel" placeholder="+62 …" invalid={invalid} />}
        </Field>
      </div>
      <Field label="Password" error={state?.fieldErrors?.password} hint={<PasswordHint />} required>
        {({ id, invalid }) => <Input id={id} name="password" type="password" autoComplete="new-password" placeholder="••••••••" invalid={invalid} required />}
      </Field>
      <FormError state={state} />
      <Checkbox name="terms" required label={<>I agree to the <Link href="/terms" className="text-brand-700 underline-offset-2 hover:underline">Terms</Link> and <Link href="/privacy" className="text-brand-700 underline-offset-2 hover:underline">Privacy Policy</Link>.</>} />
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Create account
      </Button>
    </form>
  );
}

export function RegisterProviderForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(registerProviderAction, null);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label="Spa / company name" error={state?.fieldErrors?.companyName} required>
        {({ id, invalid }) => <Input id={id} name="companyName" placeholder="Aranjaya Spa & Wellness" invalid={invalid} required />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" error={state?.fieldErrors?.name} required>
          {({ id, invalid }) => <Input id={id} name="name" autoComplete="name" placeholder="Ayu Prameswari" invalid={invalid} required />}
        </Field>
        <Field label="Phone (optional)" error={state?.fieldErrors?.phone}>
          {({ id, invalid }) => <Input id={id} name="phone" type="tel" placeholder="+62 …" invalid={invalid} />}
        </Field>
      </div>
      <Field label="Work email" error={state?.fieldErrors?.email} required>
        {({ id, invalid }) => <Input id={id} name="email" type="email" autoComplete="email" placeholder="owner@yourspa.com" invalid={invalid} required />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Primary market" error={state?.fieldErrors?.country} required>
          {({ id, invalid }) => (
            <Select id={id} name="country" defaultValue="ID" invalid={invalid}>
              {COUNTRIES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Password" error={state?.fieldErrors?.password} required>
          {({ id, invalid }) => <Input id={id} name="password" type="password" autoComplete="new-password" placeholder="••••••••" invalid={invalid} required />}
        </Field>
      </div>
      <FormError state={state} />
      <p className="text-[13px] text-ink-500">New suppliers are reviewed by our team — you can finish your branch setup straight after signing up.</p>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Apply as a supplier
      </Button>
    </form>
  );
}

export function RegisterAgentForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(registerAgentAction, null);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Field label="Company name" error={state?.fieldErrors?.companyName} required>
        {({ id, invalid }) => <Input id={id} name="companyName" placeholder="Bali Bliss Travel" invalid={invalid} required />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" error={state?.fieldErrors?.name} required>
          {({ id, invalid }) => <Input id={id} name="name" autoComplete="name" placeholder="Sasha Rivera" invalid={invalid} required />}
        </Field>
        <Field label="Phone (optional)" error={state?.fieldErrors?.phone}>
          {({ id, invalid }) => <Input id={id} name="phone" type="tel" placeholder="+62 …" invalid={invalid} />}
        </Field>
      </div>
      <Field label="Work email" error={state?.fieldErrors?.email} required>
        {({ id, invalid }) => <Input id={id} name="email" type="email" autoComplete="email" placeholder="you@agency.com" invalid={invalid} required />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business type" error={state?.fieldErrors?.agentType} required>
          {({ id, invalid }) => (
            <Select id={id} name="agentType" defaultValue="travel_agent" invalid={invalid}>
              {AGENT_TYPES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Country" error={state?.fieldErrors?.country} required>
          {({ id, invalid }) => (
            <Select id={id} name="country" defaultValue="ID" invalid={invalid}>
              {COUNTRIES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Website (optional)" error={state?.fieldErrors?.website}>
        {({ id, invalid }) => <Input id={id} name="website" type="url" placeholder="https://…" invalid={invalid} />}
      </Field>
      <Field label="Password" error={state?.fieldErrors?.password} hint={<PasswordHint />} required>
        {({ id, invalid }) => <Input id={id} name="password" type="password" autoComplete="new-password" placeholder="••••••••" invalid={invalid} required />}
      </Field>
      <FormError state={state} />
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Apply as an agent
      </Button>
    </form>
  );
}
