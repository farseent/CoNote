import { requireUser } from '@/lib/server-auth';

export default async function HomePage() {
  const user = await requireUser();
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{`Welcome, ${user.displayName}`}</h1>
      <p className="text-slate-600">
        You are signed in. Workspaces and documents are not available yet; they arrive in a later
        phase.
      </p>
    </section>
  );
}
