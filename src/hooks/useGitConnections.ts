import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { ProviderConnection } from '@/types/codigo';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Hook para listar conexões Git de um projeto
 */
export function useConnections(projectId: string | undefined) {
  return useQuery({
    queryKey: ['git-connections', projectId],
    queryFn: async () => {
      if (!projectId) return { connections: [] };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-connect/connections?projectId=${projectId}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch connections');
      }

      const data = await response.json();
      return data as { connections: ProviderConnection[] };
    },
    enabled: !!projectId,
  });
}

/**
 * Hook para iniciar conexão Git
 */
export function useConnectGit() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ projectId, provider = 'github' }: { projectId: string; provider?: 'github' | 'bitbucket' }) => {
      if (!user) throw new Error('Not authenticated');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-connect/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectId, provider }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start connection');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['git-connections', variables.projectId] });
      toast.success('Redirecionando para GitHub...');
      // Redirect to GitHub App installation
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao conectar Git');
    },
  });
}

/**
 * Hook para processar callback de conexão
 */
export function useProcessCallback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      installationId,
      provider = 'github',
      ownerType,
      ownerName,
    }: {
      projectId: string;
      installationId: string;
      provider?: 'github' | 'bitbucket';
      ownerType?: 'user' | 'org';
      ownerName?: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-connect/callback`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          installationId,
          provider,
          ownerType,
          ownerName,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process callback');
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['git-connections', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['repos', variables.projectId] });
      toast.success('Conexão estabelecida com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao processar conexão');
    },
  });
}

/**
 * Hook para sincronizar repositórios
 */
export function useSyncRepos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ connectionId, repoId }: { connectionId?: string; repoId?: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      if (connectionId) params.append('connectionId', connectionId);
      if (repoId) params.append('repoId', repoId);

      const response = await fetch(`${FUNCTIONS_URL}/git-connect/sync?${params.toString()}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to sync');
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      queryClient.invalidateQueries({ queryKey: ['git-connections'] });
      toast.success('Sincronização iniciada');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao sincronizar');
    },
  });
}

/**
 * Hook para revogar conexão
 */
export function useRevokeConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-connect/connections/${connectionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to revoke connection');
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git-connections'] });
      toast.success('Conexão revogada');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao revogar conexão');
    },
  });
}


