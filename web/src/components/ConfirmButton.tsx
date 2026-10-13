import { useEffect, useState, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Label shown on the second press, e.g. "Yes, end the round". */
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

/** A button that asks once more before doing something that cannot be undone. */
export function ConfirmButton({ children, confirmLabel, onConfirm, disabled, tone = 'default' }: Props) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button type="button" className="button" disabled={disabled} onClick={() => setArmed(true)}>
        {children}
      </button>
    );
  }
  return (
    <span className="confirm">
      <button
        type="button"
        className={`button ${tone === 'danger' ? 'button-danger' : 'button-primary'}`}
        disabled={disabled}
        autoFocus
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="button" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}
