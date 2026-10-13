import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Config {
  host: string;
  port: number;
  /** Everything the app writes lives under here. */
  dataDir: string;
  /** Empty folder the engines run in, so no project instructions leak into them. */
  engineDir: string;
  /** Built web app, served when it exists. */
  webDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.TRIALRUN_HOME ?? path.join(os.homedir(), '.trialrun-ai');
  return {
    // Loopback only: this server runs code and spends the user's plan.
    host: '127.0.0.1',
    port: Number(env.TRIALRUN_PORT ?? 4477),
    dataDir,
    engineDir: path.join(dataDir, 'engine'),
    webDir: path.resolve(here, '../../dist/web'),
  };
}
