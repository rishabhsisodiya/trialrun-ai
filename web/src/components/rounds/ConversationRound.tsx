import type { ConversationView } from '../../../../shared/types.ts';
import { Chat } from '../Chat.tsx';
import type { RoundProps } from './RoundProps.ts';

export function ConversationRound({ view, roundIndex, controller, locked }: RoundProps<ConversationView>) {
  const chat = (
    <Chat
      messages={view.transcript}
      onSend={(text) => controller.act(roundIndex, { kind: 'answer', text })}
      sending={controller.busy === 'answer'}
      waitingLabel="The interviewer is thinking…"
      placeholder="Type your answer, or dictate it with your system dictation key to practise answering aloud."
      inputLabel="Your answer"
      disabled={locked || view.complete}
    />
  );
  if (!view.artifact) return <div className="round-narrow">{chat}</div>;
  return (
    <div className="round-split">
      <section className="card" aria-labelledby="artifact-title">
        <h2 id="artifact-title" className="panel-title">
          {view.artifact.title}
        </h2>
        <pre className="code-block" tabIndex={0}>
          <code>{view.artifact.code}</code>
        </pre>
      </section>
      {chat}
    </div>
  );
}
