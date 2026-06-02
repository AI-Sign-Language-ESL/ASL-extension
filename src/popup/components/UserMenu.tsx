import React from 'react';
import type { User } from '../../types';

interface Props {
  user: User | null;
  onLogout: () => void;
}

export default function UserMenu({ user, onLogout }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {user?.email?.split('@')[0] || 'User'}
      </span>
      <button className="btn btn-secondary btn-sm" onClick={onLogout} style={{ width: 'auto', padding: '4px 10px', fontSize: 11 }}>
        Logout
      </button>
    </div>
  );
}
