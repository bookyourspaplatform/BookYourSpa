import type { ReactNode } from 'react';
import {
  BadgeCheck,
  BookOpenText,
  Coins,
  FileText,
  LayoutDashboard,
  Settings,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { logoutAction } from '@/lib/actions/auth';
import { DashShell, type DashNavItem } from '@/components/dash/dash-shell';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireUser(['super_admin']);

  const nav: DashNavItem[] = [
    { href: '/admin', label: 'Overview', icon: <LayoutDashboard className="size-4" /> },
    { href: '/admin/providers', label: 'Providers', icon: <StoreIcon /> },
    { href: '/admin/agents', label: 'Agents', icon: <Users className="size-4" /> },
    { href: '/admin/bookings', label: 'Bookings', icon: <BookOpenText className="size-4" /> },
    { href: '/admin/payments', label: 'Payments', icon: <Wallet className="size-4" /> },
    { href: '/admin/commissions', label: 'Commissions', icon: <Coins className="size-4" /> },
    { href: '/admin/content', label: 'Content', icon: <FileText className="size-4" /> },
    { href: '/admin/promotions', label: 'Promotions', icon: <Sparkles className="size-4" /> },
    { href: '/admin/settings', label: 'System', icon: <Settings className="size-4" /> },
  ];

  return (
    <DashShell nav={nav} title="Super admin" user={{ name: 'Administrator' }} signOut={logoutAction}>
      {children}
    </DashShell>
  );
}

function StoreIcon() {
  return <BadgeCheck className="size-4" />;
}
