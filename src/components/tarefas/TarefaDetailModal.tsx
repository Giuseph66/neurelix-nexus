import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useTarefa,
  useTarefaComments,
  useTarefaActivity,
  useUpdateTarefa,
  useCreateComment,
} from '@/hooks/useTarefas';
import { PRIORITY_CONFIG, TYPE_CONFIG, type UpdateTarefaInput } from '@/types/tarefas';
import {
  Calendar,
  User,
  Tag,
  Clock,
  MessageSquare,
  History,
  ExternalLink,
  GitBranch,
  Layout,
  Send,
  Code2,
  GitPullRequest,
  GitCommit,
} from 'lucide-react';
import { useTarefaGitLinks } from '@/hooks/useTarefaGitLinks';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

interface TarefaDetailModalProps {
  tarefaId: string | null;
  onClose: () => void;
}

export function TarefaDetailModal({ tarefaId, onClose }: TarefaDetailModalProps) {
  const navigate = useNavigate();
  const { data: tarefa, isLoading: tarefaLoading } = useTarefa(tarefaId || undefined);
  const { data: comments, isLoading: commentsLoading } = useTarefaComments(tarefaId || undefined);
  const { data: activity, isLoading: activityLoading } = useTarefaActivity(tarefaId || undefined);
  const { data: gitLinksData, isLoading: gitLinksLoading } = useTarefaGitLinks(tarefaId || undefined);
  
  const updateTarefa = useUpdateTarefa();
  const createComment = useCreateComment();

  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [newComment, setNewComment] = useState('');

  const handleSave = async () => {
    if (!tarefaId) return;
    
    const input: UpdateTarefaInput = {};
    if (editedTitle !== tarefa?.title) input.title = editedTitle;
    if (editedDescription !== tarefa?.description) input.description = editedDescription;
    
    if (Object.keys(input).length > 0) {
      await updateTarefa.mutateAsync({ tarefaId, input });
    }
    setIsEditing(false);
  };

  const handleAddComment = async () => {
    if (!tarefaId || !newComment.trim()) return;
    
    await createComment.mutateAsync({
      tarefaId,
      input: { content: newComment },
    });
    setNewComment('');
  };

  const handleStartEdit = () => {
    setEditedTitle(tarefa?.title || '');
    setEditedDescription(tarefa?.description || '');
    setIsEditing(true);
  };

  if (!tarefaId) return null;

  const priorityConfig = tarefa ? PRIORITY_CONFIG[tarefa.priority] : null;
  const typeConfig = tarefa ? TYPE_CONFIG[tarefa.type] : null;

  return (
    <Dialog open={!!tarefaId} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
        {tarefaLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : tarefa ? (
          <>
            {/* Header */}
            <DialogHeader className="p-6 pb-0">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <span>{typeConfig?.icon}</span>
                <span className="font-mono font-medium">{tarefa.key}</span>
                <Badge variant="outline" style={{ borderColor: priorityConfig?.color, color: priorityConfig?.color }}>
                  {priorityConfig?.label}
                </Badge>
                {tarefa.status && (
                  <Badge style={{ backgroundColor: tarefa.status.color }}>
                    {tarefa.status.name}
                  </Badge>
                )}
              </div>
              
              {isEditing ? (
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="text-xl font-semibold"
                />
              ) : (
                <DialogTitle className="text-xl cursor-pointer hover:text-primary" onClick={handleStartEdit}>
                  {tarefa.title}
                </DialogTitle>
              )}
            </DialogHeader>

            <div className="flex-1 overflow-hidden flex">
              {/* Main Content */}
              <div className="flex-1 p-6 overflow-y-auto">
                {/* Description */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium mb-2">Descrição</h3>
                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editedDescription}
                        onChange={(e) => setEditedDescription(e.target.value)}
                        rows={5}
                        placeholder="Adicione uma descrição..."
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSave} disabled={updateTarefa.isPending}>
                          Salvar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="text-sm text-muted-foreground cursor-pointer hover:bg-muted/50 p-2 rounded min-h-[60px]"
                      onClick={handleStartEdit}
                    >
                      {tarefa.description || 'Clique para adicionar uma descrição...'}
                    </div>
                  )}
                </div>

                {/* Whiteboard Origin */}
                {tarefa.whiteboard_origin && (
                  <div className="mb-6 p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 text-sm">
                      <Layout className="h-4 w-4" />
                      <span className="font-medium">Origem: Quadro Branco</span>
                      <Button variant="link" size="sm" className="ml-auto">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Ver no Quadro
                      </Button>
                    </div>
                  </div>
                )}

                {/* Código (GitHub) */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Code2 className="h-4 w-4" />
                    Código (GitHub)
                  </h3>
                  {gitLinksLoading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : gitLinksData?.links && gitLinksData.links.length > 0 ? (
                    <div className="space-y-2">
                      {gitLinksData.links.map((link) => (
                        <div
                          key={link.id}
                          className="p-3 bg-muted/50 rounded-lg border border-border hover:bg-muted transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              {link.repo && (
                                <div className="text-sm font-medium mb-1 truncate">
                                  {link.repo.fullName}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                {link.branch && (
                                  <div className="flex items-center gap-1">
                                    <GitBranch className="h-3 w-3" />
                                    <span className="font-mono">{link.branch}</span>
                                  </div>
                                )}
                                {link.commitSha && (
                                  <div className="flex items-center gap-1">
                                    <GitCommit className="h-3 w-3" />
                                    <span className="font-mono">{link.commitSha.substring(0, 7)}</span>
                                  </div>
                                )}
                                {link.pr && (
                                  <div className="flex items-center gap-1">
                                    <GitPullRequest className="h-3 w-3" />
                                    <span>PR #{link.pr.number}</span>
                                    <Badge
                                      variant={
                                        link.pr.state === 'MERGED'
                                          ? 'default'
                                          : link.pr.state === 'CLOSED'
                                          ? 'secondary'
                                          : 'outline'
                                      }
                                      className="text-xs"
                                    >
                                      {link.pr.state}
                                    </Badge>
                                  </div>
                                )}
                                {link.autoLinked && (
                                  <Badge variant="outline" className="text-xs">
                                    Auto-link
                                  </Badge>
                                )}
                              </div>
                              {link.pr && (
                                <div className="text-xs text-muted-foreground mt-1 truncate">
                                  {link.pr.title}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {link.pr && tarefa?.project_id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    navigate(`/project/${tarefa.project_id}/code/repos/${link.repo?.id}/pull-requests/${link.pr?.number}`);
                                    onClose();
                                  }}
                                  title="Abrir no módulo Código"
                                >
                                  <Code2 className="h-4 w-4" />
                                </Button>
                              )}
                              {link.url && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => window.open(link.url!, '_blank')}
                                  title="Abrir no GitHub"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                          {link.pr && (
                            <div className="mt-2 pt-2 border-t border-border">
                              <div className="text-xs text-muted-foreground">
                                {link.pr.state === 'OPEN' && 'PR aberto'}
                                {link.pr.state === 'MERGED' && 'PR mergeado'}
                                {link.pr.state === 'CLOSED' && 'PR fechado'}
                                {link.pr.state === 'MERGED' && ' - Tarefa será atualizada automaticamente'}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                      Nenhum vínculo com código encontrado.
                      <br />
                      <span className="text-xs">
                        Crie branches, commits ou PRs com <code className="px-1 py-0.5 bg-muted rounded">TSK-{tarefa.key.split('-')[1]}</code> no nome para auto-link.
                      </span>
                    </div>
                  )}
                </div>

                {/* Tabs for Comments and Activity */}
                <Tabs defaultValue="comments">
                  <TabsList>
                    <TabsTrigger value="comments" className="gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Comentários
                    </TabsTrigger>
                    <TabsTrigger value="activity" className="gap-2">
                      <History className="h-4 w-4" />
                      Histórico
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="comments" className="mt-4">
                    {/* Add Comment */}
                    <div className="flex gap-2 mb-4">
                      <Textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Adicione um comentário..."
                        rows={2}
                        className="flex-1"
                      />
                      <Button
                        size="icon"
                        onClick={handleAddComment}
                        disabled={!newComment.trim() || createComment.isPending}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Comments List */}
                    <div className="space-y-4">
                      {commentsLoading ? (
                        <Skeleton className="h-20 w-full" />
                      ) : comments?.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          Nenhum comentário ainda
                        </p>
                      ) : (
                        comments?.map(comment => (
                          <div key={comment.id} className="flex gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={comment.author?.avatar_url} />
                              <AvatarFallback>
                                {comment.author?.full_name?.charAt(0) || '?'}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium">
                                  {comment.author?.full_name || 'Usuário'}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(new Date(comment.created_at), {
                                    addSuffix: true,
                                    locale: ptBR,
                                  })}
                                </span>
                              </div>
                              <p className="text-sm">{comment.content}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="activity" className="mt-4">
                    <ScrollArea className="h-[300px]">
                      <div className="space-y-3">
                        {activityLoading ? (
                          <Skeleton className="h-16 w-full" />
                        ) : activity?.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            Nenhuma atividade registrada
                          </p>
                        ) : (
                          activity?.map(log => (
                            <div key={log.id} className="flex gap-3 text-sm">
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={log.user?.avatar_url} />
                                <AvatarFallback className="text-xs">
                                  {log.user?.full_name?.charAt(0) || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <span className="font-medium">
                                  {log.user?.full_name || 'Usuário'}
                                </span>
                                {' '}
                                <span className="text-muted-foreground">
                                  {log.action === 'created' && 'criou esta tarefa'}
                                  {log.action === 'updated' && `alterou ${log.field_name}`}
                                  {log.action === 'transitioned' && `moveu para ${log.new_value}`}
                                  {log.action === 'commented' && 'adicionou um comentário'}
                                </span>
                                {log.action === 'updated' && log.old_value && (
                                  <span className="text-muted-foreground">
                                    {' '}de "{log.old_value}" para "{log.new_value}"
                                  </span>
                                )}
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {formatDistanceToNow(new Date(log.created_at), {
                                    addSuffix: true,
                                    locale: ptBR,
                                  })}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>

              {/* Sidebar */}
              <div className="w-64 border-l border-border p-4 bg-muted/30 space-y-4">
                {/* Assignee */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <User className="h-3 w-3" /> Responsável
                  </h4>
                  {tarefa.assignee ? (
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={tarefa.assignee.avatar_url} />
                        <AvatarFallback>{tarefa.assignee.full_name?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{tarefa.assignee.full_name}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Não atribuído</span>
                  )}
                </div>

                <Separator />

                {/* Reporter */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2">Relator</h4>
                  {tarefa.reporter ? (
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={tarefa.reporter.avatar_url} />
                        <AvatarFallback>{tarefa.reporter.full_name?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{tarefa.reporter.full_name}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </div>

                <Separator />

                {/* Due Date */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Data de Entrega
                  </h4>
                  <span className="text-sm">
                    {tarefa.due_date
                      ? format(new Date(tarefa.due_date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
                      : 'Não definida'}
                  </span>
                </div>

                <Separator />

                {/* Labels */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <Tag className="h-3 w-3" /> Labels
                  </h4>
                  {tarefa.labels.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {tarefa.labels.map(label => (
                        <Badge key={label} variant="secondary" className="text-xs">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Nenhuma</span>
                  )}
                </div>

                <Separator />

                {/* Estimated Hours */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Estimativa
                  </h4>
                  <span className="text-sm">
                    {tarefa.estimated_hours ? `${tarefa.estimated_hours}h` : 'Não estimada'}
                  </span>
                </div>

                <Separator />

                {/* Created/Updated */}
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>Criada: {format(new Date(tarefa.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</div>
                  <div>Atualizada: {format(new Date(tarefa.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-muted-foreground">
            Tarefa não encontrada
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
