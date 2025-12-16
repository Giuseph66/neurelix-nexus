import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Hook para iniciar OAuth GitHub
 */
export function useStartGitHubOAuth() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!user) throw new Error('Not authenticated');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-oauth/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start OAuth');
      }

      return await response.json();
    },
    onSuccess: (data) => {
      if (data.authorizeUrl) {
        // Redirect to GitHub
        window.location.href = data.authorizeUrl;
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao iniciar conexão GitHub');
    },
  });
}

/**
 * Hook para verificar status da conexão GitHub
 */
export function useGitHubConnection(projectId: string | undefined) {
  return useQuery({
    queryKey: ['github-connection', projectId],
    queryFn: async () => {
      if (!projectId) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-oauth/connection?projectId=${projectId}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch connection');
      }

      return await response.json();
    },
    enabled: !!projectId,
  });
}

/**
 * Hook para revogar conexão GitHub
 */
export function useRevokeGitHubConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-oauth/connection/revoke`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to revoke connection');
      }

      return await response.json();
    },
    onSuccess: (data, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['github-connection', projectId] });
      queryClient.invalidateQueries({ queryKey: ['repos', projectId] });
      toast.success('Conexão GitHub revogada');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao revogar conexão');
    },
  });
}

