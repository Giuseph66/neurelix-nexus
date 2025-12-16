import { useState, useEffect } from 'react';
import { useParams, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Plus, GitBranch, GitPullRequest, Code2, Settings, AlertCircle, X } from 'lucide-react';
import { ConnectGitWizard } from '@/components/codigo/ConnectGitWizard';
import { RepoCatalog } from '@/components/codigo/RepoCatalog';
import { CodeBrowser } from '@/components/codigo/CodeBrowser';
import { SelectReposPage } from '@/components/codigo/SelectReposPage';
import { useGitHubConnection } from '@/hooks/useGitHubOAuth';
import { useSelectedRepos } from '@/hooks/useSelectRepos';

export default function Code() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  
  const { data: connection, isLoading: connectionLoading, refetch: refetchConnection } = useGitHubConnection(projectId);
  const { data: selectedReposData } = useSelectedRepos(projectId);
  // Verificar se connected é true
  // Se connection existe mas connected é false, pode ser que a conexão não foi encontrada
  const hasConnection = connection?.connected === true;
  const hasSelectedRepos = (selectedReposData?.repos || []).length > 0;
  
  // Verificar se veio do callback OAuth
  const connected = searchParams.get('connected') === 'true';
  const errorMessage = searchParams.get('error');
  
  // Debug logs
  useEffect(() => {
    console.log('Code page state:', {
      projectId,
      hasConnection,
      connection,
      connectionConnected: connection?.connected,
      connectionLoading,
      connected,
      errorMessage,
      hasSelectedRepos,
      connectionString: JSON.stringify(connection),
    });
  }, [projectId, hasConnection, connection, connectionLoading, connected, errorMessage, hasSelectedRepos]);
  
  // Invalidar cache quando connected=true para atualizar a conexão
  useEffect(() => {
    if (connected && projectId) {
      console.log('Invalidating queries after OAuth callback');
      // Invalidar queries para forçar refetch
      queryClient.invalidateQueries({ queryKey: ['github-connection', projectId] });
      queryClient.invalidateQueries({ queryKey: ['repos', projectId] });
      // Forçar refetch imediato
      setTimeout(() => {
        refetchConnection();
      }, 500);
    }
  }, [connected, projectId, queryClient, refetchConnection]);
  
  // Remover parâmetros da URL após exibir
  useEffect(() => {
    if (errorMessage || connected) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('error');
      newParams.delete('connected');
      if (newParams.toString() !== searchParams.toString()) {
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [errorMessage, connected, searchParams, setSearchParams]);

  if (!projectId) {
    return <div>Projeto não encontrado</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b bg-background">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Tabs defaultValue="repos" className="w-auto">
              <TabsList>
                <TabsTrigger value="repos" onClick={() => navigate(`/project/${projectId}/code`)}>
                  <Code2 className="h-4 w-4 mr-2" />
                  Repositórios
                </TabsTrigger>
                <TabsTrigger value="prs" onClick={() => navigate(`/project/${projectId}/code/prs`)}>
                  <GitPullRequest className="h-4 w-4 mr-2" />
                  Pull Requests
                </TabsTrigger>
                <TabsTrigger value="reviews" onClick={() => navigate(`/project/${projectId}/code/reviews`)}>
                  <GitBranch className="h-4 w-4 mr-2" />
                  Reviews
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center gap-2">
            {!hasConnection && (
              <Button onClick={() => setIsConnectDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Conectar GitHub
              </Button>
            )}
            {hasConnection && !hasSelectedRepos && (
              <Button onClick={() => navigate(`/project/${projectId}/code/select-repos`)}>
                Selecionar Repositórios
              </Button>
            )}
            <Button variant="outline" size="icon" onClick={() => navigate(`/project/${projectId}/code/settings`)}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {/* Error Alert */}
        {errorMessage && (
          <div className="p-4 border-b">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erro ao conectar GitHub</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>{decodeURIComponent(errorMessage)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    const newParams = new URLSearchParams(searchParams);
                    newParams.delete('error');
                    setSearchParams(newParams, { replace: true });
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}
        
        {/* Success Alert */}
        {connected && !errorMessage && (
          <div className="p-4 border-b bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
            <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
              <AlertCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertTitle className="text-green-800 dark:text-green-200">GitHub conectado com sucesso!</AlertTitle>
              <AlertDescription className="text-green-700 dark:text-green-300 flex items-center justify-between">
                <span>Agora você pode selecionar os repositórios para usar neste projeto.</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-green-700 dark:text-green-300"
                  onClick={() => {
                    const newParams = new URLSearchParams(searchParams);
                    newParams.delete('connected');
                    setSearchParams(newParams, { replace: true });
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}

        <Routes>
          <Route index element={<Navigate to="repos" replace />} />
          <Route
            path="repos"
            element={
              <div className="h-full p-6">
                {hasSelectedRepos ? (
                  <RepoCatalog projectId={projectId} />
                ) : hasConnection ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Code2 className="h-16 w-16 text-muted-foreground mb-4" />
                    <h2 className="text-2xl font-semibold mb-2">Selecione os repositórios</h2>
                    <p className="text-muted-foreground mb-6 max-w-md">
                      Conectado como <strong>{connection?.username}</strong>. Selecione quais repositórios usar neste projeto.
                    </p>
                    <Button onClick={() => navigate(`/project/${projectId}/code/select-repos`)}>
                      Selecionar Repositórios
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Code2 className="h-16 w-16 text-muted-foreground mb-4" />
                    <h2 className="text-2xl font-semibold mb-2">Conecte seu GitHub</h2>
                    <p className="text-muted-foreground mb-6 max-w-md">
                      Conecte sua conta GitHub para começar a integrar código com tarefas e quadro branco
                    </p>
                    <Button onClick={() => setIsConnectDialogOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Conectar GitHub
                    </Button>
                  </div>
                )}
              </div>
            }
          />
          <Route
            path="select-repos"
            element={
              <div className="h-full">
                <SelectReposPage projectId={projectId || ''} />
              </div>
            }
          />
          <Route
            path="repos/:repoId"
            element={
              <div className="h-full">
                <CodeBrowser />
              </div>
            }
          />
          <Route
            path="repos/:repoId/tree"
            element={
              <div className="h-full">
                <CodeBrowser />
              </div>
            }
          />
          <Route
            path="repos/:repoId/branches"
            element={
              <div className="h-full p-6">
                <div className="text-center text-muted-foreground">
                  Branches - Em desenvolvimento
                </div>
              </div>
            }
          />
          <Route
            path="repos/:repoId/commits"
            element={
              <div className="h-full p-6">
                <div className="text-center text-muted-foreground">
                  Commits - Em desenvolvimento
                </div>
              </div>
            }
          />
          <Route
            path="repos/:repoId/commits/:sha"
            element={
              <div className="h-full p-6">
                <div className="text-center text-muted-foreground">
                  Commit Detail - Em desenvolvimento
                </div>
              </div>
            }
          />
          <Route
            path="prs"
            element={
              <div className="h-full p-6">
                <div className="text-center text-muted-foreground">
                  Pull Requests - Em desenvolvimento
                </div>
              </div>
            }
          />
          <Route
            path="prs/:prId"
            element={
              <div className="h-full p-6">
                <div className="text-center text-muted-foreground">
                  PR Detail - Em desenvolvimento
                </div>
              </div>
            }
          />
          <Route
            path="reviews"
            element={
              <div className="h-full p-6">
                <div className="text-center text-muted-foreground">
                  Code Review Inbox - Em desenvolvimento
                </div>
              </div>
            }
          />
          <Route
            path="settings"
            element={
              <div className="h-full p-6">
                <div className="text-center text-muted-foreground">
                  Configurações Git - Em desenvolvimento
                </div>
              </div>
            }
          />
        </Routes>
      </div>

      {/* Connect Git Dialog */}
      <ConnectGitWizard
        projectId={projectId}
        isOpen={isConnectDialogOpen}
        onClose={() => setIsConnectDialogOpen(false)}
        onSuccess={() => {
          setIsConnectDialogOpen(false);
        }}
      />
    </div>
  );
}
