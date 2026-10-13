import type { RoundTypeId } from '../../../shared/types.ts';
import type { TaskLibrary } from '../tasks.ts';
import { AiTaskHandler } from './aiTask.ts';
import { CodeHandler } from './code.ts';
import { ConversationHandler } from './conversation.ts';
import type { RoundHandler } from './handler.ts';
import { McqHandler } from './mcq.ts';

export type RoundHandlers = Record<RoundTypeId, RoundHandler<any>>;

/** One handler per round type. A new round type is one new entry here. */
export function createRoundHandlers(tasks: TaskLibrary): RoundHandlers {
  return {
    intro: new ConversationHandler('intro'),
    knowledge: new ConversationHandler('knowledge'),
    behavioural: new ConversationHandler('behavioural'),
    system_design: new ConversationHandler('system_design'),
    code_review: new ConversationHandler('code_review'),
    mcq: new McqHandler(),
    coding: new CodeHandler('coding'),
    debugging: new CodeHandler('debugging'),
    ai_task: new AiTaskHandler(tasks),
  };
}
