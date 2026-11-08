'use client';
import Link from 'next/link';

export type Page = 'dashboard' | 'projects' | 'stats' | 'settings';

const LINKS: [Page, string, string][] = [
  ['dashboard', '/', 'Dashboard'],
  ['projects', '/projects', 'Projects'],
  ['stats', '/stats', 'Stats'],
  ['settings', '/settings', 'Settings'],
];

export default function Header({ title, subtitle, active, children }: {
  title: string;
  subtitle?: string;
  active: Page;
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
        {LINKS.map(([key, href, label]) => (
          <Link key={key} href={href} className={active === key ? 'on' : ''}>{label}</Link>
        ))}
        <button className="linklike" onClick={logout}>Log out</button>
      </nav>
    </header>
  );
}
