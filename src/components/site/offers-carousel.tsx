'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Star, Ticket } from 'lucide-react';
import { CopyCode } from '@/components/site/copy-code';
import { buttonClasses } from '@/components/ui/button';

export type OfferSlide = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string | null;
  linkUrl: string;
  linkLabel: string;
  /** Where "Claim this deal" goes — normally the list of spas running this offer. */
  claimUrl?: string;
  code: string | null;
  codeHint: string;
  /** e.g. "Starts 1 Dec 2026" — shown for promotions not valid yet. */
  note?: string | null;
};

/**
 * "Offers from our spas" — auto-rotating banner. Pauses on hover/focus;
 * dots allow manual control. Degrades to a static first slide without JS.
 */
export function OffersCarousel({
  slides,
  langStrings,
}: {
  slides: OfferSlide[];
  langStrings: { claim: string; viewSpa: string; code: string; tapCopy: string };
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), 6000);
    return () => clearInterval(id);
  }, [paused, slides.length]);

  if (slides.length === 0) return null;
  const slide = slides[index]!;

  return (
    <section
      className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="relative overflow-hidden rounded-3xl bg-brand-900 text-white">
        {/* Decorative wash */}
        <div
          className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand-700/40 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 left-1/4 size-80 rounded-full bg-clay-600/25 blur-3xl"
          aria-hidden
        />

        <div className="relative grid gap-6 p-7 sm:p-10 lg:grid-cols-[1.6fr_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1 text-[12px] font-semibold uppercase tracking-wide text-amber-950">
              <Ticket className="size-3.5" />
              {slide.eyebrow}
            </span>
            {slide.eyebrow.includes('%') && (
              <span className="ml-2 inline-flex items-center gap-1 text-[13px] text-white/80">
                <Star className="size-3.5 fill-amber-400 text-amber-400" /> 4.9
              </span>
            )}
            <h3 className="mt-3 text-2xl text-white sm:text-3xl">{slide.title}</h3>
            {slide.summary && (
              <p className="mt-2 max-w-lg text-[14.5px] leading-relaxed text-white/80">{slide.summary}</p>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href={slide.claimUrl ?? slide.linkUrl} className={buttonClasses('secondary', 'md')}>
                {langStrings.claim}
              </Link>
              <Link href={slide.linkUrl} className={buttonClasses('outlineLight', 'md')}>
                {langStrings.viewSpa}
              </Link>
            </div>
          </div>

          {slide.code && (
            <div className="rounded-2xl border border-dashed border-white/40 bg-white/5 p-6 text-center">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-white/70">
                {langStrings.code}
              </p>
              <p className="mt-2 font-mono text-3xl font-bold tracking-wide text-white">{slide.code}</p>
              <p className="mt-1 text-[12.5px] text-white/60">{langStrings.tapCopy}</p>
              <div className="mt-4">
                <CopyCode code={slide.code} />
              </div>
              {slide.note && (
                <p className="mt-3 rounded-lg bg-amber-400/15 px-2 py-1 text-[12px] font-medium text-amber-200">
                  {slide.note}
                </p>
              )}
            </div>
          )}
        </div>

        {slides.length > 1 && (
          <div className="absolute bottom-4 left-7 flex items-center gap-2 sm:left-10">
            {slides.map((sl, i) => (
              <button
                key={sl.id}
                type="button"
                aria-label={`Offer ${i + 1}`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={`h-2.5 rounded-full transition-all ${
                  i === index ? 'w-6 bg-amber-400' : 'w-2.5 bg-white/40 hover:bg-white/70'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
