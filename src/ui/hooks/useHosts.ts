import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Host, HostObservation, Enrichment, Tag, TriageState } from '../../shared/types';

export interface HostFilters {
  triageState?: TriageState | undefined;
  asn?: number | undefined;
  runId?: string | undefined;
  tag?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

interface HostDetail extends Host {
  observations: HostObservation[];
  enrichments: Enrichment[];
  tags: Tag[];
}

export function useHostList(filters: HostFilters = {}) {
  return useQuery({
    queryKey: ['hosts', filters],
    queryFn: async () => {
      const res = await api.hosts.list(filters as Record<string, string | number | undefined>);
      return {
        data: res.data as Host[],
        total: res.total,
        page: res.page,
        pageSize: res.pageSize,
      };
    },
  });
}

export function useHostDetail(id: string) {
  return useQuery({
    queryKey: ['hosts', id],
    queryFn: async () => {
      const res = await api.hosts.get(id);
      return res.data as HostDetail;
    },
  });
}

export function usePatchHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      triageState?: TriageState;
      notes?: string;
      snoozeUntil?: number | null;
    }) => api.hosts.patch(id, payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['hosts', vars.id] });
      qc.invalidateQueries({ queryKey: ['hosts'] });
    },
  });
}
