'use client';
import { useState } from 'react';

const MIN = 8;

export default function LoginForm({ setup, next }: { setup: boolean; next: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && password.length < MIN) return setError(`Use at least ${MIN} characters.`);
    if (setup && password !== confirm) return setError('The passwords don\'t match.');
    setBusy(true);
    try {
      const r = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      });
      const j = await r.json();
      if (j.ok) { window.location.href = next; return; }
      setError(j.error || 'Something went wrong');
    } catch {
      setError('The dashboard server is unreachable');
    }
    setBusy(false);
  };

  return (
    <div className="auth-wrap">
      <form className="card auth" onSubmit={submit}>
        <h1>Bambu Dashboard</h1>
        <p className="muted">
          {setup ? 'Welcome! Choose a password to protect this dashboard.' : 'Enter your password to continue.'}
        </p>
        <label className="field">
          <span>{setup ? 'New password' : 'Password'}</span>
          <input type="password" autoFocus autoComplete={setup ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {setup && (
          <label className="field">
            <span>Repeat password</span>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
        )}
        {error && <div className="alert" role="alert">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'One moment…' : setup ? 'Set password' : 'Log in'}</button>
        {setup && <p className="muted small">Forgot it later? Delete <code>data/auth.json</code> on the server to set a new one.</p>}
      </form>
    </div>
  );
}
