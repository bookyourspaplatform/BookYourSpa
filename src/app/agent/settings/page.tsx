import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { agents } from '@/db/schema';
import { getCurrentUser } from '@/lib/auth/session';
import { pageMetadata } from '@/lib/seo';
import { Badge } from '@/components/ui/badge';
import { AgentProfileForm } from '@/components/agent/agent-profile-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: 'Agent settings', description: 'Agency profile.', path: '/agent/settings', noIndex: true });
}

const AGENT_TYPES: Record<string, string> = {
  travel_agent: 'Travel agent',
  hotel_concierge: 'Hotel concierge',
  tour_operator: 'Tour operator',
  affiliate: 'Affiliate',
  reseller: 'Reseller',
  corporate: 'Corporate',
};

export default async function AgentSettingsPage() {
  const user = (await getCurrentUser())!;
  const db = await getDb();
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, user.agent!.id) });
  if (!agent) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-500">Your agency profile and account terms.</p>
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-4">
          <h2 className="text-[16px] font-semibold">Agency profile</h2>
          <Badge tone={agent.status === 'approved' ? 'success' : agent.status === 'suspended' ? 'danger' : 'warning'}>
            {agent.status}
          </Badge>
        </div>
        <AgentProfileForm
          profile={{
            companyName: agent.companyName,
            phone: agent.phone,
            website: agent.website,
          }}
        />
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white p-5">
        <h2 className="text-[16px] font-semibold">Account</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Account type</dt>
            <dd className="font-medium">{AGENT_TYPES[agent.agentType] ?? agent.agentType}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Signed in as</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Default commission</dt>
            <dd className="font-medium">{(agent.commissionBps / 100).toFixed(1)}%</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Referral code</dt>
            <dd className="font-mono text-[13px]">{agent.referralCode}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Country</dt>
            <dd className="font-medium">{agent.country}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-500">Member since</dt>
            <dd className="font-medium">{new Date(agent.createdAt).toISOString().slice(0, 10)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
