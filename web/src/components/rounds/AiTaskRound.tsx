import { CheckCircle, Copy, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { AiTaskView } from '../../../../shared/types.ts';
import { Badge } from '../Badge.tsx';
import { Chat } from '../Chat.tsx';
import { ConfirmButton } from '../ConfirmButton.tsx';
import { AiWorkbench } from './AiWorkbench.tsx';
import type { RoundProps } from './RoundProps.ts';

const POLL_MS = 15_000;

function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? '' : 's'}`;
}

/** The brief is the repo's TASK.md; its first line repeats the title shown above it. */
function withoutTitle(brief: string): string {
  return brief.replace(/^# .*\n+/, '');
}

function CopyRow({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the text is selectable beside the button.
    }
  }
  return (
    <div className="copy-row">
      <span className="copy-label">{label}</span>
      <code>{text}</code>
      <button type="button" className="button" onClick={() => void copy()} aria-label={`Copy: ${label}`}>
        <Copy size={16} aria-hidden="true" />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function AiTaskRound(props: RoundProps<AiTaskView>) {
  // Old rounds have no mode and were all done in the candidate's own editor.
  return props.view.workspaceMode === 'browser' ? <AiWorkbench {...props} /> : <OwnEditorRound {...props} />;
}

function OwnEditorRound({ view, roundIndex, controller, locked }: RoundProps<AiTaskView>) {
  // The server only looks at the coding agent's session when asked to.
  useEffect(() => {
    if (locked || view.phase === 'complete') return;
    const poll = () => void controller.act(roundIndex, { kind: 'poll' });
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundIndex, locked, view.phase]);

  const { activity } = view;
  return (
    <div className="round-split">
      <div className="stack">
        <section className="card" aria-labelledby="workspace-title">
          <h2 id="workspace-title" className="panel-title">
            Your workspace
          </h2>
          <p className="hint">Open this folder in your editor and start your coding agent inside it. Work there, not here.</p>
          <CopyRow label="Folder" text={view.workspace} />
          <CopyRow label="Start Claude Code" text={`cd "${view.workspace}" && claude`} />
          <CopyRow label="Open in VS Code" text={`code "${view.workspace}"`} />
          <div className="activity" aria-live="polite">
            {activity.sessionFound ? (
              <Badge tone="success" icon={<CheckCircle size={14} weight="bold" />}>
                Agent session found
              </Badge>
            ) : (
              <Badge tone="warning" icon={<WarningCircle size={14} weight="bold" />}>
                No agent session yet
              </Badge>
            )}
            <span>{count(activity.prompts, 'prompt')}</span>
            <span>{count(activity.toolCalls, 'agent action')}</span>
            <span>{count(activity.filesChanged, 'file')} changed</span>
          </div>
        </section>
        <section className="card" aria-labelledby="brief-title">
          <h2 id="brief-title" className="panel-title">
            {view.title}
          </h2>
          <pre className="prose brief">{withoutTitle(view.brief)}</pre>
        </section>
      </div>

      <div className="stack">
        <Chat
          messages={view.transcript}
          onSend={(text) => controller.act(roundIndex, { kind: 'answer', text })}
          sending={controller.busy === 'answer'}
          waitingLabel="Sending…"
          placeholder="Answer the interviewer here."
          inputLabel="Your answer to the interviewer"
          disabled={locked || view.phase === 'complete'}
        />
        {view.phase === 'working' && (
          <div className="toolbar">
            <ConfirmButton
              confirmLabel="Yes, I am done coding"
              onConfirm={() => void controller.act(roundIndex, { kind: 'finish_work' })}
              disabled={locked || controller.busy === 'finish_work'}
            >
              {controller.busy === 'finish_work' ? 'Running the tests and reading your changes…' : 'I am done, start the wrap-up'}
            </ConfirmButton>
          </div>
        )}
      </div>
    </div>
  );
}
