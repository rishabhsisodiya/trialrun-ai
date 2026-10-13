import { Clock } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

interface Props {
  endsAt: string;
  /** When the clock was stopped, if it is; the time left is then frozen. */
  heldAt: string | null;
  /** Milliseconds to add to the browser clock to get the server clock. */
  clockOffset: number;
  onExpire: () => void;
}

function format(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function Timer({ endsAt, heldAt, clockOffset, onExpire }: Props) {
  const remaining = () => Date.parse(endsAt) - (heldAt ? Date.parse(heldAt) : Date.now() + clockOffset);
  const [left, setLeft] = useState(remaining);

  useEffect(() => {
    setLeft(remaining());
    if (heldAt) return;
    const timer = window.setInterval(() => {
      const now = remaining();
      setLeft(now);
      if (now <= 0) {
        window.clearInterval(timer);
        onExpire();
      }
    }, 500);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, heldAt, clockOffset]);

  const low = !heldAt && left <= 2 * 60_000;
  return (
    <span className={`timer ${low ? 'timer-low' : ''}`} role="timer" aria-label={`Time left in this round: ${format(left)}${heldAt ? ', clock stopped' : ''}`}>
      <Clock size={18} aria-hidden="true" />
      {format(left)}
      {heldAt && <span className="timer-note">Clock stopped</span>}
      {low && <span className="timer-note">{left <= 0 ? 'Time is up' : 'Nearly out of time'}</span>}
    </span>
  );
}
