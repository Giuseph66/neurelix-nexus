import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Repo, RepoOverview, TreeEntry, BlobContent, Branch, Commit } from '@/types/codigo';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Hook para listar repositórios de um projeto
 */
export function useRepos(projectId: string | undefined) {
  return useQuery({
    queryKey: ['repos', projectId],
    queryFn: async () => {
      if (!projectId) return { repos: [] };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-repos?projectId=${projectId}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch repos');
      }

      const data = await response.json();
      return data as { repos: Repo[] };
    },
    enabled: !!projectId,
  });
}

/**
 * Hook para obter overview de um repositório
 */
export function useRepoOverview(repoId: string | undefined) {
  return useQuery({
    queryKey: ['repo-overview', repoId],
    queryFn: async () => {
      if (!repoId) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/git-repos/${repoId}/overview`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch overview');
      }

      const data = await response.json();
      return data as RepoOverview;
    },
    enabled: !!repoId,
  });
}

/**
 * Hook para obter árvore de arquivos
 */
export function useRepoTree(repoId: string | undefined, ref: string = 'main', path: string = '') {
  return useQuery({
    queryKey: ['repo-tree', repoId, ref, path],
    queryFn: async () => {
      if (!repoId) return { tree: [] };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      params.append('ref', ref);
      if (path) params.append('path', path);

      const response = await fetch(`${FUNCTIONS_URL}/github-code/repos/${repoId}/tree?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch tree');
      }

      const data = await response.json();
      return data as { tree: TreeEntry[] };
    },
    enabled: !!repoId,
  });
}

/**
 * Hook para obter conteúdo de arquivo (blob)
 */
export function useRepoBlob(repoId: string | undefined, ref: string = 'main', path: string = '') {
  return useQuery({
    queryKey: ['repo-blob', repoId, ref, path],
    queryFn: async () => {
      if (!repoId || !path) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      params.append('ref', ref);
      params.append('path', path);

      const response = await fetch(`${FUNCTIONS_URL}/github-code/repos/${repoId}/blob?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch blob');
      }

      const data = await response.json();
      return data as BlobContent;
    },
    enabled: !!repoId && !!path,
  });
}

/**
 * Hook para listar branches
 */
export function useBranches(repoId: string | undefined) {
  return useQuery({
    queryKey: ['branches', repoId],
    queryFn: async () => {
      if (!repoId) return { branches: [] };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-code/repos/${repoId}/branches`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch branches');
      }

      const data = await response.json();
      return data as { branches: Branch[] };
    },
    enabled: !!repoId,
  });
}

/**
 * Hook para listar commits
 */
export function useCommits(repoId: string | undefined, ref: string = 'main', page: number = 1, limit: number = 30) {
  return useQuery({
    queryKey: ['commits', repoId, ref, page, limit],
    queryFn: async () => {
      if (!repoId) return { commits: [], page: 1, limit: 30 };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      params.append('ref', ref);
      params.append('page', page.toString());
      params.append('limit', limit.toString());

      const response = await fetch(`${FUNCTIONS_URL}/github-code/repos/${repoId}/commits?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch commits');
      }

      const data = await response.json();
      return data as { commits: Commit[]; page: number; limit: number };
    },
    enabled: !!repoId,
  });
}

/**
 * Hook para obter detalhe de commit
 */
export function useCommitDetail(repoId: string | undefined, sha: string | undefined) {
  return useQuery({
    queryKey: ['commit-detail', repoId, sha],
    queryFn: async () => {
      if (!repoId || !sha) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${FUNCTIONS_URL}/github-code/repos/${repoId}/commits/${sha}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch commit');
      }

      return await response.json();
    },
    enabled: !!repoId && !!sha,
  });
}


