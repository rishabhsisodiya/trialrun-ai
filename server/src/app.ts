import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ApiErrorBody } from '../../shared/types.ts';
import { catalog } from './catalog.ts';
import type { EngineRegistry } from './engines/registry.ts';
import { HttpError } from './errors.ts';
import type { InterviewService } from './interviews/service.ts';
import { registerInterviewRoutes } from './routes.ts';
import { isLocalRequest } from './security.ts';

export interface AppDeps {
  engines: EngineRegistry;
  /** Left out by tests that only exercise setup and catalog. */
  interviews?: InterviewService;
  /** Built web app. Skipped when the folder does not exist (dev, tests). */
  webDir?: string;
  logger?: boolean | { level: string };
}

function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });

  app.addHook('onRequest', async (request, reply) => {
    if (!isLocalRequest(request.headers)) {
      return reply.code(403).send(errorBody('forbidden', 'This server only answers requests from this machine.'));
    }
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) request.log.error(error);
    const message = status >= 500 ? 'Something went wrong on the server.' : error.message;
    return reply.code(status).send(errorBody(status >= 500 ? 'internal_error' : 'bad_request', message));
  });

  app.get('/api/setup', async () => deps.engines.setup());
  app.get('/api/catalog', async () => catalog);
  if (deps.interviews) registerInterviewRoutes(app, deps.interviews);

  const serveWeb = deps.webDir !== undefined && existsSync(deps.webDir);
  if (serveWeb) await app.register(fastifyStatic, { root: deps.webDir! });

  app.setNotFoundHandler((request, reply) => {
    if (serveWeb && request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send(errorBody('not_found', 'No such endpoint.'));
  });

  return app;
}
