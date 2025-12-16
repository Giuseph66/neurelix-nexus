import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { PullRequest, CreatePRInput, SubmitReviewInput, MergePRInput } from '@/types/codigo';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Hook para listar Pull Requests
 */
export function usePRs(repoId: string | undefined, filters?: { state?: string; page?: number }) {
  return useQuery({
    queryKey: ['prs', repoId, filters],
    queryFn: async () => {
      if (!repoId) return { prs: [], page: 1 };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      params.append('repoId', repoId);
      if (filters?.state) params.append('state', filters.state);
      if (filters?.page) params.append('page', filters.page.toString());

      const response = await fetch(`${FUNCTIONS_URL}/git-prs?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch PRs');
      }

      const data = await response.json();
      return data as { prs: PullRequest[]; page: number };
    },
    enabled: !!repoId,
  });
}

/**
 * Hook para obter detalhe de um PR
 */
export function usePR(prId: string | undefined) {
  return useQuery({
    queryKey: ['pr', prId],
    queryFn: async () => {
      if (!prId) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-prs/${prId}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch PR');
      }

      const data = await response.json();
      return data.pr as PullRequest;
    },
    enabled: !!prId,
  });
}

/**
 * Hook para criar Pull Request
 */
export function useCreatePR() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreatePRInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-prs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create PR');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['prs', variables.repoId] });
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      toast.success('Pull Request criada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao criar PR');
    },
  });
}

/**
 * Hook para submeter review
 */
export function useSubmitReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ prId, ...input }: { prId: string } & SubmitReviewInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-prs/${prId}/reviews`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to submit review');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pr', variables.prId] });
      queryClient.invalidateQueries({ queryKey: ['prs'] });
      toast.success('Review submetido com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao submeter review');
    },
  });
}

/**
 * Hook para fazer merge de PR
 */
export function useMergePR() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ prId, ...input }: { prId: string } & MergePRInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-prs/${prId}/merge`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to merge PR');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pr', variables.prId] });
      queryClient.invalidateQueries({ queryKey: ['prs'] });
      queryClient.invalidateQueries({ queryKey: ['tarefas'] });
      toast.success('PR mergeado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao fazer merge');
    },
  });
}


