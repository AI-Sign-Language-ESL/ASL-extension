import React, { useState } from 'react';

interface Props {
  onRegister: (data: Record<string, string>) => Promise<void>;
  onSwitchToLogin: () => void;
  error: string | null;
}

export default function RegisterForm({ onRegister, onSwitchToLogin, error }: Props) {
  const [form, setForm] = useState({ email: '', password: '', confirm_password: '', username: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm_password) {
      return;
    }
    setLoading(true);
    try {
      await onRegister({
        email: form.email,
        password: form.password,
        username: form.username || form.email.split('@')[0],
      });
    } finally {
      setLoading(false);
    }
  };

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, fontSize: 15 }}>Create Account</h3>
      {error && <div className="error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 8 }}>
          <label className="label">Email</label>
          <input className="input" type="email" value={form.email} onChange={update('email')} required />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label className="label">Username</label>
          <input className="input" value={form.username} onChange={update('username')} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label className="label">Password</label>
          <input className="input" type="password" value={form.password} onChange={update('password')} required />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label className="label">Confirm Password</label>
          <input className="input" type="password" value={form.confirm_password} onChange={update('confirm_password')} required />
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? <><div className="spinner" /> Creating...</> : 'Create Account'}
        </button>
      </form>
      <div className="separator" />
      <button className="btn btn-secondary btn-sm" onClick={onSwitchToLogin}>
        Back to Sign In
      </button>
    </div>
  );
}
