import { ArrowLeft, ArrowsClockwise, BookOpenText, CaretDown } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import type { CompetencyScore, Level, Report, RoundReport } from '../../../shared/types.ts';
import { api, messageOf } from '../api.ts';
import { useResource } from '../hooks/useResource.ts';
import { links } from '../router.ts';

const LEVEL_NAME: Record<Level, string> = { junior: 'junior', mid: 'mid-level', senior: 'senior' };

const STATUS_NOTE: Record<RoundReport['status'], string | null> = {
  scored: null,
  unscored: 'Not scored',
  skipped: 'Skipped',
  error: 'Could not be scored',
};

function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? '' : 's'}`;
}

function ScoreMeter({ score }: { score: number }) {
  return (
    <span className="meter" role="img" aria-label={`${score} out of 5`}>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: `${(score / 5) * 100}%` }} />
      </span>
      <span className="meter-value">{score}</span>
    </span>
  );
}

function Competency({ item }: { item: CompetencyScore }) {
  return (
    <li className="competency">
      <div className="competency-head">
        <span className="competency-name">{item.name}</span>
        <ScoreMeter score={item.score} />
      </div>
      <p>{item.reason}</p>
      {item.evidence && <blockquote>{item.evidence}</blockquote>}
    </li>
  );
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="subhead">{title}</h4>
      <ul className="bullets">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const LABEL = /^([A-Z][A-Za-z ]{2,24}): /;

/** "Model answer: …" with the label picked out, so the sheet can be scanned. */
function ReviewLine({ line }: { line: string }) {
  const label = LABEL.exec(line)?.[1];
  if (!label) return <p className="prose">{line}</p>;
  return (
    <p className="prose">
      <span className="review-label">{label}</span>
      {line.slice(label.length + 2)}
    </p>
  );
}

function RoundCard({ round, onShowAnswers }: { round: RoundReport; onShowAnswers: (roundIndex: number) => void }) {
  const note = STATUS_NOTE[round.status];
  return (
    <li className="card report-round">
      <div className="report-round-head">
        <h3 className="panel-title">
          Round {round.index + 1}: {round.name}
        </h3>
        {round.score !== null ? <span className="score-inline">{round.score.toFixed(1)} / 5</span> : note && <span className="hint">{note}</span>}
      </div>
      {round.summary && <p>{round.summary}</p>}
      {round.error && (
        <p className="field-error" role="alert">
          {round.error}
        </p>
      )}
      {round.competencies.length > 0 && (
        <ul className="competency-list">
          {round.competencies.map((item) => (
            <Competency key={item.name} item={item} />
          ))}
        </ul>
      )}
      <div className="report-columns">
        <Bullets title="Strengths" items={round.strengths} />
        <Bullets title={round.status === 'unscored' ? 'To improve' : 'Gaps'} items={round.gaps} />
        <Bullets title="Practise next" items={round.practice} />
      </div>
      {(round.review.length > 0 || round.answersPending) && (
        <button type="button" className="button answer-link" onClick={() => onShowAnswers(round.index)}>
          <BookOpenText size={16} aria-hidden="true" />
          Show the answer sheet for this round{round.answersPending ? '' : ` (${count(round.review.length, 'answer')})`}
        </button>
      )}
    </li>
  );
}

interface AnswerSheetProps {
  rounds: RoundReport[];
  open: boolean;
  /** True while the sheet is being written for the first time. */
  writing: boolean;
  error: string | null;
  onToggle: () => void;
}

/** Every round's answers and solutions, gathered after the scores so the report reads top to bottom. */
function AnswerSheet({ rounds, open, writing, error, onToggle }: AnswerSheetProps) {
  const withAnswers = rounds.filter((round) => round.review.length > 0);
  const pending = rounds.some((round) => round.answersPending);
  if (withAnswers.length === 0 && !pending) return null;
  const answers = withAnswers.reduce((sum, round) => sum + round.review.length, 0);
  return (
    // Closed until asked for, so the scores can be read before the answers are seen.
    <details className="answer-sheet" open={open}>
      <summary
        onClick={(event) => {
          // Opening may first have to write the sheet, so the page decides, not the browser.
          event.preventDefault();
          if (!writing) onToggle();
        }}
      >
        <BookOpenText size={28} aria-hidden="true" className="answer-sheet-icon" />
        <span className="answer-sheet-text">
          <h2 id="answers-title" className="section-title">
            Answer sheet
          </h2>
          <span className="hint" aria-live="polite">
            {writing
              ? 'Writing model answers and analysing your solutions on your plan. This takes about a minute.'
              : pending
                ? 'Model answers and best solutions, next to what you answered. Not written yet: opening it writes them on your plan, which takes about a minute.'
                : `${count(answers, 'answer')} across ${count(withAnswers.length, 'round')}: model answers and best solutions, next to what you answered. Hidden until you open it.`}
          </span>
          {error && (
            <span className="field-error" role="alert">
              {error} Open it again to retry.
            </span>
          )}
        </span>
        <span className="button button-primary answer-sheet-toggle">
          {writing ? 'Writing…' : open ? 'Hide answers' : 'Show answers'}
          <CaretDown size={16} weight="bold" aria-hidden="true" className="answer-sheet-caret" />
        </span>
      </summary>
      {withAnswers.map((round) => (
        <section key={round.index} className="card report-round" aria-labelledby={`answers-${round.index}`}>
          <h3 id={`answers-${round.index}`} className="panel-title">
            Round {round.index + 1}: {round.name}
          </h3>
          <ul className="review-list">
            {round.review.map((item, index) => (
              <li key={index}>
                <p className="review-heading prose">{item.heading}</p>
                {item.lines.map((line, lineIndex) => (
                  <ReviewLine key={lineIndex} line={line} />
                ))}
                {item.code && (
                  <pre className="code-block" tabIndex={0}>
                    <code>{item.code}</code>
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </details>
  );
}

export function ReportPage({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => api.report(id, signal), [id]);
  const [report, reload] = useResource<Report>(load);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [answersOpen, setAnswersOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const [answersError, setAnswersError] = useState<string | null>(null);
  // The report as returned by the last answer-sheet request, which is newer than the first load.
  const [latest, setLatest] = useState<Report | null>(null);
  const current = latest ?? report.data;

  /** Opens the answer sheet, writing it first if this is the first time. Resolves to whether it opened. */
  async function openAnswers(): Promise<boolean> {
    if (current?.rounds.some((round) => round.answersPending)) {
      setWriting(true);
      setAnswersError(null);
      try {
        setLatest(await api.answers(id));
      } catch (failure) {
        setAnswersError(messageOf(failure));
        // Some rounds may have been written before the failure; show the report as it now is.
        reload();
        setLatest(null);
        return false;
      } finally {
        setWriting(false);
      }
    }
    setAnswersOpen(true);
    return true;
  }

  /** Scores the rounds that failed to score the first time. */
  async function retry() {
    setRetrying(true);
    setRetryError(null);
    try {
      setLatest(await api.finish(id));
    } catch (failure) {
      setRetryError(messageOf(failure));
    } finally {
      setRetrying(false);
    }
  }

  async function showAnswers(roundIndex: number) {
    if (writing || !(await openAnswers())) return;
    // Wait for the sheet to render before scrolling to the round inside it.
    window.setTimeout(() => document.getElementById(`answers-${roundIndex}`)?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  return (
    <main id="main" tabIndex={-1} className="shell-main">
      <a className="button button-quiet" href={links.home}>
        <ArrowLeft size={16} aria-hidden="true" />
        Home
      </a>

      {report.status === 'error' && (
        <div className="card notice notice-danger" role="alert">
          <p>{report.message}</p>
          <div className="toolbar">
            <button type="button" className="button" onClick={reload}>
              Try again
            </button>
            <a className="button" href={links.interview(id)}>
              Open the interview
            </a>
          </div>
        </div>
      )}
      {!report.data && report.status === 'loading' && (
        <div aria-busy="true">
          <span className="visually-hidden">Loading the report</span>
          <div className="skeleton skeleton-tall" />
        </div>
      )}

      {current && (
        <>
          <header className="card report-head">
            <div>
              <h1 className="section-title">Interview report</h1>
              <p className="hint">
                Scores run from 1 to 5, where 3 meets the bar for a {LEVEL_NAME[current.level ?? 'mid']} engineer. They are one model's reading of your interview:
                use the evidence to judge whether you agree.
              </p>
            </div>
            <div className="report-overall">
              <span className="report-overall-value">{current.overall === null ? '–' : current.overall.toFixed(1)}</span>
              <span className="hint">overall, out of 5</span>
            </div>
          </header>

          {!current.complete && (
            <div className="card notice" role="status">
              <p>Some rounds could not be scored, usually because of a usage limit. The rounds already scored are kept.</p>
              <button type="button" className="button button-primary" onClick={() => void retry()} disabled={retrying}>
                <ArrowsClockwise size={16} aria-hidden="true" />
                {retrying ? 'Scoring…' : 'Score the missing rounds'}
              </button>
              {retryError && (
                <p className="field-error" role="alert">
                  {retryError}
                </p>
              )}
            </div>
          )}

          <ol className="report-list">
            {current.rounds.map((round) => (
              <RoundCard key={round.index} round={round} onShowAnswers={showAnswers} />
            ))}
          </ol>

          <AnswerSheet
            rounds={current.rounds}
            open={answersOpen}
            writing={writing}
            error={answersError}
            onToggle={() => (answersOpen ? setAnswersOpen(false) : void openAnswers())}
          />
        </>
      )}
    </main>
  );
}
