import type { EngineId, SetupResponse } from '../../../shared/types.ts';
import { ClaudeEngine } from './claude.ts';
import { CodexEngine } from './codex.ts';
import type { Engine } from './engine.ts';

export class EngineRegistry {
  private readonly engines: Map<EngineId, Engine>;

  constructor(engines: Engine[]) {
    this.engines = new Map(engines.map((engine) => [engine.id, engine]));
  }

  get(id: EngineId): Engine | undefined {
    return this.engines.get(id);
  }

  async setup(): Promise<SetupResponse> {
    const engines = await Promise.all([...this.engines.values()].map((engine) => engine.status()));
    return { engines, ready: engines.some((engine) => engine.state === 'ready') };
  }
}

export function createEngineRegistry(engineDir: string): EngineRegistry {
  return new EngineRegistry([new ClaudeEngine(engineDir), new CodexEngine(engineDir)]);
}
