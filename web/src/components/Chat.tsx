import { PaperPlaneRight } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Message } from '../../../shared/types.ts';
import { Markdown } from './Markdown.tsx';

const SPEAKER: Record<Message['from'], string> = { interviewer: 'Interviewer', candidate: 'You', assistant: 'AI assistant' };

interface Props {
  messages: Message[];
  /** Sends the text; resolves to true when it was accepted, so the box can clear. */
  onSend: (text: string) => Promise<boolean>;
  sending: boolean;
  /** Shown while waiting for a reply, e.g. "Interviewer is thinking…". */
  waitingLabel: string;
  placeholder: string;
  disabled?: boolean;
  /** Shown instead of the transcript when nothing has been said. */
  emptyLabel?: string;
  inputLabel: string;
  /** Render replies as formatted text (code blocks, lists). For the AI assistant, which writes Markdown. */
  rich?: boolean;
}

/** A transcript with an answer box. Used for the interviewer and for the AI assistant. */
export function Chat({ messages, onSend, sending, waitingLabel, placeholder, disabled, emptyLabel, inputLabel, rich }: Props) {
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLLIElement>(null);
  const inputId = useId();

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, sending]);

  async function send() {
    const text = draft.trim();
    if (!text || sending || disabled) return;
    // The text stays in the box until the server has it, so a failure loses nothing.
    if (await onSend(text)) setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="chat">
      <ol className="chat-log" aria-live="polite">
        {messages.length === 0 && emptyLabel && <li className="chat-empty">{emptyLabel}</li>}
        {messages.map((message) => (
          <li key={message.id} className={`chat-message chat-${message.from}`}>
            <span className="chat-speaker">{SPEAKER[message.from]}</span>
            {rich && message.from !== 'candidate' ? <Markdown source={message.text} baseLevel={4} /> : <p>{message.text}</p>}
          </li>
        ))}
        {sending && <li className="chat-waiting">{waitingLabel}</li>}
        <li ref={end} aria-hidden="true" />
      </ol>
      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="visually-hidden" htmlFor={inputId}>
          {inputLabel}
        </label>
        <textarea
          id={inputId}
          className="input"
          rows={4}
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={10000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="chat-actions">
          <span className="hint">Ctrl or ⌘ + Enter to send</span>
          <button type="submit" className="button button-primary" disabled={disabled || sending || !draft.trim()}>
            <PaperPlaneRight size={16} aria-hidden="true" />
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
