import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { getDb } from '@/db';
import { getBranchDetail } from '@/lib/catalog';
import { getCurrentUser } from '@/lib/auth/session';
import { getSettings } from '@/lib/settings';
import { pageMetadata, breadcrumbJsonLd, appUrl } from '@/lib/seo';
import { JsonLd } from '@/components/json-ld';
import { BookingWizard } from '@/components/booking/booking-wizard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string; branch: string }> }): Promise<Metadata> {
  const { slug, branch } = await params;
  return pageMetadata({
    title: `Book an appointment — ${slug} ${branch}`,
    description: 'Choose a treatment, therapist and time, then confirm your reservation.',
    path: `/spas/${slug}/${branch}/book`,
    noIndex: true,
  });
}

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; branch: string }>;
  searchParams: Promise<{ treatment?: string; cancelled?: string }>;
}) {
  const { slug, branch: branchSlug } = await params;
  const sp = await searchParams;

  const db = await getDb();
  const detail = await getBranchDetail(db, slug, branchSlug);
  if (!detail) notFound();

  const b = detail.branch;
  const user = await getCurrentUser();
  const settings = await getSettings();

  const preselected =
    sp.treatment && detail.treatments.some((t) => t.id === sp.treatment) ? sp.treatment : null;

  const base = `/spas/${slug}/${branchSlug}`;
  const jsonLd = breadcrumbJsonLd(
    [
      { name: 'Home', path: '/' },
      { name: 'Spas', path: '/spas' },
      { name: b.provider.name, path: `/spas/${slug}` },
      { name: b.name, path: base },
      { name: 'Book', path: `${base}/book` },
    ],
    await appUrl(''),
  );

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <nav className="text-[13px] text-ink-500" aria-label="Breadcrumb">
            <Link href="/spas" className="hover:underline">
              Spas
            </Link>{' '}
            /{' '}
            <Link href={`/spas/${slug}`} className="hover:underline">
              {b.provider.name}
            </Link>{' '}
            /{' '}
            <Link href={base} className="hover:underline">
              {b.name}
            </Link>{' '}
            / Book
          </nav>
          <h1 className="mt-2 text-2xl sm:text-3xl">
            Book at {b.provider.name} — {b.name}
          </h1>
        </div>
      </div>

      {sp.cancelled && (
        <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p>Payment was cancelled — pick a time again and you can retry. Any previous hold releases automatically.</p>
          </div>
        </div>
      )}

      <BookingWizard
        providerSlug={slug}
        branch={{
          id: b.id,
          slug: b.slug,
          name: b.name,
          city: b.city,
          timezone: b.timezone,
          currency: b.currency,
          paymentMethods: b.paymentMethods,
          onlinePaymentEnabled: b.onlinePaymentEnabled,
          cancellationHours: settings['booking.cancellationHours'],
          leadTimeMinutes: b.leadTimeMinutes,
          maxAdvanceDays: b.maxAdvanceDays,
        }}
        treatments={detail.treatments.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description ?? '',
          durationMin: t.durationMin,
          price: t.price,
          category: t.category,
          requiresTherapist: t.requiresTherapist,
        }))}
        therapists={detail.therapistList.map((t) => ({
          id: t.id,
          name: t.name,
          specialties: t.specialties,
        }))}
        preselectedTreatmentId={preselected}
        user={
          user
            ? { name: user.name, email: user.email, phone: user.phone ?? '', role: user.role }
            : null
        }
        guestCheckout={settings['features.guestCheckout']}
      />
    </>
  );
}
