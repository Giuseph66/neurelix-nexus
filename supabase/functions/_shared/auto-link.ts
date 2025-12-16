// Shared utilities for auto-linking tarefas by TSK-123 pattern

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Detecta padrões TSK-123 no texto e retorna as chaves encontradas
 */
export function detectTarefaKeys(text: string): string[] {
  if (!text) return [];
  
  // Regex para encontrar TSK- seguido de números ou letras-números
  // Padrões: TSK-123, TSK-ABC-123, TSK-123-feature, etc.
  const regex = /TSK-([A-Z0-9]+(?:-[A-Z0-9]+)*)/gi;
  const matches = text.matchAll(regex);
  const keys = new Set<string>();
  
  for (const match of matches) {
    const fullKey = `TSK-${match[1]}`;
    keys.add(fullKey);
  }
  
  return Array.from(keys);
}

/**
 * Cria links automáticos entre tarefas e entidades Git
 */
export async function createAutoLinks(
  tarefaKeys: string[],
  projectId: string,
  repoId: string,
  entityType: "branch" | "commit" | "pull_request",
  entityId: string,
  metadata: {
    branchName?: string;
    commitSha?: string;
    prNumber?: number;
    detectedFrom?: string;
  }
): Promise<void> {
  if (tarefaKeys.length === 0) return;

  // Buscar tarefas pelo key no projeto
  const { data: tarefas } = await supabase
    .from("tarefas")
    .select("id, key")
    .eq("project_id", projectId)
    .in("key", tarefaKeys);

  if (!tarefas || tarefas.length === 0) return;

  // Criar links para cada tarefa encontrada
  for (const tarefa of tarefas) {
    // Check if link already exists
    const existingLinkQuery: any = {
      tarefa_id: tarefa.id,
      provider: "github",
    };
    if (metadata.branchName) existingLinkQuery.branch = metadata.branchName;
    if (metadata.commitSha) existingLinkQuery.commit_sha = metadata.commitSha;
    if (metadata.prNumber) existingLinkQuery.pr_number = metadata.prNumber;

    const { data: existing } = await supabase
      .from("tarefa_git_links")
      .select("id")
      .match(existingLinkQuery)
      .maybeSingle();

    if (existing) {
      // Link already exists, skip
      continue;
    }

    // Create new link
    const linkData: any = {
      tarefa_id: tarefa.id,
      provider: "github",
      metadata: {
        entity_type: entityType,
        entity_id: entityId,
        auto_linked: true,
        detected_from: metadata.detectedFrom,
      },
    };

    if (metadata.branchName) linkData.branch = metadata.branchName;
    if (metadata.commitSha) linkData.commit_sha = metadata.commitSha;
    if (metadata.prNumber) linkData.pr_number = metadata.prNumber;

    await supabase.from("tarefa_git_links").insert(linkData);
  }
}

/**
 * Processa texto e cria auto-links
 */
export async function processAutoLink(
  text: string,
  projectId: string,
  repoId: string,
  entityType: "branch" | "commit" | "pull_request",
  entityId: string,
  metadata: {
    branchName?: string;
    commitSha?: string;
    prNumber?: number;
  }
): Promise<string[]> {
  const keys = detectTarefaKeys(text);
  
  if (keys.length > 0) {
    await createAutoLinks(keys, projectId, repoId, entityType, entityId, {
      ...metadata,
      detectedFrom: text.substring(0, 200), // Primeiros 200 chars
    });
  }
  
  return keys;
}

