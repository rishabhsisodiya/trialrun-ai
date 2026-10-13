import type { ReactNode } from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral';

export function Badge({ tone, icon, children }: { tone: BadgeTone; icon: ReactNode; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        {icon}
      </span>
      {children}
    </span>
  );
}
