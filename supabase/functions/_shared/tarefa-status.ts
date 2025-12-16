// Shared function to update tarefa status based on PR state

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Updates tarefa status based on PR state and project rules
 */
export async function updateTarefaStatusFromPR(
  prId: string,
  prState: "OPEN" | "MERGED" | "CLOSED",
  projectId: string
): Promise<void> {
  try {
    // Get PR details
    const { data: pr } = await supabase
      .from("pull_requests")
      .select("repo_id, number, source_branch")
      .eq("id", prId)
      .maybeSingle();

    if (!pr) {
      console.log("PR not found:", prId);
      return;
    }

    // Get project_repos config
    const { data: projectRepo } = await supabase
      .from("project_repos")
      .select("auto_close_tarefa_on_merge")
      .eq("project_id", projectId)
      .eq("repo_id", pr.repo_id)
      .maybeSingle();

    // Get linked tarefas
    const { data: links } = await supabase
      .from("tarefa_git_links")
      .select("tarefa_id")
      .eq("pr_number", pr.number)
      .or(`branch.eq.${pr.source_branch}`);

    if (!links || links.length === 0) {
      console.log("No linked tarefas found for PR:", prId);
      return;
    }

    const tarefaIds = links.map(l => l.tarefa_id);

    // Get workflow statuses for the project
    const { data: workflows } = await supabase
      .from("workflows")
      .select("id, project_id")
      .eq("project_id", projectId)
      .limit(1);

    if (!workflows || workflows.length === 0) {
      console.log("No workflow found for project:", projectId);
      return;
    }

    const workflowId = workflows[0].id;

    // Get statuses
    const { data: statuses } = await supabase
      .from("statuses")
      .select("id, name, key")
      .eq("workflow_id", workflowId);

    if (!statuses || statuses.length === 0) {
      console.log("No statuses found for workflow:", workflowId);
      return;
    }

    // Find target status based on PR state
    let targetStatusId: string | null = null;

    if (prState === "MERGED" && projectRepo?.auto_close_tarefa_on_merge) {
      // Find "Concluído" or similar status
      const concluidoStatus = statuses.find(s => 
        s.key?.toLowerCase().includes("concluido") || 
        s.key?.toLowerCase().includes("done") ||
        s.name?.toLowerCase().includes("concluído") ||
        s.name?.toLowerCase().includes("done")
      );
      targetStatusId = concluidoStatus?.id || null;
    } else if (prState === "OPEN") {
      // Find "Em Andamento" or similar status
      const emAndamentoStatus = statuses.find(s => 
        s.key?.toLowerCase().includes("andamento") || 
        s.key?.toLowerCase().includes("progress") ||
        s.name?.toLowerCase().includes("em andamento") ||
        s.name?.toLowerCase().includes("in progress")
      );
      targetStatusId = emAndamentoStatus?.id || null;
    }

    if (!targetStatusId) {
      console.log("Target status not found for PR state:", prState);
      return;
    }

    // Update tarefas
    const { error } = await supabase
      .from("tarefas")
      .update({ status_id: targetStatusId })
      .in("id", tarefaIds);

    if (error) {
      console.error("Error updating tarefas:", error);
      throw error;
    }

    console.log(`Updated ${tarefaIds.length} tarefa(s) to status ${targetStatusId} for PR ${prId}`);
  } catch (error) {
    console.error("Error in updateTarefaStatusFromPR:", error);
    throw error;
  }
}

/**
 * Updates tarefa status when PR is approved (all reviews approved)
 */
export async function updateTarefaStatusOnPRApproved(
  prId: string,
  projectId: string
): Promise<void> {
  try {
    // Get PR details
    const { data: pr } = await supabase
      .from("pull_requests")
      .select("repo_id, number")
      .eq("id", prId)
      .maybeSingle();

    if (!pr) return;

    // Get all reviews for this PR
    const { data: reviews } = await supabase
      .from("pr_reviews")
      .select("state")
      .eq("pr_id", prId);

    if (!reviews || reviews.length === 0) return;

    // Check if all reviews are approved
    const allApproved = reviews.every(r => r.state === "APPROVED");
    const hasChangesRequested = reviews.some(r => r.state === "CHANGES_REQUESTED");

    if (!allApproved || hasChangesRequested) {
      return; // Not all approved or has changes requested
    }

    // Get linked tarefas
    const { data: links } = await supabase
      .from("tarefa_git_links")
      .select("tarefa_id")
      .eq("pr_number", pr.number);

    if (!links || links.length === 0) return;

    const tarefaIds = links.map(l => l.tarefa_id);

    // Get workflow statuses
    const { data: workflows } = await supabase
      .from("workflows")
      .select("id")
      .eq("project_id", projectId)
      .limit(1);

    if (!workflows || workflows.length === 0) return;

    const workflowId = workflows[0].id;

    const { data: statuses } = await supabase
      .from("statuses")
      .select("id, name, key")
      .eq("workflow_id", workflowId);

    if (!statuses || statuses.length === 0) return;

    // Find "Em Revisão" or similar status
    const emRevisaoStatus = statuses.find(s => 
      s.key?.toLowerCase().includes("revisao") || 
      s.key?.toLowerCase().includes("review") ||
      s.name?.toLowerCase().includes("em revisão") ||
      s.name?.toLowerCase().includes("in review")
    );

    if (!emRevisaoStatus) return;

    // Update tarefas
    await supabase
      .from("tarefas")
      .update({ status_id: emRevisaoStatus.id })
      .in("id", tarefaIds);

    console.log(`Updated ${tarefaIds.length} tarefa(s) to review status for PR ${prId}`);
  } catch (error) {
    console.error("Error in updateTarefaStatusOnPRApproved:", error);
    throw error;
  }
}

