import type { Metadata } from 'next';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { Package } from 'lucide-react';
import { getDb } from '@/db';
import { branches, products } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { pageMetadata } from '@/lib/seo';
import { ProductPanel, type ProductRow } from '@/components/provider/product-panel';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Products', description: 'Retail products per branch.', path: '/provider/products', noIndex: true });
}

export default async function ProviderProductsPage() {
  const user = (await getCurrentUser())!;
  const providerId = user.provider!.id;
  const db = await getDb();

  const [branchRows, productRows] = await Promise.all([
    db.query.branches.findMany({
      where: eq(branches.providerId, providerId),
      orderBy: [branches.name],
      columns: { id: true, name: true, currency: true },
    }),
    db.query.products.findMany({
      where: eq(products.providerId, providerId),
      orderBy: [products.name],
    }),
  ]);

  const byBranch = new Map<string, ProductRow[]>();
  for (const p of productRows) {
    const row: ProductRow = {
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      currency: p.currency,
      active: p.active,
    };
    const list = byBranch.get(p.branchId) ?? [];
    list.push(row);
    byBranch.set(p.branchId, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl">Products</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Take-home products customers can add to a booking or buy at the spa — one list per branch.
        </p>
      </div>

      {branchRows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink-200 bg-white px-6 py-14 text-center">
          <Package className="mx-auto size-8 text-ink-300" />
          <p className="mt-3 text-[15px] font-medium">No spa branches yet</p>
          <p className="mt-1 text-sm text-ink-500">Add a branch first — products live on a branch.</p>
          <Link href="/provider/branches" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
            Go to Spa Business →
          </Link>
        </div>
      ) : (
        branchRows.map((b) => (
          <section key={b.id} className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold">{b.name}</h2>
              <span className="text-[13px] text-ink-500">
                {(byBranch.get(b.id)?.length ?? 0)} product{(byBranch.get(b.id)?.length ?? 0) === 1 ? '' : 's'}
              </span>
              <Link
                href={`/provider/branches/${b.id}`}
                className="ml-auto text-[13px] font-medium text-brand-700 hover:underline"
              >
                Branch settings →
              </Link>
            </div>
            <ProductPanel branchId={b.id} currency={b.currency} rows={byBranch.get(b.id) ?? []} />
          </section>
        ))
      )}
    </div>
  );
}