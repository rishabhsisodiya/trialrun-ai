import { CheckCircle, Play, XCircle } from '@phosphor-icons/react';
import { useRef } from 'react';
import type { CodeView, RunView } from '../../../../shared/types.ts';
import { Badge } from '../Badge.tsx';
import { Chat } from '../Chat.tsx';
import { CodeEditor } from '../CodeEditor.tsx';
import { ConfirmButton } from '../ConfirmButton.tsx';
import type { RoundProps } from './RoundProps.ts';

function readDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDraft(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the server still has the last run.
  }
}

function RunResults({ run }: { run: RunView }) {
  const passed = run.results.filter((result) => result.passed).length;
  return (
    <section className="card results" aria-labelledby="results-title" aria-live="polite">
      <h3 id="results-title" className="panel-title">
        Test results
        {run.results.length > 0 && (
          <span className="results-count">
            {passed} of {run.results.length} passed
          </span>
        )}
      </h3>
      {run.error && (
        <pre className="code-block notice-danger" role="alert">
          {run.error}
        </pre>
      )}
      {run.hidden && (
        <p className="hint">
          Hidden edge cases: {run.hidden.passed} of {run.hidden.total} passed.
        </p>
      )}
      <ul className="result-list">
        {run.results.map((result) => (
          <li key={result.name} className="result">
            <Badge
              tone={result.passed ? 'success' : 'danger'}
              icon={result.passed ? <CheckCircle size={14} weight="bold" /> : <XCircle size={14} weight="bold" />}
            >
              {result.passed ? 'Pass' : 'Fail'}
            </Badge>
            <span className="result-name">{result.name}</span>
            <dl className="result-detail">
              <dt>Input</dt>
              <dd>
                <code>{result.args}</code>
              </dd>
              <dt>Expected</dt>
              <dd>
                <code>{result.expected}</code>
              </dd>
              <dt>{result.error ? 'Error' : 'Returned'}</dt>
              <dd>
                <code>{result.error ?? result.actual ?? 'nothing'}</code>
              </dd>
            </dl>
          </li>
        ))}
      </ul>
      {run.stdout && (
        <details>
          <summary>Printed output</summary>
          <pre className="code-block">{run.stdout}</pre>
        </details>
      )}
    </section>
  );
}

export function CodeRound({ view, roundIndex, controller, locked, storageKey }: RoundProps<CodeView>) {
  const draftKey = `${storageKey}:${view.problemIndex}`;
  const initial = () => readDraft(draftKey) ?? view.code ?? view.problem.starterCode;
  const code = useRef('');
  const loadedKey = useRef<string | null>(null);
  // A new problem brings a new document. Set during render so the editor is created with it.
  if (loadedKey.current !== draftKey) {
    loadedKey.current = draftKey;
    code.current = initial();
  }

  const running = controller.busy === 'run';
  const submitting = controller.busy === 'submit_problem';
  const explaining = view.discussion !== null;
  const busy = running || submitting || locked || view.complete || view.preparingNext || explaining;
  const isLast = view.problemIndex + 1 >= view.problemCount;

  const runTests = () => {
    if (!busy) void controller.act(roundIndex, { kind: 'run', code: code.current });
  };

  return (
    <div className="round-split round-split-code">
      <div className="stack">
        <section className="card" aria-labelledby="problem-title">
          <p className="eyebrow">
            {view.variant === 'debugging' ? 'Debugging' : 'Problem'} {view.problemIndex + 1} of {view.problemCount}
          </p>
          <h2 id="problem-title" className="panel-title">
            {view.problem.title}
          </h2>
          {view.previous && !view.preparingNext && (
            <p className="hint">
              Previous problem ({view.previous.title}): passed {view.previous.passed} of {view.previous.total} tests.
            </p>
          )}
          <p className="prose">{view.problem.statement}</p>
          <h3 className="subhead">Visible tests</h3>
          <ul className="case-list">
            {view.problem.tests.map((test) => (
              <li key={test.name}>
                <span>{test.name}</span>
                <code>
                  {view.problem.functionName}({test.args.slice(1, -1)}) → {test.expected}
                </code>
              </li>
            ))}
          </ul>
          <p className="hint">More edge cases are checked when you submit.</p>
        </section>

        {view.assistant && (
          <section className="card" aria-labelledby="assistant-title">
            <h2 id="assistant-title" className="panel-title">
              AI assistant
            </h2>
            <p className="hint">It sees the problem and your current code. How you use it is part of the score.</p>
            <Chat
              messages={view.assistant}
              onSend={(message) => controller.act(roundIndex, { kind: 'assistant', message, code: code.current })}
              sending={controller.busy === 'assistant'}
              waitingLabel="The assistant is working…"
              placeholder="Ask the assistant for help."
              inputLabel="Message to the AI assistant"
              emptyLabel="Nothing asked yet."
              disabled={locked || view.complete}
            />
          </section>
        )}
      </div>

      <div className="stack">
        <CodeEditor
          documentKey={draftKey}
          initialValue={code.current}
          language={view.language}
          label={`Code editor, ${view.language}`}
          onRun={runTests}
          onChange={(value) => {
            code.current = value;
            writeDraft(draftKey, value);
          }}
        />
        <div className="toolbar">
          <button type="button" className="button button-primary" onClick={runTests} disabled={busy}>
            <Play size={16} aria-hidden="true" />
            {running ? 'Running…' : 'Run tests'}
          </button>
          <span className="hint">Ctrl or ⌘ + Enter</span>
          <span className="toolbar-end">
            <ConfirmButton
              confirmLabel={isLast ? 'Yes, submit and end the round' : 'Yes, submit and move on'}
              onConfirm={() => void controller.act(roundIndex, { kind: 'submit_problem', code: code.current })}
              disabled={busy}
            >
              {submitting ? 'Submitting…' : 'Submit problem'}
            </ConfirmButton>
          </span>
        </div>
        {view.discussion && (
          <section className="card" aria-labelledby="discussion-title">
            <h2 id="discussion-title" className="panel-title">
              Explain your solution
            </h2>
            <p className="hint">
              Problem {view.problemIndex + 1} is submitted. Answer the interviewer to move on; how you explain it is part of the score.
            </p>
            <Chat
              messages={view.discussion}
              onSend={(text) => controller.act(roundIndex, { kind: 'answer', text })}
              sending={controller.busy === 'answer'}
              waitingLabel="The interviewer is thinking…"
              placeholder="Explain your approach and its time and space complexity. You can dictate it."
              inputLabel="Your explanation"
              disabled={locked}
            />
          </section>
        )}
        {view.preparingNext && (
          <section className="card notice" role="status" aria-live="polite">
            <p>
              <strong>Problem {view.problemIndex + 1} submitted.</strong>{' '}
              {view.previous && `It passed ${view.previous.passed} of ${view.previous.total} tests. `}
              {view.nextError
                ? 'The next problem could not be written, and the clock is stopped.'
                : 'The next problem is being written. The clock is stopped until it arrives, and you can end the round at any time.'}
            </p>
            {view.nextError && (
              <>
                <p className="field-error">{view.nextError}</p>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void controller.act(roundIndex, { kind: 'retry_next' })}
                  disabled={controller.busy === 'retry_next'}
                >
                  Try again
                </button>
              </>
            )}
          </section>
        )}
        {view.lastRun && <RunResults run={view.lastRun} />}
      </div>
    </div>
  );
}
