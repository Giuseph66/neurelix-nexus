import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { File, Folder, ChevronRight, ChevronDown, Download, History, Loader2, GitPullRequest, Plus } from 'lucide-react';
import { useRepoTree, useRepoBlob, useBranches } from '@/hooks/useRepos';
import { usePRs } from '@/hooks/usePRs';
import { CreatePRDialog } from './CreatePRDialog';
import type { TreeEntry } from '@/types/codigo';

interface FileTreeItem extends TreeEntry {
  children?: FileTreeItem[];
  level?: number;
}

export function CodeBrowser() {
  const { repoId } = useParams<{ repoId: string }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const ref = searchParams.get('ref') || 'main';
  const selectedPath = searchParams.get('path') || '';
  const navigate = useNavigate();
  
  // Extrair projectId da URL
  const projectIdMatch = location.pathname.match(/\/project\/([^/]+)/);
  const projectId = projectIdMatch ? projectIdMatch[1] : undefined;

  const { data: branchesData } = useBranches(repoId);
  const { data: rootTreeData, isLoading: treeLoading } = useRepoTree(repoId, ref, '');
  const { data: blobData, isLoading: blobLoading } = useRepoBlob(
    repoId,
    ref,
    selectedPath && !selectedPath.endsWith('/') ? selectedPath : ''
  );
  
  // Get open PRs count for badge
  const { data: prsData } = usePRs(repoId, { state: 'open' });
  const openPRsCount = prsData?.prs?.length || 0;

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['']));
  const [loadedTrees, setLoadedTrees] = useState<Map<string, TreeEntry[]>>(new Map());

  const branches = branchesData?.branches || [];
  const isFile = selectedPath && blobData && !selectedPath.endsWith('/');

  // Construir árvore completa com níveis recursivamente
  const buildFileTree = useCallback((entries: TreeEntry[], basePath: string = '', level: number = 0): FileTreeItem[] => {
    if (!entries || entries.length === 0) return [];

    return entries
      .map(entry => {
        const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        const isExpanded = expandedPaths.has(entryPath);
        const childrenData = entry.type === 'tree' && isExpanded
          ? loadedTrees.get(entryPath) || []
          : [];

        const children = childrenData.length > 0
          ? buildFileTree(childrenData, entryPath, level + 1)
          : undefined;

        return {
          ...entry,
          path: entryPath,
          level,
          children,
        };
      })
      .sort((a, b) => {
        // Pastas primeiro (type === 'tree' ou 'dir')
        const aIsDir = (a.type === 'tree' || a.type === 'dir') as boolean;
        const bIsDir = (b.type === 'tree' || b.type === 'dir') as boolean;
        
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        // Depois ordenar alfabeticamente
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [expandedPaths, loadedTrees]);

  const fileTree = useMemo(() => {
    if (!rootTreeData?.tree || rootTreeData.tree.length === 0) return [];
    return buildFileTree(rootTreeData.tree);
  }, [rootTreeData, buildFileTree]);

  // Carregar árvores das pastas expandidas sob demanda
  useEffect(() => {
    if (!repoId) return;

    const pathsToLoad = Array.from(expandedPaths).filter(p => p && p !== '' && !loadedTrees.has(p));
    
    if (pathsToLoad.length > 0) {
      // Carregar todas as pastas pendentes (mas limitar a 3 simultâneas para performance)
      const pathsToLoadNow = pathsToLoad.slice(0, 3);
      
      pathsToLoadNow.forEach(pathToLoad => {
        const loadTree = async () => {
          try {
            const { supabase } = await import('@/integrations/supabase/client');
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
              const params = new URLSearchParams();
              params.append('ref', ref);
              params.append('path', pathToLoad);

              const url = `${FUNCTIONS_URL}/github-code/repos/${repoId}/tree?${params.toString()}`;

              const response = await fetch(url, {
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
              });

              if (response.ok) {
                const data = await response.json();
                setLoadedTrees(prev => {
                  // Verificar novamente se ainda não foi carregado (evitar race conditions)
                  if (prev.has(pathToLoad)) {
                    return prev;
                  }
                  const newMap = new Map(prev);
                  newMap.set(pathToLoad, data.tree || []);
                  return newMap;
                });
              } else {
                const errorText = await response.text();
                console.error('Failed to load tree:', response.status, pathToLoad, errorText);
              }
            }
          } catch (error) {
            console.error('Error loading tree:', error, pathToLoad);
          }
        };

        loadTree();
      });
    }
  }, [expandedPaths, ref, repoId]); // Removido loadedTrees das dependências para evitar loops

  const togglePath = useCallback((entryPath: string, isDirectory: boolean) => {
    if (!isDirectory) return;

    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(entryPath)) {
      newExpanded.delete(entryPath);
    } else {
      newExpanded.add(entryPath);
    }
    setExpandedPaths(newExpanded);
  }, [expandedPaths]);

  const handleFileClick = useCallback((entryPath: string, isDirectory: boolean) => {
    if (isDirectory) {
      togglePath(entryPath, true);
    } else {
      setSearchParams(prev => {
        const newParams = new URLSearchParams(prev);
        newParams.set('path', entryPath);
        return newParams;
      });
    }
  }, [togglePath, setSearchParams]);

  const handleBranchChange = useCallback((newRef: string) => {
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      newParams.set('ref', newRef);
      newParams.delete('path'); // Reset path ao mudar branch
      return newParams;
    });
    setExpandedPaths(new Set(['']));
    setLoadedTrees(new Map());
  }, [setSearchParams]);

  const renderTreeItem = useCallback((item: FileTreeItem) => {
    const isExpanded = expandedPaths.has(item.path);
    const isSelected = selectedPath === item.path;
    // GitHub API retorna 'dir' para pastas, não 'tree'
    const isDirectory = (item.type === 'tree' || item.type === 'dir') as boolean;
    const hasChildren = item.children && item.children.length > 0;
    const isLoading = isDirectory && isExpanded && !loadedTrees.has(item.path) && !hasChildren;

    return (
      <div key={item.path}>
        <div
          className={`flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-muted rounded transition-colors ${
            isSelected ? 'bg-primary/10 text-primary font-medium' : ''
          }`}
          style={{ paddingLeft: `${(item.level || 0) * 16 + 8}px` }}
          onClick={() => handleFileClick(item.path, isDirectory)}
        >
          {isDirectory ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePath(item.path, true);
                }}
                className="p-0.5 hover:bg-background rounded flex-shrink-0"
              >
                {isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                ) : isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
              <Folder className="h-4 w-4 text-blue-500 flex-shrink-0" />
            </>
          ) : (
            <>
              <div className="w-5 flex-shrink-0" />
              <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </>
          )}
          <span className="flex-1 truncate">{item.name}</span>
          {!isDirectory && item.size && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {(item.size / 1024).toFixed(1)} KB
            </span>
          )}
        </div>
        {isDirectory && isExpanded && (
          <div>
            {isLoading ? (
              <div className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${((item.level || 0) + 1) * 16 + 8}px` }}>
                Carregando...
              </div>
            ) : loadedTrees.has(item.path) ? (
              (() => {
                const childrenData = loadedTrees.get(item.path) || [];
                if (childrenData.length === 0) {
                  return (
                    <div className="px-2 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${((item.level || 0) + 1) * 16 + 8}px` }}>
                      Pasta vazia
                    </div>
                  );
                }
                const childrenTree = buildFileTree(childrenData, item.path, (item.level || 0) + 1);
                return childrenTree.map(child => renderTreeItem(child));
              })()
            ) : null}
          </div>
        )}
      </div>
    );
  }, [expandedPaths, selectedPath, handleFileClick, togglePath, loadedTrees]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-3 flex items-center justify-between bg-background">
        <div className="flex items-center gap-3">
          <Select value={ref} onValueChange={handleBranchChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.name} value={branch.name}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {projectId && repoId && (
            <>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => navigate(`/project/${projectId}/code/repos/${repoId}/pull-requests`)}
              >
                <GitPullRequest className="h-4 w-4 mr-2" />
                Pull Requests
                {openPRsCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {openPRsCount}
                  </Badge>
                )}
              </Button>
              <CreatePRDialog 
                repoId={repoId} 
                projectId={projectId}
                defaultHead={ref}
                trigger={
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Criar PR
                  </Button>
                }
              />
            </>
          )}
          {isFile && (
            <>
              <Button variant="outline" size="sm" onClick={() => {/* TODO: Ver histórico */}}>
                <History className="h-4 w-4 mr-2" />
                Histórico
              </Button>
              <Button variant="outline" size="sm" onClick={() => {/* TODO: Download */}}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </>
          )}
        </div>
        {selectedPath && (
          <div className="text-sm text-muted-foreground truncate max-w-md">
            {selectedPath}
          </div>
        )}
      </div>

      {/* Content: Sidebar + File View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - File Tree */}
        <div className="w-64 border-r bg-muted/30 flex flex-col">
          <div className="p-2 border-b text-xs font-semibold text-muted-foreground uppercase">
            Arquivos
          </div>
          <ScrollArea className="flex-1">
            {treeLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="p-1">
                {fileTree.map(item => renderTreeItem(item))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Main Content - File View */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {blobLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : isFile && blobData ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 flex-1 flex flex-col min-h-0">
                <div className="bg-[#1e1e1e] rounded-lg border flex flex-col h-full overflow-hidden">
                  <div className="px-4 py-2 border-b bg-[#252526] text-xs text-gray-400 flex-shrink-0">
                    {selectedPath}
                  </div>
                  <ScrollArea className="flex-1">
                    <pre className="p-4 text-sm text-gray-100 m-0 whitespace-pre overflow-x-auto">
                      <code className="block">{blobData.content}</code>
                    </pre>
                  </ScrollArea>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <File className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Selecione um arquivo para visualizar</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
