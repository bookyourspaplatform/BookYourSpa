import type { JsonLd } from '@/lib/seo';

export function JsonLd({ data, id }: { data: JsonLd | JsonLd[]; id?: string }) {
  const payload = Array.isArray(data) ? data : [data];
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return <script type="application/ld+json" id={id} dangerouslySetInnerHTML={{ __html: json }} />;
}
