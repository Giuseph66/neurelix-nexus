import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  GitPullRequest,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') + '/functions/v1';

export function ReviewInbox() {
  const { projectId, repoId } = useParams<{ projectId: string; repoId?: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['review-inbox', projectId, repoId],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      params.append('projectId', projectId || '');
      if (repoId) params.append('repoId', repoId);

      const response = await fetch(`${FUNCTIONS_URL}/github-pulls/reviews/inbox?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erro ao buscar reviews pendentes');
      }

      return await response.json();
    },
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-destructive">Erro ao carregar reviews pendentes</p>
      </div>
    );
  }

  const prs = data?.prs || [];
  const pendingCount = data?.pendingCount || 0;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b p-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Review Inbox</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {pendingCount} {pendingCount === 1 ? 'PR pendente' : 'PRs pendentes'} de review
            </p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {prs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12">
              <CheckCircle2 className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Nenhum PR pendente de review</p>
              <p className="text-sm text-muted-foreground mt-2">
                Todos os PRs foram revisados!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {prs.map((pr: any) => {
                const hasFailingChecks = pr.failing_checks_count > 0;
                const hasChangesRequested = pr.review_status?.changes_requested > 0;
                const isUrgent = hasFailingChecks || hasChangesRequested;

                return (
                  <Card 
                    key={pr.id} 
                    className={isUrgent ? "border-destructive/50 bg-destructive/5" : ""}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <CardTitle className="text-base">
                              <span className="font-mono text-muted-foreground">#{pr.number}</span>{' '}
                              {pr.title}
                            </CardTitle>
                            {isUrgent && (
                              <Badge variant="destructive" className="text-xs">
                                Urgente
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <GitPullRequest className="h-3 w-3" />
                              <span>{pr.repo?.fullName || pr.repo_id}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span>{pr.author_username}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              <span>
                                {formatDistanceToNow(new Date(pr.created_at), { addSuffix: true, locale: ptBR })}
                              </span>
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (projectId) {
                              navigate(`/project/${projectId}/code/repos/${pr.repo_id}/pull-requests/${pr.number}`);
                            }
                          }}
                        >
                          Revisar
                          <ArrowRight className="h-3 w-3 ml-2" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {/* Review Status */}
                        {pr.review_status && (
                          <div className="flex items-center gap-4 text-sm">
                            {pr.review_status.approved > 0 && (
                              <div className="flex items-center gap-1">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <span>{pr.review_status.approved} aprovado{pr.review_status.approved > 1 ? 's' : ''}</span>
                              </div>
                            )}
                            {pr.review_status.changes_requested > 0 && (
                              <div className="flex items-center gap-1">
                                <XCircle className="h-4 w-4 text-destructive" />
                                <span>{pr.review_status.changes_requested} com alterações solicitadas</span>
                              </div>
                            )}
                            {pr.review_status.commented > 0 && (
                              <div className="flex items-center gap-1">
                                <AlertCircle className="h-4 w-4 text-yellow-600" />
                                <span>{pr.review_status.commented} comentado{pr.review_status.commented > 1 ? 's' : ''}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Status Checks */}
                        {hasFailingChecks && (
                          <div className="flex items-center gap-2 text-sm text-destructive">
                            <XCircle className="h-4 w-4" />
                            <span>{pr.failing_checks_count} check{pr.failing_checks_count > 1 ? 's' : ''} falhando</span>
                          </div>
                        )}

                        {/* Branches */}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                          <span>{pr.target_branch}</span>
                          <span>←</span>
                          <span>{pr.source_branch}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

