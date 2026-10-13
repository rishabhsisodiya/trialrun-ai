import type { InterviewController } from '../../hooks/useInterview.ts';

/** What every round screen receives. `view` is narrowed to the round's own mode by the caller. */
export interface RoundProps<V> {
  view: V;
  roundIndex: number;
  controller: InterviewController;
  /** True when the round is paused or otherwise not accepting input. */
  locked: boolean;
  /** Identifies this round across reloads, for drafts kept in the browser. */
  storageKey: string;
}
