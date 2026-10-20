'use client';

import { useCallback, useRef } from 'react';
import { Bold, Heading2, Heading3, Italic, Link2, List, RemoveFormatting } from 'lucide-react';
import { cn } from '@/lib/utils';

const TOOLBAR = [
  { cmd: 'bold', icon: Bold, label: 'Bold' },
  { cmd: 'italic', icon: Italic, label: 'Italic' },
  { cmd: 'h2', icon: Heading2, label: 'Heading' },
  { cmd: 'h3', icon: Heading3, label: 'Subheading' },
  { cmd: 'list', icon: List, label: 'Bullet list' },
  { cmd: 'link', icon: Link2, label: 'Link' },
  { cmd: 'clear', icon: RemoveFormatting, label: 'Clear formatting' },
] as const;

/**
 * Minimal rich-text editor for the spa description. Emits a small, known HTML
 * subset (<p>, <strong>, <em>, headings, lists, <a>) which the server re-sanitizes
 * on save. Uncontrolled by design: pass `key` to reset between branches.
 */
export function RichText({
  value,
  onChange,
  placeholder,
  minHeight = 180,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Uncontrolled: seed the DOM once (and re-seed only when the incoming HTML
  // genuinely differs — e.g. a different branch via `key`). Never re-set while
  // typing, or the caret would jump on every keystroke.
  const seed = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    if (el && el.innerHTML !== value) el.innerHTML = value;
  }, [value]);

  function exec(cmd: string) {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (cmd === 'h2' || cmd === 'h3') {
      document.execCommand('formatBlock', false, cmd === 'h2' ? '<h2>' : '<h3>');
    } else if (cmd === 'list') {
      document.execCommand('insertUnorderedList');
    } else if (cmd === 'clear') {
      document.execCommand('removeFormat');
      document.execCommand('formatBlock', false, '<p>');
    } else if (cmd === 'link') {
      const url = window.prompt('Link URL (https://…)');
      if (url && /^https?:\/\//i.test(url)) document.execCommand('createLink', false, url);
    } else if (cmd === 'bold' || cmd === 'italic') {
      document.execCommand(cmd);
    }
    onChange(ref.current?.innerHTML ?? '');
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/15">
      <div className="flex flex-wrap gap-0.5 border-b border-ink-100 px-1.5 py-1.5" role="toolbar" aria-label="Text formatting">
        {TOOLBAR.map((t) => (
          <button
            key={t.cmd}
            type="button"
            // execCommand is deprecated but is still the only dependency-free way
            // to edit a contentEditable with undo support.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(t.cmd)}
            aria-label={t.label}
            title={t.label}
            className="rounded-md p-1.5 text-ink-500 transition hover:bg-sand-100 hover:text-ink-800"
          >
            <t.icon className="size-4" />
          </button>
        ))}
      </div>
      <div
        contentEditable
        suppressContentEditableWarning
        ref={seed}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder ?? 'Description'}
        data-placeholder={placeholder ?? 'Tell guests about your spa…'}
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        className={cn(
          'prose prose-sm max-w-none px-3.5 py-3 text-[14.5px] leading-relaxed text-ink-800 outline-none',
          '[&_p]:my-1.5 [&_h2]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:my-1.5 [&_h3]:text-base [&_h3]:font-semibold',
          '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-brand-700 [&_a]:underline',
          'empty:before:text-ink-400 empty:before:content-[attr(data-placeholder)]',
        )}
        style={{ minHeight }}
      />
    </div>
  );
}
