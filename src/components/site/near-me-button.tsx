'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Navigation } from 'lucide-react';
import { buttonClasses, type ButtonVariant, type ButtonSize } from '@/components/ui/button';

/**
 * "Spa near me" shortcut: asks for the visitor's live location, then navigates
 * to the search page with `near=lat,lng&radius=…` so results sort by distance.
 */
export function NearMeButton({
  label = 'Use my location',
  variant = 'outline',
  size = 'md',
  radiusKm = 50,
  className,
}: {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  radiusKm?: number;
  className?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'locating' | 'denied'>('idle');

  function locate() {
    if (!navigator.geolocation) {
      setStatus('denied');
      return;
    }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        router.push(`/spas?near=${latitude.toFixed(5)},${longitude.toFixed(5)}&radius=${radiusKm}`);
      },
      () => setStatus('denied'),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }

  return (
    <button
      type="button"
      onClick={locate}
      disabled={status === 'locating'}
      className={buttonClasses(variant, size, className)}
    >
      <Navigation className="size-4" />
      {status === 'locating' ? 'Locating…' : status === 'denied' ? 'Location blocked' : label}
    </button>
  );
}
