import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, MoreVertical, Trash2, Loader2, MessageCircle, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { WhiteboardCanvas, WhiteboardCanvasRef } from "@/components/whiteboard/WhiteboardCanvas";
import { WhiteboardToolbar } from "@/components/whiteboard/WhiteboardToolbar";
import { PropertiesPanel } from "@/components/whiteboard/PropertiesPanel";
import { CollaboratorCursors } from "@/components/whiteboard/CollaboratorCursors";
import { CollaboratorAvatars } from "@/components/whiteboard/CollaboratorAvatars";
import { BranchMenu } from "@/components/whiteboard/BranchMenu";
import { CommentMarker } from "@/components/whiteboard/CommentMarker";
import { CommentThread } from "@/components/whiteboard/CommentThread";
import { NotificationBell } from "@/components/whiteboard/NotificationBell";
import { CanvasContextMenu } from "@/components/whiteboard/CanvasContextMenu";
import { BearAssistant } from "@/components/whiteboard/BearAssistant";
import { BearCursor } from "@/components/whiteboard/BearCursor";
import { ToolType, CanvasViewport } from "@/components/whiteboard/types";
import { useWhiteboard } from "@/hooks/useWhiteboard";
import { useWhiteboardKeyboard } from "@/hooks/useWhiteboardKeyboard";
import { useRealtimeWhiteboard } from "@/hooks/useRealtimeWhiteboard";
import { useWhiteboardPresence } from "@/hooks/useWhiteboardPresence";
import { useWhiteboardBranches } from "@/hooks/useWhiteboardBranches";
import { useWhiteboardComments } from "@/hooks/useWhiteboardComments";
import { useMentions } from "@/hooks/useMentions";
import { FabricObject, IText, Rect, Canvas as FabricCanvas } from "fabric";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function Whiteboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedWhiteboardId, setSelectedWhiteboardId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [zoom, setZoom] = useState(1);
  const [newBoardName, setNewBoardName] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [strokeColor, setStrokeColor] = useState("#f8fafc");
  const [fillColor, setFillColor] = useState("transparent");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selectedObject, setSelectedObject] = useState<FabricObject | null>(null);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [branches, setBranches] = useState<any[]>([]);
  const [activeCommentPosition, setActiveCommentPosition] = useState<{x: number, y: number} | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<WhiteboardCanvasRef>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const {
    whiteboards,
    whiteboard,
    objects,
    loading,
    saving,
    createWhiteboard,
    deleteWhiteboard,
    saveViewport,
    saveObjects,
    fetchWhiteboards,
  } = useWhiteboard({ 
    projectId: projectId || '', 
    whiteboardId: selectedWhiteboardId || undefined 
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  usePageTitle("Quadro Branco", project?.name);

  // Real-time collaboration - use a stable ref to prevent re-subscriptions
  const canvasInstanceRef = useRef<FabricCanvas | null>(null);
  
  useEffect(() => {
    canvasInstanceRef.current = canvasRef.current?.getCanvas() ?? null;
  }, [selectedWhiteboardId, loading]);

  const { saveObjectsRealtime } = useRealtimeWhiteboard({
    whiteboardId: selectedWhiteboardId,
    canvas: canvasInstanceRef.current,
    enabled: !!selectedWhiteboardId && !loading,
  });

  // User presence
  const { collaborators, userColor, updateCursor, currentUserId } = useWhiteboardPresence({
    whiteboardId: selectedWhiteboardId,
    enabled: !!selectedWhiteboardId && !loading,
  });

  // Branches
  const { createBranch, mergeBranch, getBranches, loading: branchLoading } = useWhiteboardBranches({
    projectId: projectId || '',
    onBranchCreated: (newId) => {
      fetchWhiteboards();
      setSelectedWhiteboardId(newId);
    },
  });

  // Comments
  const { 
    comments, 
    createComment, 
    deleteComment, 
    toggleResolved,
    getCommentsForObject,
  } = useWhiteboardComments({
    whiteboardId: selectedWhiteboardId,
    enabled: !!selectedWhiteboardId && !loading,
  });

  // Notifications/Mentions
  const { mentions, unreadCount, markAsRead, markAllAsRead } = useMentions();

  // Keyboard shortcuts
  useWhiteboardKeyboard({
    onToolChange: setActiveTool,
    onUndo: () => canvasRef.current?.undo(),
    onRedo: () => canvasRef.current?.redo(),
    onDelete: () => canvasRef.current?.deleteSelected(),
    onDuplicate: () => canvasRef.current?.duplicateSelected(),
    onSelectAll: () => canvasRef.current?.selectAll(),
    onCopy: () => canvasRef.current?.copy(),
    onPaste: () => canvasRef.current?.paste(),
    onZoomIn: () => canvasRef.current?.zoomIn(),
    onZoomOut: () => canvasRef.current?.zoomOut(),
    onZoomReset: () => canvasRef.current?.zoomReset(),
    enabled: !!selectedWhiteboardId && !loading,
  });

  // Load branches when whiteboard changes
  useEffect(() => {
    if (whiteboards.length > 0 && !selectedWhiteboardId) {
      setSelectedWhiteboardId(whiteboards[0].id);
    }
  }, [whiteboards, selectedWhiteboardId]);

  useEffect(() => {
    if (selectedWhiteboardId && !whiteboard?.parent_branch_id) {
      getBranches(selectedWhiteboardId).then(setBranches);
    } else {
      setBranches([]);
    }
  }, [selectedWhiteboardId, whiteboard?.parent_branch_id]);

  const handleCreateWhiteboard = async () => {
    if (!newBoardName.trim()) return;
    const wb = await createWhiteboard(newBoardName.trim());
    if (wb) {
      setSelectedWhiteboardId(wb.id);
      setNewBoardName('');
      setIsDialogOpen(false);
    }
  };

  const handleObjectsChange = useCallback((objects: FabricObject[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveObjects(objects);
      // Only call realtime save if enabled
      if (selectedWhiteboardId && !loading) {
        saveObjectsRealtime(objects);
      }
    }, 1000);
  }, [saveObjects, saveObjectsRealtime, selectedWhiteboardId, loading]);

  const handleViewportChange = useCallback((viewport: CanvasViewport) => {
    setZoom(viewport.zoom);
    setCanvasOffset({ x: viewport.x * viewport.zoom, y: viewport.y * viewport.zoom });
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => saveViewport(viewport), 500);
  }, [saveViewport]);

  // Handle cursor movement for presence
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert to canvas coordinates
    const vpt = canvas.viewportTransform;
    if (vpt) {
      const canvasX = (x - vpt[4]) / canvas.getZoom();
      const canvasY = (y - vpt[5]) / canvas.getZoom();
      updateCursor(canvasX, canvasY);
    }
  }, [updateCursor]);

  const handleMouseLeave = useCallback(() => {
    updateCursor(null, null);
  }, [updateCursor]);

  // Handle canvas click for comment mode
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!commentMode) return;
    
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const vpt = canvas.viewportTransform;
    if (vpt) {
      const canvasX = (x - vpt[4]) / canvas.getZoom();
      const canvasY = (y - vpt[5]) / canvas.getZoom();
      setActiveCommentPosition({ x: canvasX, y: canvasY });
      setCommentMode(false);
    }
  }, [commentMode]);

  const handlePropertiesUpdate = () => {
    canvasRef.current?.renderAll();
    const canvas = canvasRef.current?.getCanvas();
    if (canvas) {
      handleObjectsChange(canvas.getObjects());
    }
  };

  const handleToggleLock = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    const isLocked = obj.get('lockMovementX');
    obj.set({
      lockMovementX: !isLocked,
      lockMovementY: !isLocked,
      lockScalingX: !isLocked,
      lockScalingY: !isLocked,
      lockRotation: !isLocked,
    });
    canvas?.renderAll();
    handleObjectsChange(canvas?.getObjects() || []);
  }, [handleObjectsChange]);

  const handleFlipHorizontal = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    obj.set('flipX', !obj.flipX);
    canvas?.renderAll();
    handleObjectsChange(canvas?.getObjects() || []);
  }, [handleObjectsChange]);

  const handleFlipVertical = useCallback(() => {
    const canvas = canvasRef.current?.getCanvas();
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    obj.set('flipY', !obj.flipY);
    canvas?.renderAll();
    handleObjectsChange(canvas?.getObjects() || []);
  }, [handleObjectsChange]);

  // Handle creating elements from AI assistant
  const handleCreateElementsFromAI = useCallback((elements: any[]) => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;

    let offsetX = 100;
    let offsetY = 100;

    elements.forEach((el, index) => {
      if (el.type === 'postit') {
        const postit = new Rect({
          left: offsetX + (index * 180),
          top: offsetY,
          width: 150,
          height: 150,
          fill: el.color === 'yellow' ? '#fef08a' : el.color === 'blue' ? '#93c5fd' : el.color === 'green' ? '#86efac' : el.color === 'pink' ? '#f9a8d4' : '#fef08a',
          stroke: '#eab308',
          strokeWidth: 1,
          rx: 4,
          ry: 4,
        });
        canvas.add(postit);

        const text = new IText(el.text || 'Nota', {
          left: offsetX + (index * 180) + 10,
          top: offsetY + 10,
          fontSize: 12,
          fill: '#1e293b',
          fontFamily: 'Inter, sans-serif',
          width: 130,
        });
        canvas.add(text);
      } else if (el.type === 'text') {
        const text = new IText(el.content || 'Texto', {
          left: offsetX + (index * 200),
          top: offsetY + 200,
          fontSize: 16,
          fill: '#f8fafc',
          fontFamily: 'Inter, sans-serif',
        });
        canvas.add(text);
      }
    });

    canvas.renderAll();
    handleObjectsChange(canvas.getObjects());
  }, [handleObjectsChange]);

  // Group comments by position (for markers)
  const commentMarkers = comments
    .filter(c => c.position_x !== null && c.position_y !== null && !c.parent_comment_id)
    .reduce((acc, comment) => {
      const key = `${Math.round(comment.position_x! / 20)}-${Math.round(comment.position_y! / 20)}`;
      if (!acc[key]) {
        acc[key] = { x: comment.position_x!, y: comment.position_y!, comments: [], resolved: true };
      }
      acc[key].comments.push(comment);
      if (!comment.resolved) acc[key].resolved = false;
      return acc;
    }, {} as Record<string, { x: number; y: number; comments: typeof comments; resolved: boolean }>);

  if (!selectedWhiteboardId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <h2 className="text-xl font-semibold mb-4">Quadros Brancos</h2>
        <p className="text-muted-foreground mb-6">Nenhum quadro criado ainda.</p>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Criar Quadro</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo Quadro Branco</DialogTitle></DialogHeader>
            <div className="flex gap-2">
              <Input 
                placeholder="Nome do quadro" 
                value={newBoardName} 
                onChange={(e) => setNewBoardName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateWhiteboard()}
              />
              <Button onClick={handleCreateWhiteboard}>Criar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-full">
        {/* Sidebar com lista de quadros */}
        <div className="w-56 border-r bg-muted/30 flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <span className="font-medium text-sm">Quadros</span>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7"><Plus className="h-4 w-4" /></Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Novo Quadro</DialogTitle></DialogHeader>
                <div className="flex gap-2">
                  <Input 
                    placeholder="Nome do quadro" 
                    value={newBoardName} 
                    onChange={(e) => setNewBoardName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateWhiteboard()}
                  />
                  <Button onClick={handleCreateWhiteboard}>Criar</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {whiteboards.map((wb) => (
              <div 
                key={wb.id}
                className={`group flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-sm ${
                  selectedWhiteboardId === wb.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                }`}
                onClick={() => setSelectedWhiteboardId(wb.id)}
              >
                <div className="flex items-center gap-1.5 truncate">
                  {wb.parent_branch_id && <GitBranch className="h-3 w-3 flex-shrink-0" />}
                  <span className="truncate">{wb.branch_name || wb.name}</span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100">
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-popover">
                    <DropdownMenuItem onClick={() => deleteWhiteboard(wb.id)}>
                      <Trash2 className="h-4 w-4 mr-2" /> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas principal */}
        <div 
          ref={canvasContainerRef}
          className={`flex-1 relative ${commentMode ? 'cursor-crosshair' : ''}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleCanvasClick}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <WhiteboardToolbar
                activeTool={activeTool}
                onToolChange={setActiveTool}
                onUndo={() => canvasRef.current?.undo()}
                onRedo={() => canvasRef.current?.redo()}
                canUndo={canUndo}
                canRedo={canRedo}
                zoom={zoom}
                onZoomIn={() => canvasRef.current?.zoomIn()}
                onZoomOut={() => canvasRef.current?.zoomOut()}
                onZoomReset={() => canvasRef.current?.zoomReset()}
                strokeColor={strokeColor}
                onStrokeColorChange={setStrokeColor}
                fillColor={fillColor}
                onFillColorChange={setFillColor}
                strokeWidth={strokeWidth}
                onStrokeWidthChange={setStrokeWidth}
                onAddImage={(url) => canvasRef.current?.addImage(url)}
                onExportPNG={() => canvasRef.current?.exportPNG()}
                onExportSVG={() => canvasRef.current?.exportSVG()}
                onExportJSON={() => canvasRef.current?.exportJSON()}
              />
              
              {/* Top-right tools: Branch, Comments, Notifications, Collaborators */}
              <div className="absolute top-16 right-4 z-10 flex items-center gap-2">
                <BranchMenu
                  currentWhiteboard={whiteboard}
                  branches={branches}
                  onCreateBranch={async (name) => {
                    if (selectedWhiteboardId) {
                      await createBranch(selectedWhiteboardId, name);
                    }
                  }}
                  onMergeBranch={async () => {
                    if (selectedWhiteboardId && whiteboard?.parent_branch_id) {
                      await mergeBranch(selectedWhiteboardId, whiteboard.parent_branch_id);
                      setSelectedWhiteboardId(whiteboard.parent_branch_id);
                      fetchWhiteboards();
                    }
                  }}
                  onSelectBranch={setSelectedWhiteboardId}
                  loading={branchLoading}
                />
                
                <Button
                  variant={commentMode ? "default" : "ghost"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setCommentMode(!commentMode)}
                >
                  <MessageCircle className="h-4 w-4" />
                </Button>
                
                <NotificationBell
                  notifications={mentions}
                  unreadCount={unreadCount}
                  onMarkAsRead={markAsRead}
                  onMarkAllAsRead={markAllAsRead}
                  onNavigateToComment={(whiteboardId) => {
                    const wb = whiteboards.find(w => w.id === whiteboardId);
                    if (wb) {
                      setSelectedWhiteboardId(whiteboardId);
                    }
                  }}
                />
                
                <div className="w-px h-6 bg-border" />
                
                <CollaboratorAvatars 
                  collaborators={collaborators} 
                  currentUserColor={userColor} 
                />
              </div>

              <CanvasContextMenu
                selectedObject={selectedObject}
                onDuplicate={() => canvasRef.current?.duplicateSelected()}
                onDelete={() => canvasRef.current?.deleteSelected()}
                onCopy={() => canvasRef.current?.copy()}
                onPaste={() => canvasRef.current?.paste()}
                onBringForward={() => canvasRef.current?.bringForward()}
                onSendBackward={() => canvasRef.current?.sendBackward()}
                onToggleLock={handleToggleLock}
                onFlipHorizontal={handleFlipHorizontal}
                onFlipVertical={handleFlipVertical}
              >
                <WhiteboardCanvas
                  ref={canvasRef}
                  activeTool={activeTool}
                  strokeColor={strokeColor}
                  fillColor={fillColor}
                  strokeWidth={strokeWidth}
                  onObjectsChange={handleObjectsChange}
                  onViewportChange={handleViewportChange}
                  onSelectionChange={setSelectedObject}
                  initialViewport={whiteboard?.viewport}
                  initialObjects={objects}
                  onCanUndoChange={setCanUndo}
                  onCanRedoChange={setCanRedo}
                />
              </CanvasContextMenu>

              {/* Comment markers on canvas */}
              {Object.entries(commentMarkers).map(([key, marker]) => {
                const canvas = canvasRef.current?.getCanvas();
                if (!canvas) return null;
                const vpt = canvas.viewportTransform;
                if (!vpt) return null;
                
                const screenX = (marker.x * zoom) + vpt[4];
                const screenY = (marker.y * zoom) + vpt[5];
                
                return (
                  <CommentMarker
                    key={key}
                    x={screenX}
                    y={screenY}
                    count={marker.comments.length}
                    resolved={marker.resolved}
                    onClick={() => setActiveCommentPosition({ x: marker.x, y: marker.y })}
                  />
                );
              })}

              {/* Active comment thread */}
              {activeCommentPosition && (
                <div 
                  className="absolute z-20"
                  style={{
                    left: Math.min(
                      (activeCommentPosition.x * zoom) + (canvasRef.current?.getCanvas()?.viewportTransform?.[4] || 0) + 20,
                      window.innerWidth - 340
                    ),
                    top: Math.min(
                      (activeCommentPosition.y * zoom) + (canvasRef.current?.getCanvas()?.viewportTransform?.[5] || 0),
                      window.innerHeight - 450
                    ),
                  }}
                >
                  <CommentThread
                    comments={comments.filter(c => {
                      if (c.position_x === null || c.position_y === null) return false;
                      const dx = Math.abs(c.position_x - activeCommentPosition.x);
                      const dy = Math.abs(c.position_y - activeCommentPosition.y);
                      return dx < 30 && dy < 30;
                    })}
                    onClose={() => setActiveCommentPosition(null)}
                    onAddComment={async (content, parentId) => {
                      await createComment(
                        content,
                        undefined,
                        activeCommentPosition.x,
                        activeCommentPosition.y,
                        parentId
                      );
                    }}
                    onDeleteComment={deleteComment}
                    onResolve={toggleResolved}
                    currentUserId={currentUserId}
                    projectId={projectId}
                  />
                </div>
              )}

              {/* Collaborator cursors overlay */}
              <CollaboratorCursors 
                collaborators={collaborators}
                canvasOffset={canvasOffset}
                zoom={zoom}
              />

              {/* Bear cursor that follows mouse */}
              <BearCursor
                containerRef={canvasContainerRef}
                isActive={!isAssistantOpen && !commentMode}
                onClick={() => setIsAssistantOpen(true)}
              />

              {saving && (
                <div className="absolute bottom-4 right-4 bg-background/80 px-3 py-1.5 rounded-full text-xs flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
                </div>
              )}
              
              {commentMode && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm">
                  Clique no canvas para adicionar um comentário
                </div>
              )}
            </>
          )}
        </div>

        {/* Painel de propriedades */}
        {!loading && (
          <PropertiesPanel
            selectedObject={selectedObject}
            onUpdate={handlePropertiesUpdate}
            onDelete={() => canvasRef.current?.deleteSelected()}
            onDuplicate={() => canvasRef.current?.duplicateSelected()}
            onBringForward={() => canvasRef.current?.bringForward()}
            onSendBackward={() => canvasRef.current?.sendBackward()}
          />
        )}

        {/* Assistente IA Ursinho */}
        <BearAssistant
          isOpen={isAssistantOpen}
          onClose={() => setIsAssistantOpen(false)}
          onCreateElements={handleCreateElementsFromAI}
        />
      </div>
    </TooltipProvider>
  );
}
