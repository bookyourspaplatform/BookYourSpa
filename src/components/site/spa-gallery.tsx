'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn } from 'lucide-react';

const TILE_GRADIENTS = [
  'from-brand-700 via-brand-600 to-clay-500',
  'from-clay-600 via-clay-500 to-amber-400',
  'from-brand-800 via-brand-500 to-brand-300',
  'from-ink-800 via-brand-700 to-clay-400',
];

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/**
 * Spa page photo gallery: the 5-tile mosaic, with every tile clickable to
 * enlarge in a lightbox that can step through the full set of photos.
 */
export function SpaGallery({
  photos,
  name,
  gradient,
}: {
  /** Full, de-duplicated list — the mosaic shows the first 5, all are viewable. */
  photos: string[];
  name: string;
  /** Tailwind gradient classes for the no-photo fallback. */
  gradient: string;
}) {
  const [openAt, setOpenAt] = useState<number | null>(null);

  const shown = photos.slice(0, 5);
  const sidePhotos = shown.slice(1, 5);
  const extraPhotos = Math.max(0, photos.length - shown.length);

  const close = useCallback(() => setOpenAt(null), []);
  const step = useCallback(
    (delta: number) =>
      setOpenAt((cur) =>
        cur === null || photos.length === 0
          ? cur
          : (cur + delta + photos.length) % photos.length,
      ),
    [photos.length],
  );

  // Keyboard: Esc closes, arrows navigate while the lightbox is open.
  useEffect(() => {
    if (openAt === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    }
    window.addEventListener('keydown', onKey);
    // Prevent background scroll behind the modal.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [openAt, close, step]);

  return (
    <>
      <section aria-label="Photos" className="overflow-hidden rounded-3xl border border-ink-100">
        <div className="grid grid-cols-2 gap-1.5 md:h-[430px] md:grid-cols-4 md:grid-rows-2">
          <div className="relative col-span-2 h-60 md:col-span-2 md:row-span-2 md:h-auto">
            {shown[0] ? (
              <button
                type="button"
                onClick={() => setOpenAt(0)}
                className="group absolute inset-0 block cursor-zoom-in text-left"
                aria-label={`Enlarge photo 1 of ${photos.length}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- branch uploads may be data URLs */}
                <img
                  src={shown[0]}
                  alt={`${name} — photo`}
                  className="absolute inset-0 size-full object-cover"
                />
                <span className="absolute bottom-2 right-2 hidden items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11.5px] font-medium text-white transition group-hover:inline-flex">
                  <ZoomIn className="size-3.5" /> Enlarge
                </span>
              </button>
            ) : (
              <div
                className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${gradient}`}
              >
                <span className="font-display text-6xl text-white/90">{initialsOf(name)}</span>
              </div>
            )}
          </div>
          {sidePhotos.map((src, i) => {
            const index = i + 1;
            const isLast = i === sidePhotos.length - 1;
            return (
              <button
                key={src}
                type="button"
                onClick={() => setOpenAt(index)}
                className="group relative h-32 cursor-zoom-in md:h-auto"
                aria-label={`Enlarge photo ${index + 1} of ${photos.length}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- branch uploads may be data URLs */}
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                />
                <span className="absolute inset-0 bg-black/0 transition group-hover:bg-black/25" />
                {isLast && extraPhotos > 0 ? (
                  <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2.5 py-1 text-[11.5px] font-medium text-white">
                    +{extraPhotos} more photos
                  </span>
                ) : null}
              </button>
            );
          })}
          {Array.from({ length: Math.max(0, 4 - sidePhotos.length) }).map((_, i) => (
            <div
              key={`ph-${i}`}
              className={`h-32 bg-gradient-to-br opacity-90 md:h-auto ${TILE_GRADIENTS[(i + 2) % TILE_GRADIENTS.length]}`}
            />
          ))}
        </div>
      </section>

      {/* Lightbox — enlarge + step through every photo */}
      {openAt !== null && photos[openAt] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${name} photos`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={close}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/30"
          >
            <X className="size-5" />
          </button>

          {photos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              aria-label="Previous photo"
              className="absolute left-3 flex size-11 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/30 sm:left-6"
            >
              <ChevronLeft className="size-6" />
            </button>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element -- branch uploads may be data URLs */}
          <img
            src={photos[openAt]}
            alt={`${name} — photo ${openAt + 1}`}
            className="max-h-[85vh] max-w-[92vw] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {photos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              aria-label="Next photo"
              className="absolute right-3 flex size-11 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/30 sm:right-6"
            >
              <ChevronRight className="size-6" />
            </button>
          )}

          <p className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3.5 py-1.5 text-[13px] font-medium text-white tabular-nums">
            {openAt + 1} / {photos.length}
          </p>
        </div>
      )}
    </>
  );
}