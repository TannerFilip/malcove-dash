import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Host, HostObservation, Enrichment, Tag, TriageState } from '../../shared/types';

export interface HostFilters {
  triageState?: TriageState | undefined;
  asn?: number | undefined;
  runId?: string | undefined;
  tag?: string | undefined;
  onlyChanged?: boolean | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

/** Host with optional diff flags — present when the list is filtered by runId. */
export interface HostWithFlags extends Host {
  isNew?: boolean;
  isChanged?: boolean;
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
      // Build explicit string/number param map to satisfy api.hosts.list signature
      const params: Record<string, string | number | undefined> = {};
      if (filters.triageState) params['triageState'] = filters.triageState;
      if (filters.asn !== undefined) params['asn'] = filters.asn;
      if (filters.runId) params['runId'] = filters.runId;
      if (filters.tag) params['tag'] = filters.tag;
      if (filters.onlyChanged !== undefined) params['onlyChanged'] = filters.onlyChanged ? 'true' : 'false';
      if (filters.page !== undefined) params['page'] = filters.page;
      if (filters.pageSize !== undefined) params['pageSize'] = filters.pageSize;

      const res = await api.hosts.list(params);
      return {
        data: res.data as HostWithFlags[],
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
