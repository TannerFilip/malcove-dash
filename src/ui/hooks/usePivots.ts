import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type PivotType } from '../lib/api';

export { type PivotEntry, type PivotRelatedHost, type PivotType, PIVOT_TYPES } from '../lib/api';

export function useHostPivots(hostId: string) {
  return useQuery({
    queryKey: ['pivots', hostId],
    queryFn: async () => {
      const res = await api.pivots.list(hostId);
      return res.data;
    },
  });
}

export function useExecutePivot(hostId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pivotType: PivotType) => api.pivots.execute(hostId, pivotType),
    onSuccess: () => {
      // Refresh pivots list and host list (new hosts may have been created)
      void qc.invalidateQueries({ queryKey: ['pivots', hostId] });
      void qc.invalidateQueries({ queryKey: ['hosts'] });
    },
  });
}

export function useValidinPdns(ip: string, enabled = true) {
  return useQuery({
    queryKey: ['validin', 'pdns', 'ip', ip],
    queryFn: async () => {
      const res = await api.validin.pdnsForIp(ip);
      return res.data.records;
    },
    enabled,
  });
}

export function useValidinDomainPdns(domain: string, enabled = true) {
  return useQuery({
    queryKey: ['validin', 'pdns', 'domain', domain],
    queryFn: async () => {
      const res = await api.validin.pdnsForDomain(domain);
      return res.data.records;
    },
    enabled,
  });
}
