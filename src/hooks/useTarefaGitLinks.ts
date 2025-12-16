import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export interface TarefaGitLink {
  id: string;
  branch: string | null;
  commitSha: string | null;
  prNumber: number | null;
  url: string | null;
  autoLinked: boolean;
  repo: {
    id: string;
    fullName: string;
    url: string;
  } | null;
  pr: {
    id: string;
    number: number;
    title: string;
    state: string;
    url: string;
  } | null;
}

export interface TarefaGitLinksData {
  links: TarefaGitLink[];
  whiteboardOrigin: {
    whiteboardId: string;
    nodeIds: string[];
  } | null;
}

/**
 * Hook para buscar links Git de uma tarefa
 */
export function useTarefaGitLinks(tarefaId: string | undefined) {
  return useQuery<TarefaGitLinksData>({
    queryKey: ['tarefa-git-links', tarefaId],
    queryFn: async () => {
      if (!tarefaId) throw new Error('Tarefa ID is required');

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

