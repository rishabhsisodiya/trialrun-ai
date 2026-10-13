import { ArrowRight, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import type { InterviewSummary } from '../../../shared/types.ts';
import { api, messageOf } from '../api.ts';
import type { Resource } from '../hooks/useResource.ts';
import { links } from '../router.ts';
import { ConfirmButton } from './ConfirmButton.tsx';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

interface Props {
  history: Resource<InterviewSummary[]>;
  onChanged: () => void;
}

export function HistoryList({ history, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setError(null);
    try {
      await api.remove(id);
      onChanged();
    } catch (failure) {
      setError(messageOf(failure));
    }
  }

  return (
    <section aria-labelledby="history-title" className="history">
      <h2 id="history-title" className="panel-title">
        Your interviews
      </h2>
      {(history.status === 'error' || error) && (
        <div className="notice notice-danger" role="alert">
          <p>{error ?? (history.status === 'error' ? history.message : '')}</p>
          <button type="button" className="button" onClick={onChanged}>
            Try again
          </button>
        </div>
      )}
      {!history.data && history.status === 'loading' && <div className="skeleton" />}
      {history.data?.length === 0 && <p className="hint">No interviews yet. Pick a type above to run your first one.</p>}
      {history.data && history.data.length > 0 && (
        <ul className="history-list">
          {history.data.map((interview) => {
            const running = interview.status === 'in_progress';
            return (
              <li key={interview.id} className="card history-row">
                <div>
                  <p className="history-name">{interview.name}</p>
                  <p className="hint">
                    {interview.stack} · {dateFormat.format(new Date(interview.createdAt))}
                  </p>
                </div>
                <div className="history-actions">
                  {!running && (
                    <span className="score-inline">
                      {interview.overall === null ? 'Not scored' : `${interview.overall.toFixed(1)} / 5`}
                    </span>
                  )}
                  <a className={`button ${running ? 'button-primary' : ''}`} href={running ? links.interview(interview.id) : links.report(interview.id)}>
                    {running ? 'Resume' : 'Report'}
                    <ArrowRight size={16} aria-hidden="true" />
                  </a>
                  <ConfirmButton confirmLabel="Delete for good" tone="danger" onConfirm={() => void remove(interview.id)}>
                    <Trash size={16} aria-hidden="true" />
                    <span className="visually-hidden">Delete the {interview.name} from {dateFormat.format(new Date(interview.createdAt))}</span>
                  </ConfirmButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
