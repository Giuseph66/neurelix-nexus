import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Github, CheckCircle2 } from 'lucide-react';
import { useStartGitHubOAuth, useGitHubConnection } from '@/hooks/useGitHubOAuth';

interface ConnectGitWizardProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ConnectGitWizard({ projectId, isOpen, onClose, onSuccess }: ConnectGitWizardProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const startOAuth = useStartGitHubOAuth();
  const { data: connection } = useGitHubConnection(projectId);

  // Verificar se já está conectado
  useEffect(() => {
    if (connection?.connected) {
      setStep(3);
    }
  }, [connection]);

  const handleConnect = async () => {
    try {
      await startOAuth.mutateAsync(projectId);
      // O redirect acontece automaticamente no hook
    } catch (error) {
      console.error('Error starting OAuth:', error);
    }
  };

  const handleGoToSelectRepos = () => {
    onClose();
    navigate(`/project/${projectId}/code/select-repos`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Conectar GitHub</DialogTitle>
          <DialogDescription>
            Conecte sua conta GitHub para integrar código com tarefas
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-4">
            <div className="text-center space-y-4">
              <Github className="h-16 w-16 mx-auto text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold mb-2">Conectar com GitHub</h3>
                <p className="text-sm text-muted-foreground">
                  Você será redirecionado para autorizar o acesso aos seus repositórios.
                  Após autorizar, poderá selecionar quais repositórios usar no projeto.
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button onClick={handleConnect} disabled={startOAuth.isPending}>
                {startOAuth.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Conectando...
                  </>
                ) : (
                  <>
                    <Github className="h-4 w-4 mr-2" />
                    Conectar com GitHub
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
            <h3 className="text-lg font-semibold">Conexão estabelecida!</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Conectado como <strong>{connection?.username}</strong>
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={onClose}>
                Fechar
              </Button>
              <Button onClick={handleGoToSelectRepos}>
                Selecionar Repositórios
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


