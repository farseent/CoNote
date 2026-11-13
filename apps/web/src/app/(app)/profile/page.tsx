import type { Metadata } from 'next';
import { ProfileSections } from '@/components/profile-sections';
import { requireUser } from '@/lib/server-auth';

export const metadata: Metadata = { title: 'Profile · CoNote' };

export default async function ProfilePage() {
  await requireUser();
  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
      <ProfileSections />
    </div>
  );
}
