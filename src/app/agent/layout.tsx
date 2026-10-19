import type { ReactNode } from 'react';
import {
  BookOpenText,
  Coins,
  LayoutDashboard,
  PlusCircle,
  Settings,
  Tags,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { logoutAction } from '@/lib/actions/auth';
import { DashShell, type DashNavItem } from '@/components/dash/dash-shell';

export default async function AgentLayout({ children }: { children: ReactNode }) {
  const user = await requireUser(['agent']);

  const nav: DashNavItem[] = [
    { href: '/agent', label: 'Overview', icon: <LayoutDashboard className="size-4" /> },
    { href: '/agent/new', label: 'New booking', icon: <PlusCircle className="size-4" /> },
    { href: '/agent/sales', label: 'Sales', icon: <BookOpenText className="size-4" /> },
    { href: '/agent/rates', label: 'My rates', icon: <Tags className="size-4" /> },
    { href: '/agent/settings', label: 'Settings', icon: <Settings className="size-4" /> },
  ];

  return (
    <DashShell nav={nav} title="Agent console" user={{ name: user.name }} signOut={logoutAction}>
      {children}
    </DashShell>
  );
}
