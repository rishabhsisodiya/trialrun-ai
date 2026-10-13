import type {
  ApiErrorBody,
  CatalogResponse,
  CreateInterviewRequest,
  InterviewSummary,
  InterviewView,
  Report,
  RoundAction,
  SetupResponse,
  WorkspaceFile,
} from '../../shared/types.ts';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError('unreachable', 'Could not reach the TrialRun AI server. Is it still running?');
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(failure?.error.code ?? 'http_error', failure?.error.message ?? `Request failed (${response.status}).`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const round = (id: string, index: number) => `/api/interviews/${id}/rounds/${index}`;

export const api = {
  setup: (signal: AbortSignal) => request<SetupResponse>('GET', '/api/setup', undefined, signal),
  catalog: (signal: AbortSignal) => request<CatalogResponse>('GET', '/api/catalog', undefined, signal),
  interviews: (signal: AbortSignal) =>
    request<{ interviews: InterviewSummary[] }>('GET', '/api/interviews', undefined, signal).then((body) => body.interviews),
  create: (input: CreateInterviewRequest) => request<InterviewView>('POST', '/api/interviews', input),
  interview: (id: string, signal?: AbortSignal) => request<InterviewView>('GET', `/api/interviews/${id}`, undefined, signal),
  remove: (id: string) => request<void>('DELETE', `/api/interviews/${id}`),
  startRound: (id: string, index: number) => request<InterviewView>('POST', `${round(id, index)}/start`),
  act: (id: string, index: number, action: RoundAction) => request<InterviewView>('POST', `${round(id, index)}/actions`, action),
  resumeRound: (id: string, index: number) => request<InterviewView>('POST', `${round(id, index)}/resume`),
  submitRound: (id: string, index: number) => request<InterviewView>('POST', `${round(id, index)}/submit`),
  finish: (id: string) => request<Report>('POST', `/api/interviews/${id}/finish`),
  files: (id: string) => request<{ files: string[] }>('GET', `/api/interviews/${id}/files`).then((body) => body.files),
  file: (id: string, path: string) => request<WorkspaceFile>('GET', `/api/interviews/${id}/files/content?path=${encodeURIComponent(path)}`),
  /** Writes the answer sheet for rounds that do not have one yet. */
  answers: (id: string) => request<Report>('POST', `/api/interviews/${id}/answers`),
  report: (id: string, signal: AbortSignal) => request<Report>('GET', `/api/interviews/${id}/report`, undefined, signal),
};

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
