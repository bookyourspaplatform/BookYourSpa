'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — code stays selectable on screen */
    }
  }

  return (
    <button type="button" onClick={copy} className={buttonClasses('outline', 'sm', 'font-mono tracking-wide')}>
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      {code}
    </button>
  );
}
