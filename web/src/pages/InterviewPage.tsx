import { ArrowLeft, CheckCircle, Circle, PauseCircle, PlayCircle, SkipForward } from '@phosphor-icons/react';
import { useEffect, type ReactNode } from 'react';
import type { CatalogResponse, RoundState, RoundStatus, RoundView } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { ConfirmButton } from '../components/ConfirmButton.tsx';
import { AiTaskRound } from '../components/rounds/AiTaskRound.tsx';
import { CodeRound } from '../components/rounds/CodeRound.tsx';
import { ConversationRound } from '../components/rounds/ConversationRound.tsx';
import { McqRound } from '../components/rounds/McqRound.tsx';
import type { RoundProps } from '../components/rounds/RoundProps.ts';
import { Timer } from '../components/Timer.tsx';
import { useInterview, type InterviewController } from '../hooks/useInterview.ts';
import { useResource } from '../hooks/useResource.ts';
import { links, navigate } from '../router.ts';

const STATUS_ICON: Record<RoundStatus, ReactNode> = {
  pending: <Circle size={16} aria-hidden="true" />,
  active: <PlayCircle size={16} weight="fill" aria-hidden="true" />,
  paused: <PauseCircle size={16} weight="fill" aria-hidden="true" />,
  done: <CheckCircle size={16} weight="fill" aria-hidden="true" />,
  skipped: <SkipForward size={16} aria-hidden="true" />,
};
const STATUS_LABEL: Record<RoundStatus, string> = { pending: 'not started', active: 'in progress', paused: 'paused', done: 'done', skipped: 'skipped' };

/** Marks the page as full-window while an IDE-style round is on screen. */
function FullWindow({ on }: { on: boolean }) {
  useEffect(() => {
    document.body.classList.toggle('full-window', on);
    return () => document.body.classList.remove('full-window');
  }, [on]);
  return null;
}

function RoundBody(props: RoundProps<RoundView>) {
  const { view } = props;
  switch (view.mode) {
    case 'conversation':
      return <ConversationRound {...props} view={view} />;
    case 'mcq':
      return <McqRound {...props} view={view} />;
    case 'code':
      return <CodeRound {...props} view={view} />;
    case 'ai_task':
      return <AiTaskRound {...props} view={view} />;
  }
}

function RoundIntro({ round, catalog, controller }: { round: RoundState; catalog: CatalogResponse | null; controller: InterviewController }) {
  const type = catalog?.roundTypes.find((option) => option.id === round.type);
  const starting = controller.busy === 'start';
  return (
    <section className="card round-intro" aria-labelledby="intro-title">
      <p className="eyebrow">Round {round.index + 1}</p>
      <h2 id="intro-title" className="section-title">
        {type?.name ?? round.type}
      </h2>
      <p className="section-lead">
        {type?.summary} You have {round.minutes} minutes. The clock starts once the round is ready and cannot be stopped.
      </p>
      <div className="toolbar">
        <button type="button" className="button button-primary" onClick={() => void controller.start(round.index)} disabled={starting}>
          {starting ? 'Preparing your round…' : 'Start round'}
        </button>
        {starting && (
          <span className="hint" aria-live="polite">
            Writing the questions on your plan. This can take up to a minute.
          </span>
        )}
      </div>
    </section>
  );
}

export function InterviewPage({ id }: { id: string }) {
  const controller = useInterview(id);
  const [catalog] = useResource(api.catalog);
  const { view } = controller;
  const finished = view?.interview.status === 'finished';

  useEffect(() => {
    if (finished) navigate(links.report(id));
  }, [finished, id]);

  if (controller.loadError) {
    return (
      <main id="main" tabIndex={-1} className="shell-main">
        <div className="card notice notice-danger" role="alert">
          <p>{controller.loadError}</p>
          <a className="button" href={links.home}>
            Back to the start
          </a>
        </div>
      </main>
    );
  }
  if (!view) {
    return (
      <main id="main" tabIndex={-1} className="shell-main" aria-busy="true">
        <span className="visually-hidden">Loading the interview</span>
        <div className="skeleton skeleton-tall" />
      </main>
    );
  }

  const { interview } = view;
  const current = interview.rounds.find((round) => round.status === 'active' || round.status === 'paused');
  const next = current ? undefined : interview.rounds.find((round) => round.status === 'pending');
  const roundName = (round: RoundState) => catalog.data?.roundTypes.find((type) => type.id === round.type)?.name ?? round.type;
  const scoring = controller.busy === 'finish';

  // The in-browser workspace is an IDE: it takes the whole window instead of a centred column.
  const fullWindow = view.current?.mode === 'ai_task' && view.current.workspaceMode === 'browser';

  async function finish() {
    if (await controller.finish()) navigate(links.report(id));
  }

  return (
    <main id="main" tabIndex={-1} className={`shell-main ${fullWindow ? 'shell-main-full' : ''}`}>
      <FullWindow on={fullWindow} />
      <header className="interview-head">
        <div>
          <a className="button button-quiet" href={links.home}>
            <ArrowLeft size={16} aria-hidden="true" />
            Home
          </a>
          <h1 className="interview-title">
            {interview.name}{' '}
            <span className="interview-stack">
              {[interview.stack.name, catalog.data?.levels.find((level) => level.id === interview.level)?.name].filter(Boolean).join(' · ')}
            </span>
          </h1>
        </div>
        <div className="interview-controls">
          {current?.status === 'active' && current.endsAt && (
            <Timer endsAt={current.endsAt} heldAt={current.clockHeldAt ?? null} clockOffset={controller.clockOffset} onExpire={controller.refresh} />
          )}
          {current && view.current && (
            <ConfirmButton confirmLabel="Yes, end this round" onConfirm={() => void controller.submitRound(current.index)} disabled={controller.busy === 'submit'}>
              End round
            </ConfirmButton>
          )}
        </div>
      </header>

      <ol className={`stepper ${interview.rounds.length === 1 ? 'stepper-single' : ''}`} aria-label="Rounds">
        {interview.rounds.map((round) => (
          <li key={round.index} className={`step step-${round.status}`} aria-current={round === current ? 'step' : undefined}>
            {STATUS_ICON[round.status]}
            <span>{roundName(round)}</span>
            <span className="minutes">{round.minutes} min</span>
            <span className="visually-hidden">, {STATUS_LABEL[round.status]}</span>
          </li>
        ))}
      </ol>

      {controller.error && (
        <div className="card notice notice-danger" role="alert">
          <p>{controller.error}</p>
          <button type="button" className="button" onClick={controller.clearError}>
            Dismiss
          </button>
        </div>
      )}

      {current?.status === 'paused' && (
        <div className="card notice" role="status">
          <p>
            The round is paused and the clock is stopped, because the coding agent could not answer (often a usage limit). Nothing was lost.
          </p>
          <button type="button" className="button button-primary" onClick={() => void controller.resume(current.index)} disabled={controller.busy === 'resume'}>
            Resume the round
          </button>
        </div>
      )}

      {current && view.current && (
        <>
          <RoundBody
            view={view.current}
            roundIndex={current.index}
            controller={controller}
            locked={current.status !== 'active'}
            storageKey={`trialrun:${id}:${current.index}`}
          />
        </>
      )}

      {next && <RoundIntro round={next} catalog={catalog.data} controller={controller} />}

      {!current && !finished && (
        <section className="card round-intro" aria-labelledby="finish-title">
          <h2 id="finish-title" className="panel-title">
            {next ? 'Had enough?' : 'All rounds are done'}
          </h2>
          <p className="hint">
            {next
              ? 'You can end the interview here. Rounds you have not started are skipped and the rest is scored.'
              : 'Scoring reads everything you did and writes the report. It can take a minute or two.'}
          </p>
          <div className="toolbar">
            {next ? (
              <ConfirmButton confirmLabel="Yes, end and score it" onConfirm={() => void finish()} disabled={scoring}>
                {scoring ? 'Scoring…' : 'End interview and get the report'}
              </ConfirmButton>
            ) : (
              <button type="button" className="button button-primary" onClick={() => void finish()} disabled={scoring}>
                {scoring ? 'Scoring…' : 'Get the report'}
              </button>
            )}
            {scoring && (
              <span className="hint" aria-live="polite">
                Scoring each round on your plan…
              </span>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
