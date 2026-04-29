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
      request<{ data: { runId: string; totalCount: number; newCount: number; changedCount: number } }>(
        `/queries/${id}/run`,
        { method: 'POST' },
      ),
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
};
