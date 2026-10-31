import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep previous data visible to avoid full-screen spinners on slow networks.
      // Individual pages can still opt into their own loading UI if needed.
      retry: 1,
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});
