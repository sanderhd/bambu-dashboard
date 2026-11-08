import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isConfigured, SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import LoginForm from '@/components/LoginForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Log in · Bambu Dashboard' };

/** Only allow redirects to paths on this site (no "//evil.com" or "/\evil.com"). */
function safeNext(next?: string) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const jar = await cookies();
  if (verifySessionToken(jar.get(SESSION_COOKIE)?.value)) redirect(next);
  return <LoginForm setup={!isConfigured()} next={next} />;
}
