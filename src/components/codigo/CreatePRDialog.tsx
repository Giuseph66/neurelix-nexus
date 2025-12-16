import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GitPullRequest, Loader2 } from 'lucide-react';
import { useCreatePR } from '@/hooks/usePRs';
import { useBranches } from '@/hooks/useRepos';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface CreatePRDialogProps {
  repoId: string;
  projectId: string;
  defaultHead?: string;
  defaultBase?: string;
  trigger?: React.ReactNode;
}

export function CreatePRDialog({ repoId, projectId, defaultHead, defaultBase = 'main', trigger }: CreatePRDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [head, setHead] = useState(defaultHead || '');
  const [base, setBase] = useState(defaultBase);
  const [draft, setDraft] = useState(false);
  const hasPrefilledRef = useRef(false);

  const { data: branchesData } = useBranches(repoId);
  const branches = branchesData?.branches || [];
  const createPR = useCreatePR();
  const navigate = useNavigate();

  const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

  // Buscar commits quando head e base forem selecionados
  const { data: compareData, isLoading: isLoadingCommits } = useQuery({
    queryKey: ['compare-branches', repoId, base, head],
    queryFn: async () => {
      if (!repoId || !base || !head || base === head) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      params.append('base', base);
      params.append('head', head);

      const response = await fetch(`${FUNCTIONS_URL}/github-code/repos/${repoId}/compare?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to compare branches');
      }

      return await response.json();
    },
    enabled: !!repoId && !!base && !!head && base !== head,
  });

  // Resetar flag quando branches mudarem para permitir novo pré-preenchimento
  useEffect(() => {
    hasPrefilledRef.current = false;
  }, [head, base]);

  // Pré-preencher título e descrição quando commits forem carregados
  useEffect(() => {
    if (compareData?.commits && compareData.commits.length > 0 && !hasPrefilledRef.current) {
      const commits = compareData.commits;
      const lastCommit = commits[0]; // Primeiro commit é o mais recente
      
      // Título do último commit (primeira linha da mensagem)
      const lastCommitTitle = lastCommit.message.split('\n')[0].trim();
      setTitle(lastCommitTitle);

      // Descrição com todos os commits (um abaixo do outro)
      const commitsDescription = commits
        .map((commit: any) => {
          // Pegar apenas a primeira linha de cada commit (título do commit)
          const commitTitle = commit.message.split('\n')[0].trim();
          return `- ${commitTitle}`;
        })
        .join('\n');
      
      setDescription(commitsDescription);
      hasPrefilledRef.current = true;
    }
  }, [compareData]);

  // Resetar campos quando dialog fechar
  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setHead(defaultHead || '');
      setBase(defaultBase);
      setDraft(false);
      hasPrefilledRef.current = false;
    }
  }, [open, defaultHead, defaultBase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title || !head || !base) {
      return;
    }

    try {
      const pr = await createPR.mutateAsync({
        repoId,
        title,
        description,
        head,
        base,
        draft,
      });

      setOpen(false);
      // Campos serão resetados pelo useEffect quando open mudar

      // Navigate to the new PR
      navigate(`/project/${projectId}/code/repos/${repoId}/pull-requests/${pr.number}`);
    } catch (error) {
      // Error is handled by the hook
    }
  };

  const defaultTrigger = (
    <Button>
      <GitPullRequest className="h-4 w-4 mr-2" />
      Criar Pull Request
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar Pull Request</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="base">Branch base (destino)</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger id="base">
                <SelectValue placeholder="Selecione a branch base" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.name} value={branch.name}>
                    {branch.name}
                    {branch.is_default && ' (padrão)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="head">Branch de origem (head)</Label>
            <Select value={head} onValueChange={setHead}>
              <SelectTrigger id="head">
                <SelectValue placeholder="Selecione a branch de origem" />
              </SelectTrigger>
              <SelectContent>
                {branches
                  .filter(b => b.name !== base)
                  .map((branch) => (
                    <SelectItem key={branch.name} value={branch.name}>
                      {branch.name}
                      {branch.has_tarefa_key && ' (TSK-*)'}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Selecione a branch que contém as alterações que você deseja mesclar
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Título *</Label>
            <div className="relative">
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Adiciona funcionalidade de autenticação"
                required
                disabled={isLoadingCommits}
              />
              {isLoadingCommits && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            {compareData && compareData.commits && compareData.commits.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Pré-preenchido com o título do último commit ({compareData.commits.length} commit{compareData.commits.length > 1 ? 's' : ''})
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <div className="relative">
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva as mudanças deste PR..."
                rows={6}
                disabled={isLoadingCommits}
              />
              {isLoadingCommits && (
                <div className="absolute right-3 top-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            {compareData && compareData.commits && compareData.commits.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Pré-preenchido com os títulos dos commits ({compareData.commits.length} commit{compareData.commits.length > 1 ? 's' : ''})
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Dica: Use TSK-123 no título ou descrição para vincular automaticamente a uma tarefa
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="draft"
              checked={draft}
              onChange={(e) => setDraft(e.target.checked)}
              className="rounded border-gray-300"
            />
            <Label htmlFor="draft" className="text-sm font-normal cursor-pointer">
              Criar como rascunho (draft)
            </Label>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createPR.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createPR.isPending || !title || !head || !base || head === base}
            >
              {createPR.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <GitPullRequest className="h-4 w-4 mr-2" />
                  Criar Pull Request
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

