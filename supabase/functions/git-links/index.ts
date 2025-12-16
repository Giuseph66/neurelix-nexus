import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateAuth } from "../_shared/permissions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let path = url.pathname;
    
    // Normalizar path
    const prefixes = ["/functions/v1/git-links", "/git-links"];
    for (const prefix of prefixes) {
      if (path.startsWith(prefix)) {
        path = path.slice(prefix.length);
        break;
      }
    }
    
    if (path === "" || path === "/") {
      path = "/";
    } else if (!path.startsWith("/")) {
      path = "/" + path;
    }

    const authHeader = req.headers.get("authorization");
    const { userId, error: authError } = await validateAuth(authHeader);
    
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedPath = path === "/" ? "/" : path.replace(/^\/+/, "/");
    const pathParts = normalizedPath.split("/").filter(Boolean);

    // GET /tarefas/:tarefaId - Retorna links Git de uma tarefa
    if (req.method === "GET" && pathParts.length === 2 && pathParts[0] === "tarefas") {
      const tarefaId = pathParts[1];
      return await handleGetTarefaGitLinks(tarefaId, userId);
    }

    // POST / - Criar/atualizar link
    if (req.method === "POST" && normalizedPath === "/") {
      return await handleCreateLink(req, userId);
    }

    return new Response(
      JSON.stringify({ error: "Not found", path: normalizedPath }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("git-links error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * GET /tarefas/:tarefaId - Retorna bloco "Código" para tarefa
 */
async function handleGetTarefaGitLinks(tarefaId: string, userId: string) {
  // Get tarefa to check permissions
  const { data: tarefa } = await supabase
    .from("tarefas")
    .select("project_id")
    .eq("id", tarefaId)
    .maybeSingle();

  if (!tarefa) {
    return new Response(
      JSON.stringify({ error: "Tarefa not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check if user is project member
  const { data: member } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", tarefa.project_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get git links
  const { data: links } = await supabase
    .from("tarefa_git_links")
    .select(`
      id,
      branch,
      commit_sha,
      pr_number,
      url,
      metadata,
      repos (
        id,
        full_name,
        url
      ),
      pull_requests (
        id,
        number,
        title,
        state,
        url
      )
    `)
    .eq("tarefa_id", tarefaId)
    .order("created_at", { ascending: false });

  // Get whiteboard origin if exists
  const { data: whiteboardOrigin } = await supabase
    .from("tarefa_whiteboard_origin")
    .select("whiteboard_id, node_ids")
    .eq("tarefa_id", tarefaId)
    .maybeSingle();

  // Format response
  const formattedLinks = (links || []).map((link: any) => {
    const repo = link.repos;
    const pr = link.pull_requests;

    return {
      id: link.id,
      branch: link.branch,
      commitSha: link.commit_sha,
      prNumber: link.pr_number,
      url: link.url,
      autoLinked: link.metadata?.auto_linked || false,
      repo: repo ? {
        id: repo.id,
        fullName: repo.full_name,
        url: repo.url,
      } : null,
      pr: pr ? {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        state: pr.state,
        url: pr.url,
      } : null,
    };
  });

  return new Response(
    JSON.stringify({
      links: formattedLinks,
      whiteboardOrigin: whiteboardOrigin ? {
        whiteboardId: whiteboardOrigin.whiteboard_id,
        nodeIds: whiteboardOrigin.node_ids,
      } : null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * POST / - Criar/atualizar link
 */
async function handleCreateLink(req: Request, userId: string) {
  const { tarefaId, repoId, branchName, prNumber, commitSha } = await req.json();

  if (!tarefaId) {
    return new Response(
      JSON.stringify({ error: "tarefaId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get tarefa to check permissions
  const { data: tarefa } = await supabase
    .from("tarefas")
    .select("project_id")
    .eq("id", tarefaId)
    .maybeSingle();

  if (!tarefa) {
    return new Response(
      JSON.stringify({ error: "Tarefa not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check permissions
  const { data: member } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", tarefa.project_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member || (member.role !== "admin" && member.role !== "tech_lead" && member.role !== "developer")) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get repo URL if repoId provided
  let repoUrl = null;
  if (repoId) {
    const { data: repo } = await supabase
      .from("repos")
      .select("url, full_name")
      .eq("id", repoId)
      .maybeSingle();
    
    if (repo) {
      repoUrl = repo.url;
    }
  }

  // Build URL
  let url = repoUrl || "";
  if (prNumber && repoUrl) {
    url = `${repoUrl}/pull/${prNumber}`;
  } else if (commitSha && repoUrl) {
    url = `${repoUrl}/commit/${commitSha}`;
  } else if (branchName && repoUrl) {
    url = `${repoUrl}/tree/${branchName}`;
  }

  // Upsert link
  const linkData: any = {
    tarefa_id: tarefaId,
    provider: "github",
    branch: branchName || null,
    commit_sha: commitSha || null,
    pr_number: prNumber || null,
    url: url || null,
    created_by: userId,
    metadata: {
      manual_link: true,
    },
  };

  const { data: link, error } = await supabase
    .from("tarefa_git_links")
    .upsert(linkData, {
      onConflict: "tarefa_id,provider,branch,commit_sha,pr_number",
      ignoreDuplicates: false,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating link:", error);
    return new Response(
      JSON.stringify({ error: "Failed to create link" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ link }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

