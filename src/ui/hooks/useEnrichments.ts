import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * Mutation hook to manually enqueue enrichment job(s) for a host.
 * On success, invalidates the host detail query so the enrichments tab refreshes.
 */
export function useEnqueueEnrichment(hostId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sources?: string[]) => api.enrichments.enqueue(hostId, sources),
    onSuccess: () => {
      // The job runs asynchronously in the Worker — re-fetch the host detail
      // after a short delay to catch any fast-completing enrichments.
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['hosts', hostId] });
      }, 3000);
    },
  });
}
