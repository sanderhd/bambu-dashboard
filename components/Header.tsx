'use client';
import Link from 'next/link';

export default function Header({ title, subtitle, active, children }: {
  title: string;
  subtitle?: string;
  active: 'dashboard' | 'settings';
  children?: React.ReactNode;
}) {
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    window.location.href = '/login';
  };
  return (
    <header>
      <h1>{title}</h1>
      {subtitle && <span className="muted">{subtitle}</span>}
      {children}
      <span className="spacer" />
      <nav className="nav">
        <Link href="/" className={active === 'dashboard' ? 'on' : ''}>Dashboard</Link>
        <Link href="/settings" className={active === 'settings' ? 'on' : ''}>Settings</Link>
        <button className="linklike" onClick={logout}>Log out</button>
      </nav>
    </header>
  );
}
