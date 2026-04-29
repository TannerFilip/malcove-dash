/**
 * Thin fetch wrapper. All API calls go through here so we have one place
 * to handle auth headers, base URL, and error normalisation.
 */

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: extraHeaders, ...rest } = init ?? {};
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });

  const json = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    const err = json['error'] as { code: string; message: string; details?: unknown } | undefined;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `HTTP ${res.status}`,
      err?.details,
    );
  }

  return json as T;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface CreateQueryPayload {
  name: string;
  queryString: string;
  source: 'shodan' | 'validin';
  tags?: string[];
  schedule?: string;
}

export interface RunResult {
  runId: string;
  totalCount: number;
  shodanTotal: number;
  newCount: number;
  changedCount: number;
  truncated: boolean;
}

export const api = {
  queries: {
    list: () => request<{ data: unknown[] }>('/queries'),
    get: (id: string) => request<{ data: unknown }>(`/queries/${id}`),
    create: (payload: CreateQueryPayload) =>
      request<{ data: unknown }>('/queries', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    delete: (id: string) =>
      request<{ data: { id: string } }>(`/queries/${id}`, { method: 'DELETE' }),
    run: (id: string) =>
      request<{ data: RunResult }>(`/queries/${id}/run`, { method: 'POST' }),
    runMatches: (
      queryId: string,
      runId: string,
      params: { onlyChanged?: boolean; page?: number; pageSize?: number } = {},
    ) => {
      const qs = new URLSearchParams();
      if (params.onlyChanged !== undefined) qs.set('onlyChanged', String(params.onlyChanged));
      if (params.page !== undefined) qs.set('page', String(params.page));
      if (params.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
      const q = qs.toString();
      return request<{
        data: unknown[];
        summary: { newCount: number; changedCount: number; unchangedCount: number; total: number };
        total: number;
        page: number;
        pageSize: number;
      }>(`/queries/${queryId}/runs/${runId}/matches${q ? `?${q}` : ''}`);
    },
  },
  hosts: {
    list: (params: Record<string, string | number | undefined>) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) qs.set(k, String(v));
      }
      const q = qs.toString();
      return request<{ data: unknown[]; total: number; page: number; pageSize: number }>(
        `/hosts${q ? `?${q}` : ''}`,
      );
    },
    get: (id: string) => request<{ data: unknown }>(`/hosts/${id}`),
    patch: (id: string, payload: { triageState?: string; notes?: string; snoozeUntil?: number | null }) =>
      request<{ data: unknown }>(`/hosts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  },
  runs: {
    get: (runId: string) => request<{ data: unknown }>(`/runs/${runId}`),
  },
  changes: {
    list: (params: { days?: number; page?: number; pageSize?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.days !== undefined) qs.set('days', String(params.days));
      if (params.page !== undefined) qs.set('page', String(params.page));
      if (params.pageSize !== undefined) qs.set('pageSize', String(params.pageSize));
      const q = qs.toString();
      return request<{ data: unknown[]; total: number; page: number; pageSize: number; days: number }>(
        `/changes${q ? `?${q}` : ''}`,
      );
    },
  },
  enrichments: {
    enqueue: (hostId: string, sources?: string[]) =>
      request<{ data: { queued: boolean; hostId: string; sources: string[] } }>('/enrichments', {
        method: 'POST',
        body: JSON.stringify({ hostId, sources }),
      }),
    ingest: (token: string, payload: { hostId: string; source: string; data: Record<string, unknown> }) =>
      request<{ data: { id: string } }>('/enrichments/ingest', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { Authorization: `Bearer ${token}` },
      }),
  },
};
