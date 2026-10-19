'use client';

import { Printer } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';

/** Print-friendly voucher: hide chrome via @media print in globals.css. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClasses('outline', 'md')}
      aria-label="Print voucher"
    >
      <Printer className="size-4" /> Print voucher
    </button>
  );
}
