import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { useId, useState, type FormEvent } from 'react';
import {
  CODE_LANGUAGES,
  type CatalogResponse,
  type CodeLanguage,
  type CreateInterviewRequest,
  type EngineId,
  type InterviewType,
  type Level,
  type RoundPlan,
  type RoundTypeId,
  type SetupResponse,
  type WorkspaceMode,
} from '../../../shared/types.ts';
import { api, messageOf } from '../api.ts';
import { links, navigate } from '../router.ts';

const OTHER_STACK = '__other__';
const LANGUAGE_NAMES: Record<CodeLanguage, string> = { javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python' };

interface Props {
  type: InterviewType;
  catalog: CatalogResponse;
  setup: SetupResponse | null;
  onBack: () => void;
}

export function StartForm({ type, catalog, setup, onBack }: Props) {
  const ids = useId();
  const readyEngines = setup?.engines.filter((engine) => engine.state === 'ready') ?? [];
  const firstStack = catalog.stacks[0]!;

  const [stackId, setStackId] = useState(firstStack.id);
  const [stackName, setStackName] = useState('');
  const [language, setLanguage] = useState<CodeLanguage>(firstStack.language);
  const [level, setLevel] = useState<Level>('mid');
  const [engine, setEngine] = useState<EngineId | null>(null);
  const [nextGen, setNextGen] = useState(false);
  const [systemDesign, setSystemDesign] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceMode>('browser');
  const [rounds, setRounds] = useState<RoundPlan[]>([
    { type: 'knowledge', minutes: 15 },
    { type: 'coding', minutes: 40 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedName, setTouchedName] = useState(false);

  const chosenEngine = engine ?? readyEngines[0]?.id ?? null;
  const { limits } = catalog;
  const total = rounds.reduce((sum, round) => sum + round.minutes, 0);

  const nameError = stackId === OTHER_STACK && stackName.trim().length < 2 ? 'Name the stack, for example "Go microservices".' : null;
  const roundsError =
    type.id !== 'custom'
      ? null
      : rounds.length === 0
        ? 'Add at least one round.'
        : rounds.some((round) => !Number.isInteger(round.minutes) || round.minutes < limits.minMinutes || round.minutes > limits.maxMinutes)
          ? `Each round must be ${limits.minMinutes} to ${limits.maxMinutes} whole minutes.`
          : total > limits.maxTotalMinutes
            ? `The interview can be at most ${limits.maxTotalMinutes} minutes; this is ${total}.`
            : rounds.filter((round) => round.type === 'ai_task').length > 1
              ? 'An interview can have one AI-agent task.'
              : null;
  const engineError = chosenEngine ? null : 'No coding agent is ready. Sign into one, then check again in the Coding agents panel.';
  const blocked = Boolean(nameError || roundsError || engineError);
  const hasAiTask = type.id === 'ai' || (type.id === 'custom' && rounds.some((round) => round.type === 'ai_task'));
  // Only Claude Code can be confined to the task folder, which the built-in assistant needs.
  const browserAvailable = chosenEngine === 'claude';

  function pickStack(id: string) {
    setStackId(id);
    const preset = catalog.stacks.find((stack) => stack.id === id);
    if (preset) setLanguage(preset.language);
  }

  function updateRound(index: number, change: Partial<RoundPlan>) {
    setRounds((current) => current.map((round, position) => (position === index ? { ...round, ...change } : round)));
  }

  function moveRound(index: number, by: number) {
    setRounds((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved!);
      return next;
    });
  }

  function addRound() {
    const mcq = catalog.roundTypes.find((round) => round.id === 'mcq')!;
    setRounds((current) => [...current, { type: mcq.id, minutes: mcq.defaultMinutes }]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouchedName(true);
    if (blocked || !chosenEngine) return;
    const request: CreateInterviewRequest = {
      type: type.id,
      stack: stackId === OTHER_STACK ? { name: stackName.trim() } : { presetId: stackId },
      language,
      level,
      engine: chosenEngine,
      options: { ...(type.id === 'karat' ? { nextGen, systemDesign } : {}), ...(hasAiTask ? { workspace } : {}) },
      rounds: type.id === 'custom' ? rounds : undefined,
    };
    setSubmitting(true);
    setError(null);
    try {
      const view = await api.create(request);
      navigate(links.interview(view.interview.id));
    } catch (failure) {
      setError(messageOf(failure));
      setSubmitting(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit} noValidate aria-labelledby={`${ids}-title`}>
      <button type="button" className="button button-quiet" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        All interview types
      </button>
      <div>
        <h1 id={`${ids}-title`} className="section-title">
          {type.name}
        </h1>
        <p className="section-lead">{type.summary}</p>
      </div>

      <div className="field">
        <label htmlFor={`${ids}-stack`}>Tech stack</label>
        <select id={`${ids}-stack`} className="input" value={stackId} onChange={(event) => pickStack(event.target.value)}>
          {catalog.stacks.map((stack) => (
            <option key={stack.id} value={stack.id}>
              {stack.name}
            </option>
          ))}
          <option value={OTHER_STACK}>Other (type your own)</option>
        </select>
        <p className="hint">
          {stackId === OTHER_STACK
            ? 'Questions are written for whatever you type.'
            : `Covers ${catalog.stacks.find((stack) => stack.id === stackId)?.topics.join(', ')}.`}
        </p>
      </div>

      {stackId === OTHER_STACK && (
        <div className="field">
          <label htmlFor={`${ids}-name`}>
            Your stack <span aria-hidden="true">*</span>
          </label>
          <input
            id={`${ids}-name`}
            className="input"
            value={stackName}
            maxLength={100}
            required
            aria-invalid={touchedName && nameError ? true : undefined}
            aria-describedby={touchedName && nameError ? `${ids}-name-error` : undefined}
            onChange={(event) => setStackName(event.target.value)}
            onBlur={() => setTouchedName(true)}
          />
          {touchedName && nameError && (
            <p id={`${ids}-name-error`} className="field-error" role="alert">
              {nameError}
            </p>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor={`${ids}-language`}>Coding language</label>
        <select id={`${ids}-language`} className="input" value={language} onChange={(event) => setLanguage(event.target.value as CodeLanguage)}>
          {CODE_LANGUAGES.map((option) => (
            <option key={option} value={option}>
              {LANGUAGE_NAMES[option]}
            </option>
          ))}
        </select>
        <p className="hint">Used for coding and debugging problems and to choose the AI-agent task.</p>
      </div>

      <div className="field">
        <label htmlFor={`${ids}-level`}>Your level</label>
        <select id={`${ids}-level`} className="input" value={level} onChange={(event) => setLevel(event.target.value as Level)}>
          {catalog.levels.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <p className="hint">
          {catalog.levels.find((option) => option.id === level)?.summary} Sets how hard the questions are and the bar you are scored against.
        </p>
      </div>

      {readyEngines.length > 1 && (
        <fieldset className="field">
          <legend>Interviewer runs on</legend>
          {readyEngines.map((option) => (
            <label key={option.id} className="check">
              <input type="radio" name={`${ids}-engine`} checked={chosenEngine === option.id} onChange={() => setEngine(option.id)} />
              {option.name}
              {!option.verified && ' (not tested yet)'}
            </label>
          ))}
        </fieldset>
      )}

      {type.id === 'karat' && (
        <fieldset className="field">
          <legend>Format</legend>
          <label className="check">
            <input type="checkbox" checked={systemDesign} onChange={(event) => setSystemDesign(event.target.checked)} />
            Include a 20-minute system design round (the hour is shared out again)
          </label>
          <label className="check">
            <input type="checkbox" checked={nextGen} onChange={(event) => setNextGen(event.target.checked)} />
            NextGen: an AI assistant is available in the coding round
          </label>
        </fieldset>
      )}

      {hasAiTask && (
        <fieldset className="field">
          <legend>AI-agent task: where you work</legend>
          <label className="check">
            <input
              type="radio"
              name={`${ids}-workspace`}
              checked={browserAvailable && workspace === 'browser'}
              disabled={!browserAvailable}
              onChange={() => setWorkspace('browser')}
            />
            In the browser, with a file editor and an AI assistant on the page
          </label>
          <label className="check">
            <input
              type="radio"
              name={`${ids}-workspace`}
              checked={!browserAvailable || workspace === 'own'}
              onChange={() => setWorkspace('own')}
            />
            In my own editor, with my own coding agent
          </label>
          <p className="hint">
            {browserAvailable
              ? 'Either way the assistant runs on your plan and the interviewer sees how you use it.'
              : 'The built-in assistant needs Claude Code, so with this engine you work in your own editor.'}
          </p>
        </fieldset>
      )}

      {type.id === 'custom' && (
        <fieldset className="field">
          <legend>Rounds</legend>
          <ol className="round-builder">
            {rounds.map((round, index) => (
              <li key={index} className="round-row">
                <span className="round-number">{index + 1}</span>
                <label className="visually-hidden" htmlFor={`${ids}-type-${index}`}>
                  Round {index + 1} type
                </label>
                <select
                  id={`${ids}-type-${index}`}
                  className="input"
                  value={round.type}
                  onChange={(event) => {
                    const next = catalog.roundTypes.find((option) => option.id === (event.target.value as RoundTypeId))!;
                    updateRound(index, { type: next.id, minutes: next.defaultMinutes });
                  }}
                >
                  {catalog.roundTypes.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <label className="visually-hidden" htmlFor={`${ids}-minutes-${index}`}>
                  Round {index + 1} minutes
                </label>
                <input
                  id={`${ids}-minutes-${index}`}
                  className="input input-minutes"
                  type="number"
                  min={limits.minMinutes}
                  max={limits.maxMinutes}
                  value={Number.isNaN(round.minutes) ? '' : round.minutes}
                  onChange={(event) => updateRound(index, { minutes: event.target.valueAsNumber })}
                />
                <span className="hint">min</span>
                <span className="round-row-actions">
                  <button type="button" className="button button-icon" onClick={() => moveRound(index, -1)} disabled={index === 0} aria-label={`Move round ${index + 1} up`}>
                    <ArrowUp size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="button button-icon" onClick={() => moveRound(index, 1)} disabled={index === rounds.length - 1} aria-label={`Move round ${index + 1} down`}>
                    <ArrowDown size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="button button-icon" onClick={() => setRounds((current) => current.filter((_, position) => position !== index))} aria-label={`Remove round ${index + 1}`}>
                    <Trash size={16} aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <div className="toolbar">
            <button type="button" className="button" onClick={addRound} disabled={rounds.length >= limits.maxRounds}>
              <Plus size={16} aria-hidden="true" />
              Add round
            </button>
            <span className="hint">
              {rounds.length} of {limits.maxRounds} rounds, {Number.isNaN(total) ? '?' : total} of {limits.maxTotalMinutes} minutes
            </span>
          </div>
          {roundsError && (
            <p className="field-error" role="alert">
              {roundsError}
            </p>
          )}
        </fieldset>
      )}

      {(engineError || error) && (
        <p className="field-error" role="alert">
          {error ?? engineError}
        </p>
      )}

      <div className="toolbar">
        <button type="submit" className="button button-primary" disabled={submitting || Boolean(roundsError || engineError)}>
          {submitting ? 'Creating…' : 'Create interview'}
        </button>
        <span className="hint">Nothing is timed until you start the first round.</span>
      </div>
    </form>
  );
}
