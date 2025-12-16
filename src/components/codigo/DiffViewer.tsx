import { useState, useMemo, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface DiffViewerProps {
  files: DiffFile[];
  onLineClick?: (file: string, line: number, side: 'old' | 'new') => void;
  selectedFile?: string;
  onFileSelect?: (filename: string) => void;
}

interface DiffLine {
  type: 'context' | 'added' | 'removed' | 'header';
  oldLine?: number;
  newLine?: number;
  content: string;
}

export function DiffViewer({ files, onLineClick, selectedFile, onFileSelect }: DiffViewerProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  
  // Auto-expand selected file
  useEffect(() => {
    if (selectedFile && !expandedFiles.has(selectedFile)) {
      setExpandedFiles(prev => new Set([...prev, selectedFile]));
    }
  }, [selectedFile, expandedFiles]);

  const parsedFiles = useMemo(() => {
    return files.map(file => {
      if (!file.patch) {
        return { ...file, lines: [] as DiffLine[] };
      }

      const lines: DiffLine[] = [];
      const patchLines = file.patch.split('\n');
      let oldLineNum = 0;
      let newLineNum = 0;
      let inHunk = false;

      for (const line of patchLines) {
        if (line.startsWith('@@')) {
          // Hunk header
          const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (match) {
            oldLineNum = parseInt(match[1]) - 1;
            newLineNum = parseInt(match[2]) - 1;
            inHunk = true;
            lines.push({ type: 'header', content: line });
          }
        } else if (inHunk) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            newLineNum++;
            lines.push({
              type: 'added',
              oldLine: undefined,
              newLine: newLineNum,
              content: line.substring(1),
            });
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            oldLineNum++;
            lines.push({
              type: 'removed',
              oldLine: oldLineNum,
              newLine: undefined,
              content: line.substring(1),
            });
          } else if (line.startsWith(' ')) {
            oldLineNum++;
            newLineNum++;
            lines.push({
              type: 'context',
              oldLine: oldLineNum,
              newLine: newLineNum,
              content: line.substring(1),
            });
          } else {
            lines.push({ type: 'context', content: line });
          }
        } else {
          lines.push({ type: 'context', content: line });
        }
      }

      return { ...file, lines };
    });
  }, [files]);

  const toggleFile = (filename: string) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(filename)) {
      newExpanded.delete(filename);
    } else {
      newExpanded.add(filename);
    }
    setExpandedFiles(newExpanded);
  };

  const handleLineClick = (file: string, line: DiffLine, side: 'old' | 'new') => {
    if (onLineClick && (line.oldLine || line.newLine)) {
      const lineNum = side === 'old' ? line.oldLine : line.newLine;
      if (lineNum) {
        onLineClick(file, lineNum, side);
      }
    }
  };

  const getFileStatusBadge = (status: string) => {
    switch (status) {
      case 'added':
        return <Badge className="bg-green-600">+{files.find(f => f.filename === selectedFile)?.additions || 0}</Badge>;
      case 'removed':
        return <Badge variant="destructive">-{files.find(f => f.filename === selectedFile)?.deletions || 0}</Badge>;
      case 'modified':
        return (
          <>
            <Badge className="bg-green-600">+{files.find(f => f.filename === selectedFile)?.additions || 0}</Badge>
            <Badge variant="destructive">-{files.find(f => f.filename === selectedFile)?.deletions || 0}</Badge>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* File List */}
      <div className="border-b p-2 bg-muted/30 flex-shrink-0">
        <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Arquivos alterados</div>
        <ScrollArea className="max-h-32">
          <div className="space-y-1">
            {files.map((file) => {
              const isSelected = selectedFile === file.filename;

              return (
                <div
                  key={file.filename}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-muted rounded transition-colors",
                    isSelected && "bg-primary/10 text-primary font-medium"
                  )}
                  onClick={() => {
                    onFileSelect?.(file.filename);
                  }}
                >
                  <span className="flex-1 truncate font-mono text-xs">{file.filename}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {file.status === 'added' && <Badge className="bg-green-600 text-xs">+{file.additions}</Badge>}
                    {file.status === 'removed' && <Badge variant="destructive" className="text-xs">-{file.deletions}</Badge>}
                    {file.status === 'modified' && (
                      <>
                        <Badge className="bg-green-600 text-xs">+{file.additions}</Badge>
                        <Badge variant="destructive" className="text-xs">-{file.deletions}</Badge>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Diff Content */}
      <ScrollArea className="flex-1">
        {selectedFile ? (
          (() => {
            const file = parsedFiles.find(f => f.filename === selectedFile);
            if (!file) {
              return (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <p>Arquivo não encontrado</p>
                </div>
              );
            }
            
            if (!file.lines || file.lines.length === 0) {
              return (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <p>Sem diff disponível para este arquivo</p>
                </div>
              );
            }

            return (
              <div className="p-4">
                <div className="bg-[#1e1e1e] rounded-lg overflow-hidden border">
                  <div className="px-4 py-2 border-b bg-[#252526] text-xs text-gray-400 flex items-center justify-between">
                    <span className="font-mono">{selectedFile}</span>
                    <div className="flex items-center gap-2">
                      {getFileStatusBadge(file.status)}
                    </div>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full border-collapse">
                      <tbody>
                        {file.lines.map((line, idx) => {
                          const lineNum = line.newLine || line.oldLine;
                          const side = line.newLine ? 'new' : 'old';
                          const isClickable = (line.type === 'added' || line.type === 'removed') && lineNum;

                          return (
                            <tr
                              key={idx}
                              className={cn(
                                "group",
                                line.type === 'added' && "bg-green-950/30",
                                line.type === 'removed' && "bg-red-950/30",
                                line.type === 'header' && "bg-[#252526]"
                              )}
                            >
                              {line.oldLine !== undefined && (
                                <td className="px-2 py-0.5 text-right text-xs text-gray-500 select-none border-r border-gray-700 w-12 bg-[#1e1e1e]">
                                  {line.type !== 'added' ? line.oldLine : ''}
                                </td>
                              )}
                              {line.newLine !== undefined && (
                                <td className="px-2 py-0.5 text-right text-xs text-gray-500 select-none border-r border-gray-700 w-12 bg-[#1e1e1e]">
                                  {line.type !== 'removed' ? line.newLine : ''}
                                </td>
                              )}
                              {line.oldLine === undefined && line.newLine === undefined && (
                                <td colSpan={2} className="px-2 py-0.5 text-xs text-gray-500 select-none border-r border-gray-700 bg-[#1e1e1e]"></td>
                              )}
                              <td
                                className={cn(
                                  "px-4 py-0.5 text-sm font-mono whitespace-pre",
                                  line.type === 'added' && "text-green-400",
                                  line.type === 'removed' && "text-red-400",
                                  line.type === 'header' && "text-gray-400",
                                  line.type === 'context' && "text-gray-300",
                                  isClickable && "cursor-pointer hover:bg-opacity-50"
                                )}
                                onClick={() => isClickable && handleLineClick(selectedFile, line, side)}
                              >
                                {line.type === 'added' && <Plus className="h-3 w-3 inline mr-1 text-green-400" />}
                                {line.type === 'removed' && <Minus className="h-3 w-3 inline mr-1 text-red-400" />}
                                {line.content}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Selecione um arquivo para ver o diff</p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

