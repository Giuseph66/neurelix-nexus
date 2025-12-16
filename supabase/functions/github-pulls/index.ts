import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateAuth } from "../_shared/permissions.ts";
import { Octokit } from "https://esm.sh/@octokit/rest@20.0.1";
import { processAutoLink } from "../_shared/auto-link.ts";

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
    const prefixes = ["/functions/v1/github-pulls", "/github-pulls"];
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

    // GET /repos/:repoId/pulls
    if (req.method === "GET" && pathParts.length === 2 && pathParts[1] === "pulls") {
      const repoId = pathParts[0];
      return await handleGetPulls(req, repoId, userId);
    }

    // GET /pulls/:repoId/:number
    if (req.method === "GET" && pathParts.length === 3 && pathParts[0] === "pulls") {
      const repoId = pathParts[1];
      const prNumber = parseInt(pathParts[2]);
      return await handleGetPRDetail(repoId, prNumber, userId);
    }

    return new Response(
      JSON.stringify({ error: "Not found", path: normalizedPath }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("github-pulls error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Get GitHub client from connection
 */
async function getGitHubClientForRepo(repoId: string): Promise<{ octokit: Octokit; repo: any; projectId: string } | null> {
  const { data: repo } = await supabase
    .from("repos")
    .select("connection_id, project_id, full_name")
    .eq("id", repoId)
    .maybeSingle();

  if (!repo || !repo.connection_id) return null;

  const { data: connection } = await supabase
    .from("provider_connections")
    .select("access_token_encrypted")
    .eq("id", repo.connection_id)
    .eq("status", "active")
    .maybeSingle();

  if (!connection || !connection.access_token_encrypted) return null;

  const octokit = new Octokit({
    auth: connection.access_token_encrypted,
  });

  return { octokit, repo, projectId: repo.project_id };
}

/**
 * GET /repos/:repoId/pulls - Lista Pull Requests
 */
async function handleGetPulls(req: Request, repoId: string, userId: string) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") || "open";
  const search = url.searchParams.get("search") || "";

  const clientData = await getGitHubClientForRepo(repoId);
  if (!clientData) {
    return new Response(
      JSON.stringify({ error: "Repository or connection not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { octokit, repo } = clientData;
  const [owner, repoName] = repo.full_name.split("/");

  try {
    const { data: pulls } = await octokit.pulls.list({
      owner,
      repo: repoName,
      state: state as "open" | "closed" | "all",
      per_page: 100,
    });

    // Filter by search
    let filteredPulls = pulls || [];
    if (search) {
      const searchLower = search.toLowerCase();
      filteredPulls = filteredPulls.filter(
        (pr: any) =>
          pr.title.toLowerCase().includes(searchLower) ||
          pr.body?.toLowerCase().includes(searchLower) ||
          pr.head.ref.toLowerCase().includes(searchLower)
      );
    }

    // Format PRs
    const formattedPRs = filteredPulls.map((pr: any) => ({
      id: pr.id.toString(),
      repo_id: repoId,
      number: pr.number,
      title: pr.title,
      description: pr.body || "",
      state: pr.state.toUpperCase(),
      source_branch: pr.head.ref,
      target_branch: pr.base.ref,
      author_username: pr.user.login,
      draft: pr.draft || false,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      merged_at: pr.merged_at,
      url: pr.html_url,
    }));

    // Auto-link PRs with TSK-123
    for (const pr of formattedPRs) {
      const textToSearch = `${pr.title} ${pr.description} ${pr.source_branch}`;
      await processAutoLink(
        textToSearch,
        clientData.projectId,
        repoId,
        "pull_request",
        pr.id,
        { branchName: pr.source_branch, prNumber: pr.number }
      );
    }

    return new Response(
      JSON.stringify({ prs: formattedPRs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching pulls:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch pull requests" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /pulls/:repoId/:number - Detalhe do PR
 */
async function handleGetPRDetail(repoId: string, prNumber: number, userId: string) {
  const clientData = await getGitHubClientForRepo(repoId);
  if (!clientData) {
    return new Response(
      JSON.stringify({ error: "Repository or connection not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { octokit, repo } = clientData;
  const [owner, repoName] = repo.full_name.split("/");

  try {
    // Get PR details
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    // Get commits
    const { data: commits } = await octokit.pulls.listCommits({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    // Get files changed
    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    // Get reviews
    const { data: reviews } = await octokit.pulls.listReviews({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    // Format PR
    const formattedPR = {
      id: pr.id.toString(),
      repo_id: repoId,
      number: pr.number,
      title: pr.title,
      description: pr.body || "",
      state: pr.state.toUpperCase(),
      source_branch: pr.head.ref,
      target_branch: pr.base.ref,
      author_username: pr.user.login,
      draft: pr.draft || false,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      merged_at: pr.merged_at,
      url: pr.html_url,
      commits: (commits || []).map((c: any) => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.commit.author.name,
        date: c.commit.author.date,
      })),
      files: (files || []).map((f: any) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch,
        blob_url: f.blob_url,
        raw_url: f.raw_url,
      })),
      reviews: (reviews || []).map((r: any) => ({
        id: r.id,
        state: r.state,
        reviewer: r.user.login,
        body: r.body,
        submitted_at: r.submitted_at,
      })),
    };

    // Auto-link PR
    const textToSearch = `${pr.title} ${pr.body || ""} ${pr.head.ref}`;
    const linkedKeys = await processAutoLink(
      textToSearch,
      clientData.projectId,
      repoId,
      "pull_request",
      formattedPR.id,
      { branchName: pr.head.ref, prNumber: pr.number }
    );

    // Get linked tarefas
    const { data: links } = await supabase
      .from("tarefa_git_links")
      .select("tarefa_id, tarefas(id, key, title)")
      .eq("pr_number", prNumber)
      .or(`branch.eq.${pr.head.ref},commit_sha.in.(${(commits || []).map((c: any) => c.sha).join(",")})`);

    return new Response(
      JSON.stringify({
        pr: formattedPR,
        linked_tarefas: links?.map((l: any) => l.tarefas).filter(Boolean) || [],
        detected_keys: linkedKeys,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching PR detail:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch PR detail" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

