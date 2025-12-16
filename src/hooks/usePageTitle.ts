import { useEffect } from 'react';

/**
 * Hook para definir o título da página
 * @param title - Título da página (será formatado como "Título - NEURELIX NEXUS")
 * @param projectName - Nome do projeto (opcional, será incluído no título)
 */
export function usePageTitle(title: string, projectName?: string | null) {
  useEffect(() => {
    const fullTitle = projectName 
      ? `${title} - ${projectName} - NEURELIX NEXUS`
      : `${title} - NEURELIX NEXUS`;
    
    document.title = fullTitle;

    // Cleanup: restaurar título padrão quando componente desmontar
    return () => {
      document.title = 'NEURELIX NEXUS';
    };
  }, [title, projectName]);
}

