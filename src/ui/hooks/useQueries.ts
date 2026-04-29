import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CreateQueryPayload, type RunResult } from '../lib/api';
import type { Query, QueryRun } from '../../shared/types';

// Response shapes — API returns `data` wrappers
interface QueryWithRuns extends Query {
  runs: QueryRun[];
}

export function useQueryList() {
  return useQuery({
    queryKey: ['queries'],
    queryFn: async () => {
      const res = await api.queries.list();
      return res.data as Query[];
    },
  });
}

export function useQueryDetail(id: string) {
  return useQuery({
    queryKey: ['queries', id],
    queryFn: async () => {
      const res = await api.queries.get(id);
      return res.data as QueryWithRuns;
    },
  });
}

export function useCreateQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateQueryPayload) => api.queries.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queries'] }),
  });
}

export function useDeleteQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.queries.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queries'] }),
  });
}

export function useRunQuery(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<{ data: RunResult }> => api.queries.run(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['queries', id] });
      qc.invalidateQueries({ queryKey: ['hosts'] });
    },
  });
}

/** Fetch the summary (counts, status) of a single run by runId. */
export function useRunSummary(runId?: string) {
  return useQuery({
    queryKey: ['runs', runId],
    queryFn: async () => {
      if (!runId) return null;
      const res = await api.runs.get(runId);
      return res.data as QueryRun;
    },
    enabled: !!runId,
  });
}
