import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ChangeEntry } from '../../api/routes/changes';

export { type ChangeEntry };

export interface ChangesFilters {
  days?: number;
  page?: number;
  pageSize?: number;
}

export function useChangesFeed(filters: ChangesFilters = {}) {
  return useQuery({
    queryKey: ['changes', filters],
    queryFn: async () => {
      const res = await api.changes.list(filters);
      return {
        data: res.data as ChangeEntry[],
        total: res.total,
        page: res.page,
        pageSize: res.pageSize,
        days: res.days,
      };
    },
  });
}
