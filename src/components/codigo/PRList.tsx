import { useState, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  GitPullRequest, 
  Search, 
  ExternalLink, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  GitBranch,
  MessageSquare,
  Loader2
} from 'lucide-react';
import { usePRs } from '@/hooks/usePRs';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { PullRequest } from '@/types/codigo';
import { CreatePRDialog } from './CreatePRDialog';

export function PRList() {
  const { repoId } = useParams<{ repoId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  
  // Extrair projectId da URL: /project/:projectId/code/...
  const projectIdMatch = location.pathname.match(/\/project\/([^/]+)/);
  const projectId = projectIdMatch ? projectIdMatch[1] : undefined;
  const [stateFilter, setStateFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [authorFilter, setAuthorFilter] = useState<string>('');

  console.log('PRList render:', { repoId, projectId, location: location.pathname });

  const { data, isLoading, error } = usePRs(repoId, {
    state: stateFilter === 'all' ? undefined : stateFilter,
    search: searchQuery || undefined,
    author: authorFilter || undefined,
  });

  console.log('PRList data:', { data, isLoading, error, repoId });

  const prs = data?.prs || [];

  // Extrair autores únicos para filtro
  const authors = useMemo(() => {
    const uniqueAuthors = new Set<string>();
    prs.forEach(pr => {
      if (pr.author_username) {
        uniqueAuthors.add(pr.author_username);
      }
    });
    return Array.from(uniqueAuthors).sort();
  }, [prs]);

  // Calcular resumo de reviews
  const getReviewSummary = (pr: PullRequest) => {
    if (!pr.reviews || pr.reviews.length === 0) {
      return { approved: 0, changesRequested: 0, commented: 0 };
    }
    return {
      approved: pr.reviews.filter(r => r.state === 'APPROVED').length,
      changesRequested: pr.reviews.filter(r => r.state === 'CHANGES_REQUESTED').length,
      commented: pr.reviews.filter(r => r.state === 'COMMENTED').length,
    };
  };

  // Verificar se PR precisa de review
  const needsReview = (pr: PullRequest) => {
    if (pr.state !== 'OPEN') return false;
    const summary = getReviewSummary(pr);
    return summary.approved === 0 && summary.changesRequested === 0;
  };

  // Verificar se checks estão falhando
  const hasFailingChecks = (pr: PullRequest) => {
    if (!pr.status_checks || pr.status_checks.length === 0) return false;
    return pr.status_checks.some(check => check.conclusion === 'FAILURE');
  };

  const handlePRClick = (pr: PullRequest) => {
    if (projectId && repoId) {
      navigate(`/project/${projectId}/code/repos/${repoId}/pull-requests/${pr.number}`);
    }
  };

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
          Erro ao carregar Pull Requests: {error instanceof Error ? error.message : 'Erro desconhecido'}
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Pull Requests</h1>
          <div className="flex items-center gap-2">
            {projectId && repoId && (
              <CreatePRDialog 
                repoId={repoId} 
                projectId={projectId}
              />
            )}
            {projectId && repoId && (
              <Button variant="outline" onClick={() => navigate(`/project/${projectId}/code/repos/${repoId}`)}>
                Voltar
              </Button>
            )}
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar PRs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={authorFilter || '__all__'} onValueChange={(value) => setAuthorFilter(value === '__all__' ? '' : value)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Todos os autores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os autores</SelectItem>
              {authors.map(author => (
                <SelectItem key={author} value={author || '__unknown_author__'}>
                  {author}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs e Lista */}
      <div className="flex-1 overflow-auto p-4">
        <Tabs value={stateFilter} onValueChange={(v) => setStateFilter(v as typeof stateFilter)}>
          <TabsList>
            <TabsTrigger value="open">Abertos</TabsTrigger>
            <TabsTrigger value="closed">Fechados</TabsTrigger>
            <TabsTrigger value="all">Todos</TabsTrigger>
          </TabsList>

          <TabsContent value={stateFilter} className="mt-4">
            {prs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <GitPullRequest className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {stateFilter === 'open' 
                    ? 'Nenhum Pull Request aberto' 
                    : stateFilter === 'closed'
                    ? 'Nenhum Pull Request fechado'
                    : 'Nenhum Pull Request encontrado'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {prs.map((pr) => {
                  const reviewSummary = getReviewSummary(pr);
                  const needsReviewBadge = needsReview(pr);
                  const failingChecks = hasFailingChecks(pr);

                  return (
                    <Card
                      key={pr.number}
                      className="cursor-pointer hover:border-primary transition-colors"
                      onClick={() => handlePRClick(pr)}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <CardTitle className="text-lg">
                                #{pr.number} {pr.title}
                              </CardTitle>
                              {pr.draft && (
                                <Badge variant="secondary">Draft</Badge>
                              )}
                              {needsReviewBadge && (
                                <Badge variant="outline" className="border-yellow-500 text-yellow-600">
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  Sem review
                                </Badge>
                              )}
                              {failingChecks && (
                                <Badge variant="destructive">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Checks falhando
                                </Badge>
                              )}
                              {reviewSummary.changesRequested > 0 && (
                                <Badge variant="outline" className="border-orange-500 text-orange-600">
                                  Changes requested
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                              <div className="flex items-center gap-2">
                                <Avatar className="h-5 w-5">
                                  <AvatarFallback>{pr.author_username?.[0]?.toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <span>{pr.author_username}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <GitBranch className="h-4 w-4" />
                                <span className="font-mono text-xs">
                                  {pr.target_branch} ← {pr.source_branch}
                                </span>
                              </div>
                              <span>
                                {formatDistanceToNow(new Date(pr.created_at), { addSuffix: true, locale: ptBR })}
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(pr.url, '_blank');
                            }}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {reviewSummary.approved > 0 && (
                            <div className="flex items-center gap-1 text-green-600">
                              <CheckCircle2 className="h-4 w-4" />
                              <span>{reviewSummary.approved} aprovado{reviewSummary.approved !== 1 ? 's' : ''}</span>
                            </div>
                          )}
                          {reviewSummary.changesRequested > 0 && (
                            <div className="flex items-center gap-1 text-orange-600">
                              <XCircle className="h-4 w-4" />
                              <span>{reviewSummary.changesRequested} alteração{reviewSummary.changesRequested !== 1 ? 'ões' : ''} solicitada{reviewSummary.changesRequested !== 1 ? 's' : ''}</span>
                            </div>
                          )}
                          {pr.comments_count !== undefined && pr.comments_count > 0 && (
                            <div className="flex items-center gap-1">
                              <MessageSquare className="h-4 w-4" />
                              <span>{pr.comments_count} comentário{pr.comments_count !== 1 ? 's' : ''}</span>
                            </div>
                          )}
                          {pr.linked_tarefas && pr.linked_tarefas.length > 0 && (
                            <div className="flex items-center gap-1 ml-auto">
                              {pr.linked_tarefas.map(tarefa => (
                                <Badge key={tarefa.id} variant="secondary" className="text-xs">
                                  {tarefa.key}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

