import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound } from './errors.ts';
import { createInterviewSchema } from './interviews/plan.ts';
import type { InterviewService } from './interviews/service.ts';
import { isInterviewId } from './store.ts';

const MAX_CODE = 200_000;
const MAX_TEXT = 10_000;

const code = z.string().max(MAX_CODE);
const text = z.string().trim().min(1).max(MAX_TEXT);

const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('answer'), text }),
  z.object({ kind: z.literal('choose'), questionId: z.string().max(20), choice: z.number().int().min(0).max(20) }),
  z.object({ kind: z.literal('run'), code }),
  z.object({ kind: z.literal('submit_problem'), code }),
  z.object({ kind: z.literal('retry_next') }),
  z.object({ kind: z.literal('assistant'), message: text, code }),
  z.object({ kind: z.literal('agent'), message: text }),
  z.object({ kind: z.literal('save_file'), path: z.string().min(1).max(300), content: code }),
  z.object({ kind: z.literal('run_tests') }),
  z.object({ kind: z.literal('finish_work') }),
  z.object({ kind: z.literal('poll') }),
]);

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  throw badRequest(`${where}${issue?.message ?? 'Invalid request.'}`);
}

function interviewId(params: unknown): string {
  const id = (params as { id?: string }).id ?? '';
  // Ids become file paths, so anything that is not one of ours is simply unknown.
  if (!isInterviewId(id)) throw notFound('That interview');
  return id;
}

function roundIndex(params: unknown): number {
  const index = Number((params as { n?: string }).n);
  if (!Number.isInteger(index) || index < 0 || index > 50) throw notFound('That round');
  return index;
}

export function registerInterviewRoutes(app: FastifyInstance, interviews: InterviewService): void {
  app.get('/api/interviews', async () => ({ interviews: await interviews.list() }));

  app.post('/api/interviews', async (request, reply) => {
    const view = await interviews.create(parse(createInterviewSchema, request.body));
    return reply.code(201).send(view);
  });

  app.get('/api/interviews/:id', async (request) => interviews.get(interviewId(request.params)));

  app.delete('/api/interviews/:id', async (request, reply) => {
    await interviews.delete(interviewId(request.params));
    return reply.code(204).send();
  });

  app.post('/api/interviews/:id/rounds/:n/start', async (request) =>
    interviews.startRound(interviewId(request.params), roundIndex(request.params)),
  );

  app.post('/api/interviews/:id/rounds/:n/actions', async (request) =>
    interviews.act(interviewId(request.params), roundIndex(request.params), parse(actionSchema, request.body)),
  );

  app.post('/api/interviews/:id/rounds/:n/resume', async (request) =>
    interviews.resumeRound(interviewId(request.params), roundIndex(request.params)),
  );

  app.post('/api/interviews/:id/rounds/:n/submit', async (request) =>
    interviews.submitRound(interviewId(request.params), roundIndex(request.params)),
  );

  app.get('/api/interviews/:id/files', async (request) => ({ files: await interviews.workspaceFiles(interviewId(request.params)) }));

  app.get('/api/interviews/:id/files/content', async (request) => {
    const file = (request.query as { path?: string }).path;
    if (typeof file !== 'string' || file.length > 300) throw badRequest('Say which file with ?path=.');
    return interviews.workspaceFile(interviewId(request.params), file);
  });

  app.post('/api/interviews/:id/finish', async (request) => interviews.finish(interviewId(request.params)));

  app.post('/api/interviews/:id/answers', async (request) => interviews.answers(interviewId(request.params)));

  app.get('/api/interviews/:id/report', async (request) => interviews.report(interviewId(request.params)));
}
