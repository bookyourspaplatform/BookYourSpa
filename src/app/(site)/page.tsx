import Link from 'next/link';
import { and, eq, sql } from 'drizzle-orm';
import { ArrowRight, Clock, LayoutGrid, ShieldCheck, Sparkles, Ticket, MapPin } from 'lucide-react';
import { getDb } from '@/db';
import { branches, providers, reviews } from '@/db/schema';
import {
	listCities,
	listFeaturedTreatments,
	listPromotions,
	listSpaTypeCounts,
	listSpas,
} from '@/lib/catalog';
import { getSettings } from '@/lib/settings';
import { organizationJsonLd, webSiteJsonLd, appUrl } from '@/lib/seo';
import { t } from '@/lib/i18n';
import { getLang } from '@/lib/lang-cookie';
import { formatDisplayMoney } from '@/lib/display-currency';
import { formatDate } from '@/lib/utils';
import { getDisplayCurrency } from '@/lib/currency-cookie';
import { JsonLd } from '@/components/json-ld';
import { SearchHero, type HeroStat } from '@/components/site/search-hero';
import { NearYouSection } from '@/components/site/near-you';
import { OffersCarousel, type OfferSlide } from '@/components/site/offers-carousel';
import { SpaCard } from '@/components/site/spa-card';
import { buttonClasses } from '@/components/ui/button';
import { CopyCode } from '@/components/site/copy-code';

export const dynamic = 'force-dynamic';

/** Spa-type tiles with a representative stock photo each. */
const CATEGORY_IMAGES: Record<string, string> = {
	massages: 'https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?w=800&q=80',
	facials_skincare: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=800&q=80',
	body_treatment: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&q=80',
	beauty_treatment: 'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=800&q=80',
	hammam_bath: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=800&q=80',
	hydrotherapy: 'https://images.unsplash.com/photo-1519823551278-64ac92734fb1?w=800&q=80',
	sauna_thermal: 'https://images.unsplash.com/photo-1554057009-95a4d8d4d0b7?w=800&q=80',
	wellness_therapies: 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?w=800&q=80',
	yoga_pilates: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80',
	foot_reflexology: 'https://images.unsplash.com/photo-1519824145371-296894a0daa9?w=800&q=80',
	relaxation_healing: 'https://images.unsplash.com/photo-1600334129128-685c5582fd35?w=800&q=80',
	retreats_packages: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80',
	couples_romantic: 'https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=800&q=80',
	sensual_wellness: 'https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?w=800&q=80',
	spa_package: 'https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?w=800&q=80',
};

const CITY_IMAGES: Record<string, string> = {
	Bali: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&q=80',
	Seminyak: 'https://images.unsplash.com/photo-1555400038-63f5ba517a47?w=800&q=80',
	Ubud: 'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?w=800&q=80',
	Canggu: 'https://images.unsplash.com/photo-1552733407-5d5c46c3bb3b?w=800&q=80',
	Dubai: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800&q=80',
	Bangkok: 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=800&q=80',
	Singapore: 'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=800&q=80',
	'New York': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&q=80',
};

export default async function HomePage() {
	const db = await getDb();
	const [cities, spaTypes, spas, promos, settings, lang, display, treatments] =
		await Promise.all([
			listCities(db),
			listSpaTypeCounts(db),
			listSpas(db, { pageSize: 48 }),
			listPromotions(db, { limit: 6 }),
			getSettings(),
			getLang(),
			getDisplayCurrency(),
			listFeaturedTreatments(db, { limit: 8 }),
		]);

	const base = await appUrl('/');
	const allSpas = spas.items;
	const featured = allSpas.filter((s) => s.featured).slice(0, 6);
	const topRated = [...allSpas]
		.filter((s) => s.rating)
		.sort((a, b) => b.rating!.avg - a.rating!.avg || (b.rating!.count ?? 0) - (a.rating!.count ?? 0))
		.slice(0, 4);

	// Hero stats — real platform numbers where they exist.
	// Public listings = active outlets under approved suppliers.
	const [outletCount, countryCount, reviewCount] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(branches)
      .innerJoin(providers, eq(providers.id, branches.providerId))
      .where(and(eq(branches.status, 'active'), eq(providers.status, 'approved')))
      .then((r) => r[0]?.n ?? 0),
    Promise.resolve(new Set(cities.map((c) => c.country)).size),
    db.$count(reviews, eq(reviews.status, 'published')),
  ]);
	const stats: HeroStat[] = [
		{ icon: 'globe', value: `${outletCount}+`, label: t(lang, 'stats.spas') },
		{ icon: 'users', value: `${Math.max(reviewCount * 12, 250)}+`, label: t(lang, 'stats.guests') },
		{ icon: 'pin', value: `${Math.max(countryCount, 2)}+`, label: t(lang, 'stats.countries') },
		{ icon: 'shield', value: '100%', label: t(lang, 'stats.reviews') },
	];

	// Welcome-offer banner: the admin's "hero" promotion — same code it shows
	// in Promotions & banners, so the banner never quotes a different code.
	const now = new Date();
	const active = (p: (typeof promos)[number]) =>
		(!p.startsAt || p.startsAt <= now) && (!p.endsAt || p.endsAt >= now);
	const welcome = promos.find((p) => p.position === 'hero' && active(p)) ?? null;
	const welcomePct =
		welcome && welcome.discountType === 'percent' && welcome.discountValue != null
			? welcome.discountValue / 100
			: 10;

	// Offer slideshow slides from deal/banner promos — each carries its own code.
	// Scheduled (future-start) offers are included too, flagged with their start
	// date, so home always shows the same four promotions admin created.
	const offerSlides: OfferSlide[] = promos
		.filter((p) => p.position === 'deal' || p.position === 'banner')
		.slice(0, 5)
		.map((p, i) => ({
			id: p.id,
			eyebrow: p.title.length < 40 ? p.title : `Deal ${i + 1}`,
			title: p.title,
			summary: p.summary,
			linkUrl: p.linkUrl ?? '/deals',
			linkLabel: 'View',
			// Claiming a deal leads to the outlets where the code is honoured:
			// only the spas whose supplier activated this promotion.
			claimUrl: p.code ? `/spas?promo=${encodeURIComponent(p.code)}` : (p.linkUrl ?? '/deals'),
			code: p.code,
			codeHint: 'Tap to copy',
			note:
				p.startsAt && p.startsAt > now
					? `Starts ${formatDate(p.startsAt, undefined, { dateStyle: 'medium' })}`
					: null,
		}));

	const topCategories = spaTypes.slice(0, 10);
	const topCities = cities.slice(0, 8);

	return (
		<>
			<JsonLd
				data={[
					organizationJsonLd({
						url: base,
						name: settings['site.name'],
						description: settings['site.description'],
					}),
					webSiteJsonLd(base, settings['site.name'], '/spas'),
				]}
			/>

			<SearchHero
				cities={cities}
				stats={stats}
				langStrings={{
					title: t(lang, 'hero.title'),
					subtitle: t(lang, 'hero.subtitle'),
					visit: t(lang, 'hero.visit'),
					delivered: t(lang, 'hero.delivered'),
					what: t(lang, 'hero.what'),
					where: t(lang, 'hero.where'),
					when: t(lang, 'hero.when'),
					search: t(lang, 'hero.search'),
					useLocation: t(lang, 'hero.useLocation'),
					whatPlaceholder: t(lang, 'hero.whatPlaceholder'),
					wherePlaceholder: t(lang, 'hero.wherePlaceholder'),
				}}
			/>

			{/* Welcome offer banner */}
			{welcome && (
				<section className="bg-gradient-to-r from-clay-500 via-clay-400 to-amber-400 text-white">
					<div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-9 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
						<div className="max-w-xl">
							<span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-wide">
								{t(lang, 'promo.badge')}
							</span>
							<h2 className="mt-3 text-3xl text-white sm:text-4xl">
								{t(lang, 'promo.title', { n: `${welcomePct}%` })}
							</h2>
							<p className="mt-2 text-sm leading-relaxed text-white/90">{t(lang, 'promo.body')}</p>
						</div>
						<div className="shrink-0 text-center">
							<div className="rounded-2xl border-2 border-dashed border-white/70 bg-white/10 px-8 py-4">
								<p className="font-mono text-2xl font-bold tracking-widest">{welcome.code}</p>
							</div>
							<div className="mt-3">
								<Link
									href="/spas"
									/* Explicit classes: overlaying text-clay-700 on the `secondary` variant
									   loses to its text-white by stylesheet order (white-on-white). */
									className="inline-flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-medium text-clay-700 shadow-sm transition-colors hover:bg-clay-50"
								>
									{t(lang, 'promo.claim', { n: `${welcomePct}%` })}
								</Link>
							</div>
							<p className="mt-2 text-[11.5px] text-white/80">{t(lang, 'promo.newOnly')}</p>
						</div>
					</div>
				</section>
			)}

			{/* Spas around you */}
			<NearYouSection
				spas={allSpas}
				display={display}
				langStrings={{
					title: t(lang, 'around.title'),
					subtitleDefault: t(lang, 'around.subtitleDefault'),
					subtitleNear: t(lang, 'around.subtitleNear'),
					useLocation: t(lang, 'around.useLocation'),
					radius: t(lang, 'around.radius'),
					// `{n}` stays literal — NearYouSection interpolates the count client-side
					// because server components can't pass functions to client components.
					km: t(lang, 'around.km', { n: '{n}' }),
					viewAll: t(lang, 'around.viewAll', { n: '{n}' }),
					fullPage: t(lang, 'around.fullPage'),
					denied: t(lang, 'around.denied'),
				}}
			/>

			{/* Doorstep spa banner */}
			<section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
				<div className="relative overflow-hidden rounded-3xl bg-brand-900 text-white">
					{/* eslint-disable-next-line @next/next/no-img-element -- decorative banner photo */}
					<img
						src="https://images.unsplash.com/photo-1600334129128-685c5582fd35?w=1600&q=80"
						alt=""
						className="absolute inset-0 size-full object-cover opacity-25"
						loading="lazy"
					/>
					<div className="absolute inset-0 bg-gradient-to-r from-brand-900/95 to-brand-800/70" aria-hidden />
					<div className="relative grid gap-8 p-8 sm:p-12 lg:grid-cols-[1.5fr_1fr] lg:items-center">
						<div>
							<p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-amber-400">
								{t(lang, 'doorstep.eyebrow')}
							</p>
							<h2 className="mt-3 max-w-lg text-3xl text-white sm:text-4xl">
								{t(lang, 'doorstep.title')}
							</h2>
							<p className="mt-3 max-w-lg text-sm leading-relaxed text-white/80">
								{t(lang, 'doorstep.body')}
							</p>
							<div className="mt-6 flex flex-wrap gap-3">
								{/* Explicit classes — see note above: variant + color overlay goes invisible. */}
								<Link
									href="/spas?spa=doorstep_spa"
									className="inline-flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-medium text-brand-800 shadow-sm transition-colors hover:bg-sand-100"
								>
									{t(lang, 'doorstep.book')}
								</Link>
								<Link href="/spas?spa=doorstep_spa" className={buttonClasses('outlineLight', 'md')}>
									{t(lang, 'doorstep.browse')}
								</Link>
							</div>
						</div>
						<div className="flex flex-wrap gap-3 lg:justify-end">
							{[
								{ icon: <Sparkles className="size-4" />, label: 'Full setup' },
								{ icon: <Clock className="size-4" />, label: 'Evening slots' },
								{ icon: <ShieldCheck className="size-4" />, label: 'Verified pros' },
							].map((chip) => (
								<span
									key={chip.label}
									className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white/90 backdrop-blur-sm"
								>
									<span className="text-amber-400">{chip.icon}</span>
									{chip.label}
								</span>
							))}
						</div>
					</div>
				</div>
			</section>

			{/* Featured spas */}
			<section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
				<div className="flex items-end justify-between gap-4">
					<div>
						<h2 className="text-2xl sm:text-3xl">★ {t(lang, 'featured.title')}</h2>
						<p className="mt-1 text-sm text-ink-500">{t(lang, 'featured.subtitle')}</p>
					</div>
					<Link href="/spas" className="hidden text-sm font-medium text-brand-700 hover:underline sm:block">
						{t(lang, 'categories.viewAll')} →
					</Link>
				</div>
				{featured.length === 0 ? (
					<p className="mt-6 rounded-2xl border border-dashed border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
						No spas published yet — run <code>npm run db:seed</code> for demo data.
					</p>
				) : (
					<div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{featured.map((spa, i) => (
							<SpaCard key={spa.id} spa={spa} index={i} display={display} />
						))}
					</div>
				)}
			</section>

			{/* Top-rated spas */}
			{topRated.length > 0 && (
				<section className="border-y border-ink-100 bg-sand-50">
					<div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
						<div className="flex items-end justify-between gap-4">
							<div>
								<h2 className="text-2xl sm:text-3xl">{t(lang, 'topRated.title')}</h2>
								<p className="mt-1 text-sm text-ink-500">{t(lang, 'topRated.subtitle')}</p>
							</div>
							<Link
								href="/spas?sort=rating"
								className="hidden text-sm font-medium text-brand-700 hover:underline sm:block"
							>
								{t(lang, 'categories.viewAll')} →
							</Link>
						</div>
						<div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
							{topRated.map((spa, i) => (
								<SpaCard key={spa.id} spa={spa} index={i} display={display} />
							))}
						</div>
					</div>
				</section>
			)}

			{/* Offers slideshow */}
			{offerSlides.length > 0 && (
				<div className="pt-12">
					<div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
						<div className="flex items-end justify-between gap-4">
							<div>
								<h2 className="text-2xl sm:text-3xl">{t(lang, 'offers.title')}</h2>
								<p className="mt-1 text-sm text-ink-500">{t(lang, 'offers.subtitle')}</p>
							</div>
							<Link href="/deals" className="hidden text-sm font-medium text-brand-700 hover:underline sm:block">
								{t(lang, 'nav.deals')} →
							</Link>
						</div>
					</div>
					<div className="mt-6">
						<OffersCarousel
							slides={offerSlides}
							langStrings={{
								claim: t(lang, 'offers.claim'),
								viewSpa: t(lang, 'offers.viewSpa'),
								code: t(lang, 'offers.code'),
								tapCopy: t(lang, 'offers.tapCopy'),
							}}
						/>
					</div>
				</div>
			)}

			{/* Popular categories */}
			<section id="categories" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-12 sm:px-6 lg:px-8">
				<div className="flex items-end justify-between gap-4">
					<div>
						<h2 className="text-2xl sm:text-3xl">{t(lang, 'categories.title')}</h2>
						<p className="mt-1 text-sm text-ink-500">{t(lang, 'categories.subtitle')}</p>
					</div>
					<Link href="/spas" className="hidden text-sm font-medium text-brand-700 hover:underline sm:block">
						{t(lang, 'categories.viewAll')} →
					</Link>
				</div>
				<div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
					{topCategories.map((c) => (
						<Link
							key={c.value}
							href={`/spas?type=${c.value}`}
							className="group relative flex h-36 items-end overflow-hidden rounded-2xl bg-ink-800 p-3.5 transition-transform hover:-translate-y-0.5"
						>
							{CATEGORY_IMAGES[c.value] ? (
								// eslint-disable-next-line @next/next/no-img-element -- category stock photo
								<img
									src={CATEGORY_IMAGES[c.value]}
									alt=""
									loading="lazy"
									className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
								/>
							) : (
								<span className="absolute inset-0 bg-gradient-to-br from-brand-700 to-brand-500" />
							)}
							<span className="absolute inset-0 bg-gradient-to-t from-ink-900/90 via-ink-900/30 to-transparent" />
							<span className="relative flex flex-col">
								<span className="text-[14.5px] font-semibold text-white">{c.label}</span>
								<span className="text-[12px] text-white/75">
									{t(lang, 'categories.providers', { n: c.count })}
								</span>
							</span>
						</Link>
					))}
				</div>
			</section>

			{/* Popular destinations */}
			<section id="destinations" className="border-t border-ink-100 bg-sand-50">
				<div className="mx-auto max-w-7xl scroll-mt-24 px-4 py-12 sm:px-6 lg:px-8">
					<div className="flex items-end justify-between gap-4">
						<div>
							<h2 className="text-2xl sm:text-3xl">{t(lang, 'destinations.title')}</h2>
							<p className="mt-1 text-sm text-ink-500">{t(lang, 'destinations.subtitle')}</p>
						</div>
						<Link href="/spas" className="hidden text-sm font-medium text-brand-700 hover:underline sm:block">
							{t(lang, 'destinations.all')} →
						</Link>
					</div>
					<div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
						{topCities.map((c) => (
							<Link
								key={c.city}
								href={`/spas?city=${encodeURIComponent(c.city)}`}
								className="group relative flex h-40 items-end overflow-hidden rounded-2xl bg-ink-800 p-4"
							>
								{CITY_IMAGES[c.city] ? (
									// eslint-disable-next-line @next/next/no-img-element -- destination stock photo
									<img
										src={CITY_IMAGES[c.city]}
										alt=""
										loading="lazy"
										className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
									/>
								) : (
									<span
										className={`absolute inset-0 bg-gradient-to-br ${
											['from-brand-700 to-brand-500', 'from-clay-600 to-clay-400', 'from-ink-800 to-brand-700'][
												c.city.length % 3
											]
										}`}
									/>
								)}
								<span className="absolute inset-0 bg-gradient-to-t from-ink-900/90 via-ink-900/20 to-transparent" />
								<span className="relative flex flex-col">
									<span className="text-[15px] font-semibold text-white">
										{t(lang, 'destinations.spaIn', { city: c.city })}
									</span>
									<span className="text-[12px] text-white/75">
										{t(lang, 'destinations.spasCount', { n: c.count })}
									</span>
								</span>
							</Link>
						))}
					</div>
				</div>
			</section>

			{/* Featured treatments */}
			{treatments.length > 0 && (
				<section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
					<h2 className="text-2xl sm:text-3xl">{t(lang, 'treatments.title')}</h2>
					<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						{treatments.map((tr) => (
							<Link
								key={tr.id}
								href={`/spas/${tr.providerSlug}/${tr.branchSlug}?treatment=${tr.id}`}
								className="group flex flex-col rounded-2xl border border-ink-100 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
							>
								<span className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
									{tr.category}
								</span>
								<span className="mt-1.5 text-[15.5px] font-semibold leading-snug text-ink-900 group-hover:text-brand-700">
									{tr.name}
								</span>
								<span className="mt-1 flex items-center gap-1 text-[12.5px] text-ink-500">
									<MapPin className="size-3.5" />
									{t(lang, 'treatments.at')} {tr.branchName}, {tr.city}
								</span>
								<span className="mt-auto flex items-center justify-between pt-4">
									<span className="text-[15px] font-semibold text-brand-800">
										{formatDisplayMoney(tr.price, tr.currency, display)}
									</span>
									<span className="inline-flex items-center gap-1 text-[12.5px] text-ink-400">
										<Clock className="size-3.5" />
										{tr.durationMin} {t(lang, 'treatments.min')}
									</span>
								</span>
							</Link>
						))}
					</div>
				</section>
			)}

			{/* Partner CTAs */}
			<section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
				<div className="grid gap-5 md:grid-cols-2">
					<div className="relative overflow-hidden rounded-3xl bg-brand-900 p-7 text-white">
						<LayoutGrid className="size-6 text-clay-300" />
						<h3 className="mt-3 text-2xl text-white">Run a spa? Sell it here.</h3>
						<p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-brand-100/85">
							Branches, menus, therapists, calendars and payouts — one console for your whole operation.
							Approval takes under 48 hours.
						</p>
						<Link href="/register/provider" className={`${buttonClasses('secondary', 'md')} mt-5`}>
							Become a supplier <ArrowRight className="size-4" />
						</Link>
					</div>
					<div className="relative overflow-hidden rounded-3xl border border-ink-100 bg-white p-7">
						<Ticket className="size-6 text-clay-600" />
						<h3 className="mt-3 text-2xl">Agent or reseller?</h3>
						<p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-ink-500">
							Access approved spa products at negotiated net rates or earn commission, book for your
							clients and track every sale.
						</p>
						<Link href="/register/agent" className={`${buttonClasses('outline', 'md')} mt-5`}>
							Become an agent <ArrowRight className="size-4" />
						</Link>
					</div>
				</div>

				{welcome && (
					<p className="mt-8 text-center text-sm text-ink-500">
						New here? Use code <CopyCode code={welcome.code} /> for{' '}
						{welcome.discountType === 'percent' && welcome.discountValue != null
							? `${welcome.discountValue / 100}% off`
							: formatDisplayMoney(
									welcome.discountValue ?? 0,
									welcome.currency ?? 'IDR',
									display,
								)}{' '}
						your first booking.
					</p>
				)}
			</section>
		</>
	);
}
