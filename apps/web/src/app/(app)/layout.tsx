import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { requireUser } from '@/lib/server-auth';

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </>
  );
}
