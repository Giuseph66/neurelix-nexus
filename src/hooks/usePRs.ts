import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { PullRequest, CreatePRInput, SubmitReviewInput, MergePRInput } from '@/types/codigo';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Hook para listar Pull Requests
 */
export function usePRs(repoId: string | undefined, filters?: { state?: string; page?: number; author?: string; reviewer?: string; search?: string }) {
  return useQuery({
    queryKey: ['prs', repoId, filters],
    queryFn: async () => {
      if (!repoId) return { prs: [], page: 1 };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      if (filters?.state) params.append('state', filters.state);
      if (filters?.search) params.append('search', filters.search);
      if (filters?.author) params.append('author', filters.author);
      if (filters?.reviewer) params.append('reviewer', filters.reviewer);
      if (filters?.page) params.append('page', filters.page.toString());

      const response = await fetch(`${FUNCTIONS_URL}/github-pulls/repos/${repoId}/pulls?${params.toString()}`, {
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
 * Hook para obter detalhe de um PR por repoId e número
 */
export function usePR(repoId: string | undefined, prNumber: number | undefined) {
  return useQuery({
    queryKey: ['pr', repoId, prNumber],
    queryFn: async () => {
      if (!repoId || !prNumber) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-pulls/pulls/${repoId}/${prNumber}`, {
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
      return {
        pr: data.pr as PullRequest,
        linked_tarefas: data.linked_tarefas || [],
      };
    },
    enabled: !!repoId && !!prNumber,
  });
}

/**
 * Hook para submeter review
 */
export function useSubmitReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ repoId, prNumber, ...input }: { repoId: string; prNumber: number } & SubmitReviewInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-pulls/repos/${repoId}/pulls/${prNumber}/reviews`, {
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
      queryClient.invalidateQueries({ queryKey: ['pr', variables.repoId, variables.prNumber] });
      queryClient.invalidateQueries({ queryKey: ['prs', variables.repoId] });
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
    mutationFn: async ({ repoId, prNumber, ...input }: { repoId: string; prNumber: number } & MergePRInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-pulls/repos/${repoId}/pulls/${prNumber}/merge`, {
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
      queryClient.invalidateQueries({ queryKey: ['pr', variables.repoId, variables.prNumber] });
      queryClient.invalidateQueries({ queryKey: ['prs', variables.repoId] });
      queryClient.invalidateQueries({ queryKey: ['tarefas'] });
      toast.success('PR mergeado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao fazer merge');
    },
  });
}

/**
 * Hook para criar comentário geral no PR
 */
export function useCreatePRComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ repoId, prNumber, body }: { repoId: string; prNumber: number; body: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-pulls/repos/${repoId}/pulls/${prNumber}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create comment');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pr', variables.repoId, variables.prNumber] });
      toast.success('Comentário adicionado!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao adicionar comentário');
    },
  });
}

/**
 * Hook para criar novo Pull Request
 */
export function useCreatePR() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      repoId, 
      title, 
      description, 
      head, 
      base, 
      draft = false 
    }: { 
      repoId: string; 
      title: string; 
      description?: string; 
      head: string; 
      base: string; 
      draft?: boolean;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-pulls/repos/${repoId}/pulls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, description, head, base, draft }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao criar Pull Request');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['prs', variables.repoId] });
      queryClient.invalidateQueries({ queryKey: ['pr', variables.repoId] });
      toast.success('Pull Request criado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao criar Pull Request');
    },
  });
}

/**
 * Hook para criar comentário inline no PR
 */
export function useCreateInlineComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      repoId, 
      prNumber, 
      body, 
      path, 
      line, 
      side, 
      in_reply_to_id 
    }: { 
      repoId: string; 
      prNumber: number; 
      body: string; 
      path: string; 
      line: number; 
      side: 'LEFT' | 'RIGHT'; 
      in_reply_to_id?: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-pulls/repos/${repoId}/pulls/${prNumber}/inline-comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body, path, line, side, in_reply_to_id }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create inline comment');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pr', variables.repoId, variables.prNumber] });
      toast.success('Comentário inline adicionado!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao adicionar comentário inline');
    },
  });
}

/**
 * Hook para inbox de reviews
 */
export function useReviewInbox(projectId: string | undefined) {
  return useQuery({
    queryKey: ['review-inbox', projectId],
    queryFn: async () => {
      if (!projectId) return { prs: [], pendingCount: 0 };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-pulls/reviews/inbox?projectId=${projectId}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch review inbox');
      }

      return await response.json() as { prs: PullRequest[]; pendingCount: number };
    },
    enabled: !!projectId,
  });
}


