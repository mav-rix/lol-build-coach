import { useQuery } from '@tanstack/react-query'
import { loadStaticData } from '@/services/ddragon'

/** Fetches and caches Data Dragon champions, items, and runes. */
export function useStaticData() {
  const query = useQuery({
    queryKey: ['ddragon-static'],
    queryFn: loadStaticData,
    staleTime: Infinity,
    retry: 2,
  })
  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    retry: query.refetch,
  }
}
