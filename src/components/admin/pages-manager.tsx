'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus2, Pencil, Trash2 } from 'lucide-react';
import { savePage, deletePage } from '@/lib/actions/admin';
import { Modal } from '@/components/ui/modal';
import { Button, buttonClasses } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

type PageRow = {
  id: string;
  slug: string;
  title: string;
  body: string;
  metaTitle: string | null;
  metaDescription: string | null;
  published: boolean;
  updatedAt: Date | string;
};

type Draft = {
  id?: string;
  slug: string;
  title: string;
  body: string;
  metaTitle: string;
  metaDescription: string;
  published: boolean;
};

const EMPTY: Draft = {
  slug: '',
  title: '',
  body: '',
  metaTitle: '',
  metaDescription: '',
  published: false,
};

export function PagesManager({ pages }: { pages: PageRow[] }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function openCreate() {
    setDraft(EMPTY);
    setOpen(true);
  }

  function openEdit(p: PageRow) {
    setDraft({
      id: p.id,
      slug: p.slug,
      title: p.title,
      body: p.body,
      metaTitle: p.metaTitle ?? '',
      metaDescription: p.metaDescription ?? '',
      published: p.published,
    });
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const res = await savePage(draft);
      if (res.ok) {
        toast.success(draft.id ? 'Page updated' : 'Page created');
        setOpen(false);
        router.refresh();
      } else {
        toast.error('Could not save', res.error);
      }
    });
  }

  function remove(id: string) {
    if (!confirm('Delete this page? The public URL will return 404.')) return;
    startTransition(async () => {
      const res = await deletePage(id);
      if (res.ok) {
        toast.success('Page deleted');
        router.refresh();
      } else {
        toast.error('Could not delete', res.error);
      }
    });
  }

  return (
    <div className="rounded-3xl border border-ink-100 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold">Static pages</h2>
          <p className="text-[13px] text-ink-500">About, contact, terms, privacy — served at /{pages[0]?.slug ?? 'your-slug'}.</p>
        </div>
        <button type="button" onClick={openCreate} className={buttonClasses('primary', 'sm')}>
          <FilePlus2 className="size-4" /> New page
        </button>
      </div>

      {pages.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13.5px] text-ink-500">No pages yet.</p>
      ) : (
        <ul className="divide-y divide-ink-50">
          {pages.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
                  {p.title}
                  <Badge tone={p.published ? 'success' : 'warning'}>{p.published ? 'published' : 'draft'}</Badge>
                </p>
                <p className="text-[13px] text-ink-500">
                  /{p.slug} · updated {new Date(p.updatedAt).toISOString().slice(0, 10)} · {p.body.length} chars
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => openEdit(p)} className={buttonClasses('outline', 'sm')}>
                  <Pencil className="size-3.5" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className={buttonClasses('ghost', 'sm', 'text-rose-600 hover:bg-rose-50')}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={draft.id ? 'Edit page' : 'New page'}
        description="Blank lines separate paragraphs. The slug becomes the URL."
        size="lg"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required>
            {({ id }) => <Input id={id} value={draft.title} onChange={(e) => set('title', e.target.value)} required />}
          </Field>
          <Field label="Slug" required>
            {({ id }) => (
              <Input
                id={id}
                value={draft.slug}
                onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}
                placeholder="about"
                required
              />
            )}
          </Field>
          <Field label="Meta title (SEO)" className="sm:col-span-2">
            {({ id }) => <Input id={id} value={draft.metaTitle} onChange={(e) => set('metaTitle', e.target.value)} maxLength={200} />}
          </Field>
          <Field label="Meta description (SEO)" className="sm:col-span-2">
            {({ id }) => <Input id={id} value={draft.metaDescription} onChange={(e) => set('metaDescription', e.target.value)} maxLength={320} />}
          </Field>
          <Field label="Body" className="sm:col-span-2" required>
            {({ id }) => (
              <Textarea
                id={id}
                value={draft.body}
                onChange={(e) => set('body', e.target.value)}
                className="min-h-52"
                required
              />
            )}
          </Field>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={draft.published} onChange={(e) => set('published', e.target.checked)} className="size-4 accent-[#20524c]" />
          Published (visible on the site and in the sitemap)
        </label>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="md" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="md" onClick={save} loading={pending}>
            {draft.id ? 'Save page' : 'Create page'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
