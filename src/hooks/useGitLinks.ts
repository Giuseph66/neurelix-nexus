import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { LinkTarefaInput, CreateBranchFromTarefaInput } from '@/types/codigo';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Hook para obter vínculos Git de uma tarefa
 */
export function useTarefaGitLinks(tarefaId: string | undefined) {
  return useQuery({
    queryKey: ['tarefa-git-links', tarefaId],
    queryFn: async () => {
      if (!tarefaId) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-links/tarefas/${tarefaId}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch git links');
      }

      return await response.json();
    },
    enabled: !!tarefaId,
  });
}

/**
 * Hook para criar/atualizar vínculo tarefa ↔ código
 */
export function useLinkTarefa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LinkTarefaInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-links`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to link tarefa');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tarefa-git-links', variables.tarefaId] });
      queryClient.invalidateQueries({ queryKey: ['tarefas'] });
      toast.success('Vínculo criado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao vincular tarefa');
    },
  });
}

/**
 * Hook para criar branch a partir de tarefa
 */
export function useCreateBranchFromTarefa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateBranchFromTarefaInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-links/create-branch`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create branch');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tarefa-git-links', variables.tarefaId] });
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success('Branch criada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao criar branch');
    },
  });
}


