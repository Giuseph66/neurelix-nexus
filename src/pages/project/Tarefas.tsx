import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { BoardList } from '@/components/tarefas/BoardList';
import { KanbanBoard } from '@/components/tarefas/KanbanBoard';
import { BacklogView } from '@/components/tarefas/BacklogView';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, LayoutDashboard, List } from 'lucide-react';
import { usePageTitle } from '@/hooks/usePageTitle';

export default function Tarefas() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedBoardId = searchParams.get('board');
  const activeTab = searchParams.get('view') || 'board';

  // Fetch project by id
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  usePageTitle("Tarefas", project?.name);

  const handleSelectBoard = (boardId: string) => {
    setSearchParams({ board: boardId, view: activeTab });
  };

  const handleBackToList = () => {
    setSearchParams({});
  };

  const handleTabChange = (tab: string) => {
    if (selectedBoardId) {
      setSearchParams({ board: selectedBoardId, view: tab });
    } else {
      setSearchParams({ view: tab });
    }
  };

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Projeto não encontrado
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {selectedBoardId ? (
        <>
          {/* Board Header */}
          <div className="border-b border-border bg-background">
            <div className="flex items-center gap-4 px-4 py-2">
              <Button variant="ghost" size="sm" onClick={handleBackToList}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar
              </Button>

              <Tabs value={activeTab} onValueChange={handleTabChange}>
                <TabsList>
                  <TabsTrigger value="board" className="gap-2">
                    <LayoutDashboard className="h-4 w-4" />
                    Board
                  </TabsTrigger>
                  <TabsTrigger value="backlog" className="gap-2">
                    <List className="h-4 w-4" />
                    Backlog
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'board' ? (
              <KanbanBoard boardId={selectedBoardId} projectId={project.id} />
            ) : (
              <BacklogView projectId={project.id} boardId={selectedBoardId} />
            )}
          </div>
        </>
      ) : (
        <BoardList projectId={project.id} onSelectBoard={handleSelectBoard} />
      )}
    </div>
  );
}
