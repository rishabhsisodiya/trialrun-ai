import { useState } from 'react';
import type { McqView } from '../../../../shared/types.ts';
import type { RoundProps } from './RoundProps.ts';

export function McqRound({ view, roundIndex, controller, locked }: RoundProps<McqView>) {
  // Shown at once; the server copy follows a moment later.
  const [picked, setPicked] = useState<Record<string, number>>({});
  const chosenFor = (id: string, saved: number | null) => picked[id] ?? saved;
  const answered = view.questions.filter((question) => chosenFor(question.id, question.chosen) !== null).length;

  function choose(questionId: string, choice: number) {
    setPicked((current) => ({ ...current, [questionId]: choice }));
    void controller.act(roundIndex, { kind: 'choose', questionId, choice });
  }

  return (
    <div className="round-narrow">
      <p className="hint" aria-live="polite">
        {answered} of {view.questions.length} answered. Answers are saved as you pick them; end the round when you are done.
      </p>
      <ol className="mcq-list">
        {view.questions.map((question, index) => (
          <li key={question.id} className="card">
            <fieldset className="mcq" disabled={locked}>
              <legend>
                <span className="mcq-number">Question {index + 1}</span>
                <span className="prose">{question.prompt}</span>
              </legend>
              {question.options.map((option, optionIndex) => (
                <label key={optionIndex} className="mcq-option">
                  <input
                    type="radio"
                    name={question.id}
                    checked={chosenFor(question.id, question.chosen) === optionIndex}
                    onChange={() => choose(question.id, optionIndex)}
                  />
                  <span className="prose">{option}</span>
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ol>
    </div>
  );
}
