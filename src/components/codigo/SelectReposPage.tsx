import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, Github, Lock, Globe, Loader2, CheckCircle2 } from 'lucide-react';
import { useAvailableRepos, useSelectRepos, type AvailableRepo } from '@/hooks/useSelectRepos';
import { useGitHubConnection } from '@/hooks/useGitHubOAuth';

interface SelectReposPageProps {
  projectId: string;
}

export function SelectReposPage({ projectId }: SelectReposPageProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<string>('__all__');
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: connection } = useGitHubConnection(projectId);
  const { data, isLoading, error } = useAvailableRepos(projectId, {
    org: selectedOrg === '__all__' ? undefined : selectedOrg,
    search: searchQuery || undefined,
  });
  const selectRepos = useSelectRepos();

  const repos = data?.repos || [];
  const orgs = data?.orgs || [];

  // Carregar repos já selecionados
  useEffect(() => {
    if (repos.length > 0) {
      const alreadySelected = repos.filter((r) => r.selected).map((r) => r.fullName);
      setSelectedRepos(new Set(alreadySelected));
    }
  }, [repos]);

  // Verificar se está conectado
  useEffect(() => {
    if (!connection?.connected) {
      navigate(`/project/${projectId}/code`);
    }
  }, [connection, projectId, navigate]);

  const handleToggleRepo = (fullName: string) => {
    const newSelected = new Set(selectedRepos);
    if (newSelected.has(fullName)) {
      newSelected.delete(fullName);
    } else {
      newSelected.add(fullName);
    }
    setSelectedRepos(newSelected);
  };

  const handleSelectAll = () => {
    const allRepos = repos.map((r) => r.fullName);
    setSelectedRepos(new Set(allRepos));
  };

  const handleDeselectAll = () => {
    setSelectedRepos(new Set());
  };

  const handleConfirm = async () => {
    if (selectedRepos.size === 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      await selectRepos.mutateAsync({
        projectId,
        selectedFullNames: Array.from(selectedRepos),
      });
      navigate(`/project/${projectId}/code`);
    } catch (error) {
      console.error('Error selecting repos:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredRepos = useMemo(() => {
    if (!searchQuery && selectedOrg === '__all__') return repos;
    
    return repos.filter((repo) => {
      const matchesSearch = !searchQuery || 
        repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        repo.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        repo.description?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesOrg = selectedOrg === '__all__' || repo.owner === selectedOrg;
      
      return matchesSearch && matchesOrg;
    });
  }, [repos, searchQuery, selectedOrg]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <p className="text-destructive mb-4">
          Erro ao carregar repositórios: {error instanceof Error ? error.message : 'Erro desconhecido'}
        </p>
        <Button variant="outline" onClick={() => navigate(`/project/${projectId}/code`)}>
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold">Selecione os repositórios</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Escolha quais repositórios GitHub você quer usar neste projeto
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate(`/project/${projectId}/code`)}>
            Cancelar
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar repositórios..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={selectedOrg} onValueChange={setSelectedOrg}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Todas as organizações" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as organizações</SelectItem>
              {orgs.map((org) => (
                <SelectItem key={org} value={org || '__unknown__'}>
                  {org || 'Sem organização'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={handleSelectAll}>
            Selecionar todos
          </Button>
          <Button variant="outline" size="sm" onClick={handleDeselectAll}>
            Desmarcar todos
          </Button>
          <Badge variant="secondary" className="ml-auto">
            {selectedRepos.size} selecionado{selectedRepos.size !== 1 ? 's' : ''}
          </Badge>
        </div>
      </div>

      {/* Repos Grid */}
      <div className="flex-1 overflow-auto p-6">
        {filteredRepos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Github className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {searchQuery || selectedOrg ? 'Nenhum repositório encontrado' : 'Nenhum repositório disponível'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRepos.map((repo: AvailableRepo) => (
              <Card
                key={repo.fullName}
                className={`cursor-pointer transition-all hover:border-primary ${
                  selectedRepos.has(repo.fullName) ? 'border-primary bg-primary/5' : ''
                }`}
                onClick={() => handleToggleRepo(repo.fullName)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Github className="h-4 w-4" />
                        {repo.name}
                      </CardTitle>
                      <CardDescription className="mt-1 text-xs">
                        {repo.owner}
                      </CardDescription>
                    </div>
                    <Checkbox
                      checked={selectedRepos.has(repo.fullName)}
                      onCheckedChange={() => handleToggleRepo(repo.fullName)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {repo.description || 'Sem descrição'}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {repo.private ? (
                      <Lock className="h-3 w-3" />
                    ) : (
                      <Globe className="h-3 w-3" />
                    )}
                    <span>{repo.defaultBranch}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t p-4 bg-background">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedRepos.size > 0 ? (
              <span>
                {selectedRepos.size} repositório{selectedRepos.size !== 1 ? 's' : ''} selecionado{selectedRepos.size !== 1 ? 's' : ''}
              </span>
            ) : (
              <span>Selecione pelo menos um repositório</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/project/${projectId}/code`)}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={selectedRepos.size === 0 || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Confirmar seleção
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

