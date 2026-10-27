'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  Copy,
  ExternalLink,
  ImagePlus,
  Link2,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  importGoogleMaps,
  saveBranch as saveBranchAction,
  type ActionResult,
} from '@/lib/actions/provider';
import type { BranchSaveInput } from '@/lib/branch';
import { SPA_CATEGORIES, SPA_FACILITIES, SPA_TYPES } from '@/db/schema';
import { SPA_CATEGORY_LABELS, SPA_FACILITY_LABELS, SPA_TYPE_LABELS } from '@/lib/catalog';
import { MAX_BRANCH_IMAGES, fileToDataUrl, isRenderableImage } from '@/lib/image';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field, Input, inputCls } from '@/components/ui/field';
import { RichText } from '@/components/ui/rich-text';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export type BranchRow = {
  id: string;
  name: string;
  addressLine: string;
  city: string;
  region: string | null;
  country: string;
  timezone: string;
  currency: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  googleMapsUrl: string | null;
  lat: string | null;
  lng: string | null;
  tagline: string | null;
  shortDescription: string | null;
  categories: string[];
  spaTypes: string[];
  doorstepService: boolean;
  showTherapistOnline: boolean;
  agentFeeBps: number | null;
  facilities: string[];
  description: string | null;
  images: string[];
  hours: { day: number; open: string; close: string; closed: boolean }[];
  leadTimeMinutes: number;
  maxAdvanceDays: number;
  bufferMinutes: number;
  slotIntervalMinutes: number;
  onlinePaymentEnabled: boolean;
  paymentMethods: string[];
  status: string;
  treatmentCount: number;
  therapistCount: number;
};

/** Mutable editor state — nullable DB fields become empty strings in the form. */
type Draft = {
  name: string;
  addressLine: string;
  city: string;
  region: string;
  country: string;
  timezone: string;
  currency: string;
  phone: string;
  email: string;
  website: string;
  googleMapsUrl: string;
  lat: string;
  lng: string;
  tagline: string;
  shortDescription: string;
  categories: string[];
  spaTypes: string[];
  doorstepService: boolean;
  showTherapistOnline: boolean;
  /** Agent/reseller/affiliate fee as a percent string ('' = partner default). */
  agentFeePercent: string;
  facilities: string[];
  description: string;
  images: string[];
  hours: { day: number; open: string; close: string; closed: boolean }[];
  leadTimeMinutes: number;
  maxAdvanceDays: number;
  bufferMinutes: number;
  slotIntervalMinutes: number;
  onlinePaymentEnabled: boolean;
  paymentMethods: string[];
  status: string;
};

export const EMPTY_BRANCH_ROW: Draft = {
  name: '',
  addressLine: '',
  city: '',
  region: '',
  country: 'ID',
  timezone: 'Asia/Makassar',
  currency: 'IDR',
  phone: '',
  email: '',
  website: '',
  googleMapsUrl: '',
  lat: '',
  lng: '',
  tagline: '',
  shortDescription: '',
  categories: [],
  spaTypes: [],
  doorstepService: false,
  showTherapistOnline: true,
  agentFeePercent: '',
  facilities: [],
  description: '',
  images: [],
  hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    open: day === 0 ? '11:00' : '10:00',
    close: day === 0 ? '20:00' : '21:00',
    closed: false,
  })),
  leadTimeMinutes: 60,
  maxAdvanceDays: 90,
  bufferMinutes: 0,
  slotIntervalMinutes: 30,
  onlinePaymentEnabled: true,
  paymentMethods: ['stripe', 'paypal', 'razorpay', 'venue'],
  status: 'active',
};

const TIMEZONES = [
  'Asia/Makassar',
  'Asia/Denpasar',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Kolkata',
  'Europe/London',
  'UTC',
];
const CURRENCIES = ['IDR', 'AED', 'USD', 'SGD', 'THB', 'EUR', 'GBP', 'AUD'];
const COUNTRIES = ['ID', 'AE', 'SG', 'TH', 'MY', 'IN', 'GB', 'US', 'AU'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toDraft(branch: BranchRow | null): Draft {
  if (!branch) return EMPTY_BRANCH_ROW;
  return {
    ...branch,
    region: branch.region ?? '',
    phone: branch.phone ?? '',
    email: branch.email ?? '',
    website: branch.website ?? '',
    googleMapsUrl: branch.googleMapsUrl ?? '',
    lat: branch.lat ?? '',
    lng: branch.lng ?? '',
    tagline: branch.tagline ?? '',
    shortDescription: branch.shortDescription ?? '',
    description: branch.description ?? '',
    categories: branch.categories ?? [],
    spaTypes: branch.spaTypes ?? [],
    agentFeePercent: branch.agentFeeBps != null ? String(branch.agentFeeBps / 100) : '',
    facilities: branch.facilities ?? [],
    images: branch.images ?? [],
    hours: branch.hours.length ? branch.hours : EMPTY_BRANCH_ROW.hours,
  };
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-400">{title}</p>
      {hint && <p className="mt-0.5 text-[12.5px] text-ink-500">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ChipToggle({
  values,
  options,
  labels,
  onToggle,
}: {
  values: string[];
  options: readonly string[];
  labels: Record<string, string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const on = values.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            aria-pressed={on}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition',
              on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-500 hover:border-ink-300',
            )}
          >
            {labels[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}

/** Matches the server-side cap so the form can warn before a failed save. */
const MAX_BRANCH_FACILITIES = 30;

/**
 * Create/edit dialog for a single spa business (branch). Pass `branch` to edit,
 * or `null` to create. Owns its own save flow and closes itself.
 *
 * `saveBranch` swaps the server action (the admin panel passes its own action
 * with the same payload shape) and `extras` renders additional admin-only
 * fields above the footer.
 */
export function BranchEditor({
  branch,
  onClose,
  saveBranch = saveBranchAction,
  extras,
}: {
  branch: BranchRow | null;
  onClose: () => void;
  saveBranch?: (input: BranchSaveInput) => Promise<ActionResult<{ id: string }>>;
  extras?: React.ReactNode;
}) {
  const editingId = branch?.id ?? null;
  const [draft, setDraft] = useState<Draft>(() => toDraft(branch));
  const [pending, startTransition] = useTransition();
  const [importing, startImport] = useTransition();
  const [imageUrl, setImageUrl] = useState('');
  const [imageError, setImageError] = useState('');
  /** Red banner above the footer — save failures stay on this page. */
  const [saveError, setSaveError] = useState('');
  const [facilityDraft, setFacilityDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleInList<K extends keyof Draft>(key: K, value: string) {
    setDraft((d) => {
      const list = (d[key] as string[]) ?? [];
      return { ...d, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });
  }

  /** Tick-marked standard amenities plus anything the owner typed in. */
  const presetFacilities: readonly string[] = SPA_FACILITIES;
  const customFacilities = draft.facilities.filter((f) => !presetFacilities.includes(f));

  function addFacility() {
    const value = facilityDraft.trim().replace(/\s+/g, ' ');
    if (value.length < 2) {
      toast.error('Name is too short', 'Use at least 2 characters.');
      return;
    }
    if (draft.facilities.length >= MAX_BRANCH_FACILITIES) {
      toast.error('List is full', `Up to ${MAX_BRANCH_FACILITIES} amenities per spa.`);
      return;
    }
    if (draft.facilities.some((f) => f.toLowerCase() === value.toLowerCase())) {
      toast.error('Already on the list', value);
      setFacilityDraft('');
      return;
    }
    setDraft((d) => ({ ...d, facilities: [...d.facilities, value] }));
    setFacilityDraft('');
  }

  /* --------------------------- Google Maps import -------------------------- */

  function runImport() {
    const url = draft.googleMapsUrl.trim();
    if (!url) {
      toast.error('Paste a Google Maps link first');
      return;
    }
    startImport(async () => {
      const res = await importGoogleMaps(url);
      if (!res.ok) {
        toast.error('Import failed', res.error);
        return;
      }
      const d = res.data;
      setDraft((prev) => ({
        ...prev,
        lat: d.lat ?? prev.lat,
        lng: d.lng ?? prev.lng,
        // Only fill fields the owner has not filled yet — never clobber.
        name: prev.name.trim() ? prev.name : (d.name ?? prev.name),
        phone: prev.phone?.trim() ? prev.phone : (d.phone ?? prev.phone),
        email: prev.email?.trim() ? prev.email : prev.email,
        website: prev.website?.trim() ? prev.website : (d.website ?? prev.website),
        addressLine: prev.addressLine.trim() ? prev.addressLine : (d.address ?? prev.addressLine),
      }));
      const filled = [
        d.lat && d.lng ? 'coordinates' : null,
        d.name && !branch?.name ? 'name' : null,
        d.phone && !branch?.phone ? 'phone' : null,
        d.website && !branch?.website ? 'website' : null,
        d.address && !branch?.addressLine ? 'address' : null,
      ].filter(Boolean);
      toast.success(
        d.source === 'places' ? 'Imported from Google Maps' : 'Location imported from Google Maps',
        filled.length ? `Filled: ${filled.join(', ')}. Review the details below.` : 'Coordinates set — fill the details below.',
      );
    });
  }

  /* --------------------------------- save ---------------------------------- */

  function save() {
    setSaveError('');
    // Photos travel as base64 data URLs inside the action body. Too many big
    // ones push the request past the 4 MB server-action limit (and Vercel's
    // 4.5 MB cap), which used to crash the whole page to an error screen.
    const photoChars = draft.images.reduce((n, src) => n + src.length, 0);
    if (photoChars > 3_900_000) {
      setSaveError(
        `Your photos take about ${(photoChars / 1_000_000).toFixed(1)} MB of the 4 MB upload limit — ` +
          'remove one or two photos (or paste those as image links) and save again.',
      );
      return;
    }
    startTransition(async () => {
      try {
        const res = await saveBranch({
        ...(editingId ? { id: editingId } : {}),
        name: draft.name.trim(),
        addressLine: draft.addressLine.trim(),
        city: draft.city.trim(),
        region: draft.region?.trim() || null,
        country: draft.country,
        timezone: draft.timezone,
        currency: draft.currency,
        phone: draft.phone?.trim() || null,
        email: draft.email?.trim() || null,
        website: draft.website?.trim() || null,
        googleMapsUrl: draft.googleMapsUrl.trim() || null,
        lat: draft.lat?.trim() || null,
        lng: draft.lng?.trim() || null,
        tagline: draft.tagline?.trim() || null,
        shortDescription: draft.shortDescription?.trim() || null,
        categories: draft.categories as (typeof SPA_CATEGORIES)[number][],
        spaTypes: draft.spaTypes as (typeof SPA_TYPES)[number][],
        doorstepService: draft.doorstepService,
        showTherapistOnline: draft.showTherapistOnline,
        agentFeeBps:
          draft.agentFeePercent.trim() === '' || !Number.isFinite(Number(draft.agentFeePercent))
            ? null
            : Math.min(10000, Math.max(0, Math.round(Number(draft.agentFeePercent) * 100))),
        facilities: draft.facilities,
        description: draft.description?.trim() || null,
        images: draft.images.filter(isRenderableImage).slice(0, MAX_BRANCH_IMAGES),
        hours: draft.hours,
        leadTimeMinutes: Number(draft.leadTimeMinutes),
        maxAdvanceDays: Number(draft.maxAdvanceDays),
        bufferMinutes: Number(draft.bufferMinutes),
        slotIntervalMinutes: Number(draft.slotIntervalMinutes),
        onlinePaymentEnabled: draft.onlinePaymentEnabled,
        paymentMethods: draft.paymentMethods as ('stripe' | 'paypal' | 'razorpay' | 'venue')[],
        status: draft.status as 'active' | 'pending' | 'suspended',
      });
        if (res.ok) {
          toast.success(editingId ? 'Spa business updated' : 'Spa business created');
          onClose();
          router.refresh();
        } else {
          setSaveError(res.error);
        }
      } catch (err) {
        // Never let a failed action crash to the error screen: keep the modal
        // open with everything the supplier typed, and say what went wrong.
        setSaveError(
          err instanceof Error && err.message
            ? `${err.message} — nothing was lost; this page stayed open, please try again.`
            : 'Something went wrong while saving — this page stayed open, please try again.',
        );
      }
    });
  }

  /* -------------------------------- images --------------------------------- */

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImageError('');
    const room = MAX_BRANCH_IMAGES - draft.images.length;
    if (room <= 0) {
      setImageError(`Maximum ${MAX_BRANCH_IMAGES} photos.`);
      return;
    }
    try {
      const picked = Array.from(files).slice(0, room);
      const urls: string[] = [];
      // Gallery photos render small — compress harder than the default so ten
      // of them still fit inside the server-action body limit.
      for (const f of picked) urls.push(await fileToDataUrl(f, 1280, 0.72));
      setDraft((d) => ({ ...d, images: [...d.images, ...urls] }));
      if (files.length > room) setImageError(`Only ${room} more photo${room === 1 ? '' : 's'} fit — limit is ${MAX_BRANCH_IMAGES}.`);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Could not read that image.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function addImageUrl() {
    const url = imageUrl.trim();
    if (!isRenderableImage(url)) {
      setImageError('Enter an https:// image link (or data:image/…).');
      return;
    }
    if (draft.images.length >= MAX_BRANCH_IMAGES) {
      setImageError(`Maximum ${MAX_BRANCH_IMAGES} photos.`);
      return;
    }
    setDraft((d) => ({ ...d, images: [...d.images, url] }));
    setImageUrl('');
    setImageError('');
  }

  const hasCoords = Boolean(draft.lat?.trim() && draft.lng?.trim());
  const embedSrc = hasCoords
    ? `https://maps.google.com/maps?q=${encodeURIComponent(`${draft.lat},${draft.lng}`)}&z=15&output=embed`
    : null;

  return (
    <Modal
      open
      onClose={() => !pending && onClose()}
      title={editingId ? 'Edit spa business' : 'New spa business'}
      description="Everything guests see on your listing, spa card and voucher lives here."
      size="lg"
    >
      {/* ---------------------------- Google Maps ---------------------------- */}
      <Section
        title="Google Maps"
        hint="Paste your Google Maps link and import the location — coordinates, name, phone and website are filled for you. Without a link, enter lat/lng manually."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <input
              type="url"
              value={draft.googleMapsUrl ?? ''}
              onChange={(e) => set('googleMapsUrl', e.target.value)}
              placeholder="https://maps.app.goo.gl/… or google.com/maps/place/…"
              aria-label="Google Maps link"
              className={cn(inputCls(), 'pl-9')}
            />
          </div>
          <button
            type="button"
            disabled={importing}
            onClick={runImport}
            className={cn('inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-ink-800 px-4 text-sm font-medium text-white hover:bg-ink-900 disabled:opacity-60')}
          >
            {importing ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
            Import from Google Maps
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Latitude">
            {({ id }) => (
              <Input id={id} value={draft.lat ?? ''} onChange={(e) => set('lat', e.target.value)} placeholder="-8.6509166" inputMode="decimal" />
            )}
          </Field>
          <Field label="Longitude">
            {({ id }) => (
              <Input id={id} value={draft.lng ?? ''} onChange={(e) => set('lng', e.target.value)} placeholder="115.2177604" inputMode="decimal" />
            )}
          </Field>
        </div>

        {embedSrc ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-ink-100">
            <iframe
              title={`Map of ${draft.name || 'your spa'}`}
              src={embedSrc}
              loading="lazy"
              className="h-44 w-full border-0"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-ink-200 bg-sand-50 px-3.5 py-3 text-[13px] text-ink-500">
            The map preview appears here once latitude and longitude are set.
          </p>
        )}
      </Section>

      {/* ------------------------------ Identity ------------------------------ */}
      <Section title="Spa / business name">
        <Field label="Name" required>
          {({ id }) => <Input id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Dubai Marina" required />}
        </Field>
      </Section>

      <Section title="Destination">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Country" required>
            {({ id }) => (
              <select id={id} value={draft.country} onChange={(e) => set('country', e.target.value)} className={inputCls()}>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="City" required>
            {({ id }) => <Input id={id} value={draft.city} onChange={(e) => set('city', e.target.value)} placeholder="Dubai" required />}
          </Field>
          <Field label="Area / region">
            {({ id }) => <Input id={id} value={draft.region ?? ''} onChange={(e) => set('region', e.target.value)} placeholder="Dubai Marina" />}
          </Field>
        </div>
        <Field label="Street address" required className="mt-4">
          {({ id }) => <Input id={id} value={draft.addressLine} onChange={(e) => set('addressLine', e.target.value)} placeholder="Marina Plaza, Level 3" required />}
        </Field>
      </Section>

      <Section title="Time & currency">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Timezone" required>
            {({ id }) => (
              <select id={id} value={draft.timezone} onChange={(e) => set('timezone', e.target.value)} className={inputCls()}>
                {TIMEZONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Currency" required>
            {({ id }) => (
              <select id={id} value={draft.currency} onChange={(e) => set('currency', e.target.value)} className={inputCls()}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            {({ id }) => <Input id={id} value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+971 4 …" />}
          </Field>
          <Field label="Email">
            {({ id }) => <Input id={id} type="email" value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="hello@venue.com" />}
          </Field>
        </div>
        <Field label="Website" className="mt-4">
          {({ id }) => (
            <Input id={id} type="url" value={draft.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
          )}
        </Field>
      </Section>

      <Section title="Spa card" hint="Shown on your spa card in search results. The short description is also used as the SEO description (160 characters max).">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CTA / branding words">
            {({ id }) => (
              <Input id={id} value={draft.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} maxLength={140} placeholder="Hammam rituals in the heart of Marina" />
            )}
          </Field>
          <Field label="Short description">
            {({ id }) => (
              <Input
                id={id}
                value={draft.shortDescription ?? ''}
                onChange={(e) => set('shortDescription', e.target.value)}
                maxLength={160}
                placeholder="Marble hammam, snow room and eight suites…"
              />
            )}
          </Field>
        </div>
        <p className="mt-1 text-right text-[12px] tabular-nums text-ink-400">{(draft.shortDescription ?? '').length}/160</p>
      </Section>

      <Section title="Description" hint="Rich text — tell guests about the spa, the space and what makes it special.">
        <RichText
          key={editingId ?? 'new'}
          value={draft.description ?? ''}
          onChange={(html) => set('description', html)}
          placeholder="Describe your spa business…"
        />
      </Section>

      {/* ---------------------------- Booking rules --------------------------- */}
      <Section title="Booking rules">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Lead time (min)">
            {({ id }) => (
              <Input id={id} type="number" min={0} value={draft.leadTimeMinutes} onChange={(e) => set('leadTimeMinutes', Number(e.target.value))} />
            )}
          </Field>
          <Field label="Book ahead (days)">
            {({ id }) => (
              <Input id={id} type="number" min={1} value={draft.maxAdvanceDays} onChange={(e) => set('maxAdvanceDays', Number(e.target.value))} />
            )}
          </Field>
          <Field label="Buffer (min)">
            {({ id }) => (
              <Input id={id} type="number" min={0} value={draft.bufferMinutes} onChange={(e) => set('bufferMinutes', Number(e.target.value))} />
            )}
          </Field>
          <Field label="Slot step (min)">
            {({ id }) => (
              <Input id={id} type="number" min={5} value={draft.slotIntervalMinutes} onChange={(e) => set('slotIntervalMinutes', Number(e.target.value))} />
            )}
          </Field>
        </div>
      </Section>

      {/* ---------------------------- Opening hours --------------------------- */}
      <Section title="Opening hours" hint="Set one day, then copy it to the rest with a single click.">
        <div className="space-y-1.5">
          {draft.hours.map((h, i) => (
            <div key={h.day} className="flex items-center gap-2">
              <span className="w-10 text-[13px] font-medium text-ink-600">{DAY_NAMES[h.day]}</span>
              <input
                type="checkbox"
                checked={h.closed}
                onChange={(e) => {
                  const hours = [...draft.hours];
                  hours[i] = { ...h, closed: e.target.checked };
                  set('hours', hours);
                }}
                className="size-4 accent-[#20524c]"
                aria-label={`${DAY_NAMES[h.day]} closed`}
              />
              <span className="text-[12.5px] text-ink-500">closed</span>
              <input
                type="time"
                value={h.open}
                disabled={h.closed}
                onChange={(e) => {
                  const hours = [...draft.hours];
                  hours[i] = { ...h, open: e.target.value };
                  set('hours', hours);
                }}
                className={cn(inputCls(), 'h-9 w-28 disabled:opacity-40')}
                aria-label={`${DAY_NAMES[h.day]} open`}
              />
              <span className="text-ink-300">–</span>
              <input
                type="time"
                value={h.close}
                disabled={h.closed}
                onChange={(e) => {
                  const hours = [...draft.hours];
                  hours[i] = { ...h, close: e.target.value };
                  set('hours', hours);
                }}
                className={cn(inputCls(), 'h-9 w-28 disabled:opacity-40')}
                aria-label={`${DAY_NAMES[h.day]} close`}
              />
              <button
                type="button"
                title={`Copy ${DAY_NAMES[h.day]}'s hours to every other day`}
                onClick={() => {
                  const hours = draft.hours.map((d) =>
                    d.day === h.day ? d : { ...d, open: h.open, close: h.close, closed: h.closed },
                  );
                  set('hours', hours);
                }}
                className="ml-auto rounded-md p-1.5 text-ink-400 transition hover:bg-sand-100 hover:text-brand-700"
                aria-label={`Copy ${DAY_NAMES[h.day]} hours to all days`}
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* ----------------------------- Classification -------------------------- */}
      <Section title="Spa category" hint="Shown on the search bar and your spa card. Pick all that apply.">
        <ChipToggle
          values={draft.categories}
          options={SPA_CATEGORIES}
          labels={SPA_CATEGORY_LABELS}
          onToggle={(v) => toggleInList('categories', v)}
        />
      </Section>

      <Section title="Spa type" hint="Shown on the search bar and in the treatment add/edit form. Pick all that apply.">
        <ChipToggle values={draft.spaTypes} options={SPA_TYPES} labels={SPA_TYPE_LABELS} onToggle={(v) => toggleInList('spaTypes', v)} />
      </Section>

      <label className="mt-5 flex items-start gap-2.5 rounded-xl border border-ink-100 bg-sand-50 p-3.5 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={draft.doorstepService}
          onChange={(e) => set('doorstepService', e.target.checked)}
          className="mt-0.5 size-4 accent-[#20524c]"
        />
        <span>
          Accept Massage on Call / Doorstep Spa — therapists travel to the guest
          <span className="mt-0.5 block text-[12.5px] text-ink-500">Your therapists bring the table and products to the guest&apos;s home or hotel.</span>
        </span>
      </label>

      <label className="mt-3 flex items-start gap-2.5 rounded-xl border border-ink-100 bg-sand-50 p-3.5 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={draft.showTherapistOnline}
          onChange={(e) => set('showTherapistOnline', e.target.checked)}
          className="mt-0.5 size-4 accent-[#20524c]"
        />
        <span>
          Show Therapist Online
          <span className="mt-0.5 block text-[12.5px] text-ink-500">List your therapists on the spa page so guests can pick them when booking.</span>
        </span>
      </label>

      <div className="mt-3 rounded-xl border border-ink-100 bg-sand-50 p-3.5">
        <label htmlFor="agent-fee" className="text-sm text-ink-700">
          Agent / Reseller / Affiliate fee
        </label>
        <p className="mt-0.5 text-[12.5px] text-ink-500">
          Percentage of each booking paid to agents, resellers and affiliates who sell this spa. Leave empty to use each
          partner&apos;s own default rate.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="agent-fee"
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={draft.agentFeePercent}
            onChange={(e) => set('agentFeePercent', e.target.value)}
            placeholder="e.g. 12"
            className="h-10 w-28 rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
          <span className="text-sm text-ink-500">%</span>
        </div>
      </div>

      <Section
        title="Spa facilities"
        hint="Amenities guests can expect on site — tick the standard list, then add anything else this spa offers."
      >
        <ChipToggle
          values={draft.facilities}
          options={SPA_FACILITIES}
          labels={SPA_FACILITY_LABELS}
          onToggle={(v) => toggleInList('facilities', v)}
        />
        {customFacilities.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-[12px] text-ink-400">ADDED BY YOU</p>
            <ChipToggle
              values={draft.facilities}
              options={customFacilities}
              labels={{}}
              onToggle={(v) => toggleInList('facilities', v)}
            />
          </div>
        )}
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addFacility();
          }}
        >
          <input
            value={facilityDraft}
            onChange={(e) => setFacilityDraft(e.target.value)}
            maxLength={48}
            placeholder="e.g. Heated marble loungers"
            aria-label="Add another facility"
            className="h-10 w-64 rounded-xl border border-ink-200 bg-white px-3.5 text-sm outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!facilityDraft.trim() || draft.facilities.length >= MAX_BRANCH_FACILITIES}
          >
            <Plus className="size-3.5" /> Add facility
          </Button>
        </form>
        <p className="mt-1.5 text-[12.5px] text-ink-500">
          Anything not in the list above — it shows on your spa page just like the standard amenities.
        </p>
      </Section>

      {/* -------------------------------- Images ------------------------------ */}
      <Section
        title="Photos"
        hint={`Up to ${MAX_BRANCH_IMAGES} — the first photo is your cover, the rest form the gallery.`}
      >
        {draft.images.length > 0 && (
          <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {draft.images.map((src, i) => (
              <li key={`${src.slice(0, 40)}-${i}`} className="group relative aspect-square overflow-hidden rounded-lg border border-ink-100 bg-sand-50">
                {/* eslint-disable-next-line @next/next/no-img-element -- accepts data URLs from device uploads */}
                <img src={src} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                {i === 0 && (
                  <span className="absolute left-1 top-1 rounded-full bg-brand-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">Cover</span>
                )}
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
                  {i > 0 && (
                    <button
                      type="button"
                      className="text-[11px] font-medium text-white hover:underline"
                      onClick={() =>
                        setDraft((d) => {
                          const imgs = [...d.images];
                          const [moved] = imgs.splice(i, 1);
                          return { ...d, images: [moved!, ...imgs] };
                        })
                      }
                    >
                      Make cover
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove photo ${i + 1}`}
                    className="ml-auto text-white hover:text-rose-300"
                    onClick={() => setDraft((d) => ({ ...d, images: d.images.filter((_, idx) => idx !== i) }))}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={draft.images.length >= MAX_BRANCH_IMAGES}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3.5 text-[13.5px] font-medium text-ink-700 hover:border-brand-400 disabled:opacity-50"
          >
            <Upload className="size-4" /> Upload from device
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void addFiles(e.target.files)}
            aria-label="Upload photos"
          />
          <div className="flex min-w-[16rem] flex-1 items-center gap-1.5">
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addImageUrl())}
              placeholder="…or paste an image link"
              aria-label="Image URL"
              className={cn(inputCls(), 'h-10')}
            />
            <button
              type="button"
              onClick={addImageUrl}
              disabled={draft.images.length >= MAX_BRANCH_IMAGES}
              aria-label="Add image by link"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-ink-200 bg-white text-ink-600 hover:border-brand-400 disabled:opacity-50"
            >
              <ImagePlus className="size-4" />
            </button>
          </div>
          <span className="text-[12.5px] tabular-nums text-ink-400">
            {draft.images.length}/{MAX_BRANCH_IMAGES}
          </span>
        </div>
        {imageError && <p className="mt-1.5 text-[12.5px] text-rose-600">{imageError}</p>}
      </Section>

      {/* Payments are intentionally not editable here — configured by the platform. */}

      {extras && <div className="mt-6">{extras}</div>}

      {saveError && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-[13px] font-medium leading-relaxed text-rose-700"
        >
          {saveError}
        </div>
      )}

      <div className="mt-7 flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
        <a
          href={draft.googleMapsUrl?.trim() || (hasCoords ? `https://www.google.com/maps?q=${draft.lat},${draft.lng}` : undefined)}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-brand-700',
            (!draft.googleMapsUrl?.trim() || !hasCoords) && !hasCoords && 'pointer-events-none opacity-40',
          )}
        >
          <ExternalLink className="size-3.5" /> View on Google Maps
        </a>
        <div className="flex gap-3">
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="md" onClick={save} loading={pending}>
            <Check className="size-4" /> {editingId ? 'Save changes' : 'Create spa business'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
