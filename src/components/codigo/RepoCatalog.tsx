import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { GitBranch, GitPullRequest, Search, Star, Settings } from 'lucide-react';
import { useSelectedRepos } from '@/hooks/useSelectRepos';
import { useGitHubConnection } from '@/hooks/useGitHubOAuth';

interface RepoCatalogProps {
  projectId: string;
}

export function RepoCatalog({ projectId }: RepoCatalogProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const { data, isLoading, error } = useSelectedRepos(projectId);
  const { data: connection } = useGitHubConnection(projectId);

  const repos = data?.repos || [];
  const filteredRepos = repos.filter((repo) =>
    repo.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive">
        Erro ao carregar repositórios: {error instanceof Error ? error.message : 'Erro desconhecido'}
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Nenhum repositório selecionado</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {connection?.connected 
            ? 'Selecione os repositórios que deseja usar neste projeto'
            : 'Conecte GitHub para começar'}
        </p>
        {connection?.connected && (
          <Button onClick={() => navigate(`/project/${projectId}/code/select-repos`)}>
            Selecionar Repositórios
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar repositórios..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => navigate(`/project/${projectId}/code/select-repos`)}
        >
          Alterar seleção
        </Button>
        <Badge variant="secondary">{filteredRepos.length} repositórios</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredRepos.map((repo: Repo) => (
          <Card
            key={repo.id}
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={() => navigate(`/project/${projectId}/code/repos/${repo.id}`)}
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-base">{repo.full_name}</CardTitle>
                  <CardDescription className="mt-1 line-clamp-2">
                    {repo.description || 'Sem descrição'}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    // TODO: Implementar favoritar
                  }}
                >
                  <Star className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <GitBranch className="h-4 w-4" />
                  <span>{repo.branches_count || 0}</span>
                </div>
                <div className="flex items-center gap-1">
                  <GitPullRequest className="h-4 w-4" />
                  <span>{repo.open_prs_count || 0}</span>
                </div>
                <Badge variant="outline" className="ml-auto">
                  {repo.visibility}
                </Badge>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/project/${projectId}/code/repos/${repo.id}`);
                  }}
                >
                  Abrir
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    // TODO: Abrir configurações do repo
                  }}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}


