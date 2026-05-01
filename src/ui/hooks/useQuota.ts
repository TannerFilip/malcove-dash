import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useQuota() {
  return useQuery({
    queryKey: ['quota'],
    queryFn: () => api.quota.get(),
    // Refresh after every query run via manual invalidation; also recheck every 5 min
    staleTime: 5 * 60 * 1000,
  });
}
