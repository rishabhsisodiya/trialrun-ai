import { ArrowClockwise, CheckCircle, MinusCircle, WarningCircle, XCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { EngineState, EngineStatus, SetupResponse } from '../../../shared/types.ts';
import type { Resource } from '../hooks/useResource.ts';
import { Badge, type BadgeTone } from './Badge.tsx';

const STATE_VIEW: Record<EngineState, { tone: BadgeTone; label: string; icon: ReactNode }> = {
  ready: { tone: 'success', label: 'Ready', icon: <CheckCircle size={14} weight="bold" /> },
  not_logged_in: { tone: 'warning', label: 'Not signed in', icon: <WarningCircle size={14} weight="bold" /> },
  not_installed: { tone: 'neutral', label: 'Not installed', icon: <MinusCircle size={14} weight="bold" /> },
  error: { tone: 'danger', label: 'Problem', icon: <XCircle size={14} weight="bold" /> },
};

/** `Run \`claude\` to sign in.` → the command rendered as code. */
function withCode(text: string): ReactNode {
  return text.split('`').map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part));
}

function EngineRow({ engine }: { engine: EngineStatus }) {
  const view = STATE_VIEW[engine.state];
  const meta = [engine.version && `v${engine.version}`, engine.plan && `${engine.plan} plan`].filter(Boolean).join(' · ');
  return (
    <li className="engine">
      <div className="engine-head">
        <span className="engine-name">{engine.name}</span>
        <Badge tone={view.tone} icon={view.icon}>
          {view.label}
        </Badge>
      </div>
      {meta && <p className="engine-meta">{meta}</p>}
      {engine.detail && <p className="engine-fix">{engine.detail}</p>}
      {engine.fix && <p className="engine-fix">{withCode(engine.fix)}</p>}
      {!engine.verified && engine.state === 'ready' && (
        <p className="engine-fix">Support for this engine has not been tested yet.</p>
      )}
    </li>
  );
}

function summaryOf(setup: SetupResponse): string {
  return setup.ready
    ? 'Interviews run on the plan you are signed into. No API key is used.'
    : 'No coding agent is ready. Install and sign into one to run an interview.';
}

export function SetupPanel({ setup, onRecheck }: { setup: Resource<SetupResponse>; onRecheck: () => void }) {
  const checking = setup.status === 'loading';
  return (
    <aside className="card setup" aria-labelledby="setup-title">
      <div className="setup-head">
        <h2 id="setup-title" className="panel-title">
          Coding agents
        </h2>
        <button type="button" className="button" onClick={onRecheck} disabled={checking}>
          <ArrowClockwise size={16} aria-hidden="true" />
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>

      <div aria-live="polite">
        {setup.status === 'error' && (
          <div className="notice notice-danger" role="alert">
            <p>{setup.message}</p>
          </div>
        )}

        {setup.data ? (
          <div className="setup">
            <p className="setup-summary">{summaryOf(setup.data)}</p>
            <ul className="engine-list">
              {setup.data.engines.map((engine) => (
                <EngineRow key={engine.id} engine={engine} />
              ))}
            </ul>
          </div>
        ) : (
          checking && (
            <div className="setup">
              <span className="visually-hidden">Checking which coding agents are installed</span>
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          )
        )}
      </div>
    </aside>
  );
}
