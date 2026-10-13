import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createEngineRegistry } from './engines/registry.ts';
import { InterviewService } from './interviews/service.ts';
import { createRoundHandlers } from './rounds/registry.ts';
import { Store } from './store.ts';
import { TaskLibrary } from './tasks.ts';

const config = loadConfig();
await mkdir(config.engineDir, { recursive: true });

const store = new Store(config.dataDir);
await store.init();
const engines = createEngineRegistry(config.engineDir);
const interviews = new InterviewService(store, engines, createRoundHandlers(new TaskLibrary()));

const app = await buildApp({ engines, interviews, webDir: config.webDir, logger: { level: 'warn' } });

try {
  await app.listen({ host: config.host, port: config.port });
  const where = existsSync(config.webDir) ? `http://localhost:${config.port}` : 'http://localhost:5173 (dev)';
  console.log(`\nTrialRun AI is running. Open ${where}\n`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
