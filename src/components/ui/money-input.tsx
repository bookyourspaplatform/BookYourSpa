'use client';

import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { inputCls } from '@/components/ui/classes';
import { formatAmountInput, parseMoneyToMinor } from '@/lib/money';

type MoneyInputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  /** Amount in minor units — 42000 for AED 420.00. */
  value: number;
  currency: string;
  onValueChange: (minor: number) => void;
};

/**
 * Price field showing what guests see — grouped major units ("1,250.00")
 * instead of raw minor units ("125000") — while storing minor units.
 * Typing is left untouched so the caret never jumps; the field reformats
 * to the grouped form on blur.
 */
export function MoneyInput({ value, currency, onValueChange, className, ...rest }: MoneyInputProps) {
  const [text, setText] = useState(() => formatAmountInput(value, currency));
  const editing = useRef(false);

  // Follow external value changes (rows added/removed, tab switches) while idle.
  useEffect(() => {
    if (!editing.current) setText(formatAmountInput(value, currency));
  }, [value, currency]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={className ?? inputCls()}
      value={text}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.,]/g, '');
        setText(raw);
        onValueChange(parseMoneyToMinor(raw, currency));
      }}
      onBlur={() => {
        editing.current = false;
        setText(formatAmountInput(parseMoneyToMinor(text, currency), currency));
      }}
    />
  );
}
