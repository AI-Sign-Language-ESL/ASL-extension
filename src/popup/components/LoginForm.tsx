import React, { useState } from 'react';

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
  onSwitchToRegister: () => void;
  error: string | null;
}

export default function LoginForm({ onLogin, onSwitchToRegister, error }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onLogin(email, password);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h3 style={{ marginBottom: 12, fontSize: 15 }}>Sign In</h3>
      {error && <div className="error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 8 }}>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? <><div className="spinner" /> Signing in...</> : 'Sign In'}
        </button>
      </form>
      <div className="separator" />
      <button className="btn btn-secondary btn-sm" onClick={onSwitchToRegister}>
        Create Account
      </button>
    </div>
  );
}
