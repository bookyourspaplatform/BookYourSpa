import type { ReactNode } from 'react';
import {
  CalendarDays,
  ClipboardList,
  Clock,
  CreditCard,
  LayoutDashboard,
  Leaf,
  Package,
  Settings,
  Sparkles,
  Store,
  Users,
  Wallet,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { logoutAction } from '@/lib/actions/auth';
import { DashShell, type DashNavItem } from '@/components/dash/dash-shell';

export default async function ProviderLayout({ children }: { children: ReactNode }) {
  const user = await requireUser(['provider']);

  const nav: DashNavItem[] = [
    { href: '/provider', label: 'Overview', icon: <LayoutDashboard className="size-4" /> },
    { href: '/provider/calendar', label: 'Calendar', icon: <CalendarDays className="size-4" /> },
    { href: '/provider/bookings', label: 'Bookings', icon: <ClipboardList className="size-4" /> },
    { href: '/provider/pos', label: 'POS', icon: <CreditCard className="size-4" /> },
    { href: '/provider/branches', label: 'Spa Business', icon: <Store className="size-4" /> },
    { href: '/provider/treatments', label: 'Treatments', icon: <Leaf className="size-4" /> },
    { href: '/provider/products', label: 'Products', icon: <Package className="size-4" /> },
    { href: '/provider/promotions', label: 'Promotions', icon: <Sparkles className="size-4" /> },
    { href: '/provider/therapists', label: 'Staff', icon: <Users className="size-4" /> },
    { href: '/provider/availability', label: 'Availability', icon: <Clock className="size-4" /> },
    { href: '/provider/earnings', label: 'Earnings', icon: <Wallet className="size-4" /> },
    { href: '/provider/settings', label: 'Settings', icon: <Settings className="size-4" /> },
  ];

  return (
    <DashShell nav={nav} title="Spa console" user={{ name: user.name }} signOut={logoutAction}>
      {children}
    </DashShell>
  );
}
