import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export interface AvailableRepo {
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  description: string;
  url: string;
  updatedAt: string;
  selected: boolean;
}

/**
 * Hook para listar repositórios disponíveis
 */
export function useAvailableRepos(
  projectId: string | undefined,
  filters?: { org?: string; search?: string }
) {
  return useQuery({
    queryKey: ['available-repos', projectId, filters],
    queryFn: async () => {
      if (!projectId) return { repos: [], orgs: [] };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      params.append('projectId', projectId);
      if (filters?.org) params.append('org', filters.org);
      if (filters?.search) params.append('search', filters.search);

      const response = await fetch(`${FUNCTIONS_URL}/github-repos/available?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch available repos');
      }

      const data = await response.json();
      return data as { repos: AvailableRepo[]; orgs: string[]; nextCursor?: string };
    },
    enabled: !!projectId,
  });
}

/**
 * Hook para selecionar repositórios
 */
export function useSelectRepos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      selectedFullNames,
    }: {
      projectId: string;
      selectedFullNames: string[];
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-repos/select`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectId, selectedFullNames }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to select repos');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['available-repos', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['selected-repos', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['repos', variables.projectId] });
      toast.success(`${data.selected.length} repositórios selecionados!`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao selecionar repositórios');
    },
  });
}

/**
 * Hook para listar repositórios selecionados
 */
export function useSelectedRepos(projectId: string | undefined) {
  return useQuery({
    queryKey: ['selected-repos', projectId],
    queryFn: async () => {
      if (!projectId) return { repos: [] };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-repos/selected?projectId=${projectId}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch selected repos');
      }

      const data = await response.json();
      return data as { repos: any[] };
    },
    enabled: !!projectId,
  });
}

