import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateAuth } from "../_shared/permissions.ts";
import { getGitHubClient } from "../_shared/github-client.ts";

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
    // Supabase Edge Functions: pathname dentro da função é apenas o caminho após /functions/v1/git-repos
    let path = url.pathname;
    // Remove prefixos possíveis
    if (path.startsWith("/functions/v1/git-repos")) {
      path = path.replace("/functions/v1/git-repos", "");
    } else if (path.startsWith("/git-repos")) {
      path = path.replace("/git-repos", "");
    }
    // Garante que path começa com / ou é vazio
    if (!path.startsWith("/") && path !== "") {
      path = "/" + path;
    }
    if (path === "") {
      path = "/";
    }
    const authHeader = req.headers.get("authorization");

    const { userId, error: authError } = await validateAuth(authHeader);
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route handling
    const pathParts = path.split("/").filter(Boolean);
    
    if (req.method === "GET" && (path === "/" || path === "")) {
      return await handleGetRepos(req, userId);
    }

    if (req.method === "GET" && pathParts.length === 2 && pathParts[1] === "overview") {
      const repoId = pathParts[0];
      return await handleGetRepoOverview(repoId, userId);
    }

    if (req.method === "GET" && pathParts.length === 2 && pathParts[1] === "tree") {
      const repoId = pathParts[0];
      return await handleGetTree(req, repoId, userId);
    }

    if (req.method === "GET" && pathParts.length === 2 && pathParts[1] === "blob") {
      const repoId = pathParts[0];
      return await handleGetBlob(req, repoId, userId);
    }

    if (req.method === "GET" && pathParts.length === 2 && pathParts[1] === "branches") {
      const repoId = pathParts[0];
      return await handleGetBranches(repoId, userId);
    }

    if (req.method === "GET" && pathParts.length === 2 && pathParts[1] === "commits") {
      const repoId = pathParts[0];
      return await handleGetCommits(req, repoId, userId);
    }

    if (req.method === "GET" && pathParts.length === 3 && pathParts[1] === "commits") {
      const repoId = pathParts[0];
      const sha = pathParts[2];
      return await handleGetCommitDetail(repoId, sha, userId);
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("git-repos error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * GET / - Lista repositórios do projeto
 */
async function handleGetRepos(req: Request, userId: string) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");

  if (!projectId) {
    return new Response(
      JSON.stringify({ error: "projectId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check if user is project member
  const { data: member } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get repos linked to project
  const { data: repos, error } = await supabase
    .from("project_repos")
    .select(`
      repo_id,
      repos (
        id,
        connection_id,
        provider_repo_id,
        full_name,
        default_branch,
        visibility,
        description,
        url,
        last_synced_at,
        sync_status,
        created_at,
        updated_at
      )
    `)
    .eq("project_id", projectId);

  if (error) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch repos" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get counts for each repo
  const reposWithCounts = await Promise.all(
    (repos || []).map(async (item: any) => {
      const repo = item.repos;
      if (!repo) return null;

      const [branchesCount, prsCount] = await Promise.all([
        supabase
          .from("branches")
          .select("*", { count: "exact", head: true })
          .eq("repo_id", repo.id),
        supabase
          .from("pull_requests")
          .select("*", { count: "exact", head: true })
          .eq("repo_id", repo.id)
          .eq("state", "OPEN"),
      ]);

      return {
        ...repo,
        branches_count: branchesCount.count || 0,
        open_prs_count: prsCount.count || 0,
      };
    })
  );

  return new Response(
    JSON.stringify({ repos: reposWithCounts.filter(Boolean) }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * GET /:repoId/overview - Overview do repositório
 */
async function handleGetRepoOverview(repoId: string, userId: string) {
  // Get repo
  const { data: repo, error: repoError } = await supabase
    .from("repos")
    .select("*")
    .eq("id", repoId)
    .maybeSingle();

  if (repoError || !repo) {
    return new Response(
      JSON.stringify({ error: "Repository not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check permissions
  const { data: projectRepo } = await supabase
    .from("project_repos")
    .select("project_id")
    .eq("repo_id", repoId)
    .maybeSingle();

  if (!projectRepo) {
    return new Response(
      JSON.stringify({ error: "Repository not linked to project" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: member } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectRepo.project_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!member) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get connection
  const { data: connection } = await supabase
    .from("provider_connections")
    .select("*")
    .eq("id", repo.connection_id)
    .maybeSingle();

  if (!connection || !connection.installation_id) {
    return new Response(
      JSON.stringify({ error: "Connection not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Get GitHub client
    const octokit = await getGitHubClient({
      connectionId: connection.id,
      installationId: connection.installation_id,
    });

    const [owner, repoName] = repo.full_name.split("/");

    // Fetch README
    let readme = null;
    try {
      const { data: readmeData } = await octokit.repos.getContent({
        owner,
        repo: repoName,
        path: "README.md",
      });

      if (readmeData && "content" in readmeData) {
        readme = {
          content: atob(readmeData.content.replace(/\n/g, "")),
          encoding: "utf-8",
          size: readmeData.size,
          sha: readmeData.sha,
          path: "README.md",
        };
      }
    } catch {
      // README not found, ignore
    }

    // Get recent commits
    const { data: commitsData } = await octokit.repos.listCommits({
      owner,
      repo: repoName,
      per_page: 10,
    });

    const recentCommits = (commitsData || []).map((commit: any) => ({
      id: commit.sha,
      repo_id: repoId,
      sha: commit.sha,
      author_name: commit.commit.author?.name || "",
      author_email: commit.commit.author?.email,
      message: commit.commit.message,
      date: commit.commit.author?.date || "",
      url: commit.html_url,
      parent_shas: commit.parents?.map((p: any) => p.sha) || [],
    }));

    // Get recent PRs
    const { data: recentPRs } = await supabase
      .from("pull_requests")
      .select("*")
      .eq("repo_id", repoId)
      .order("created_at", { ascending: false })
      .limit(5);

    // Get active branches
    const { data: activeBranches } = await supabase
      .from("branches")
      .select("*")
      .eq("repo_id", repoId)
      .order("last_synced_at", { ascending: false })
      .limit(10);

    // Get counts
    const [openPRsCount, pendingReviewsCount, failingChecksCount] = await Promise.all([
      supabase
        .from("pull_requests")
        .select("*", { count: "exact", head: true })
        .eq("repo_id", repoId)
        .eq("state", "OPEN"),
      supabase
        .from("pr_reviews")
        .select("*", { count: "exact", head: true })
        .eq("pr_id", (await supabase.from("pull_requests").select("id").eq("repo_id", repoId).limit(1)).data?.[0]?.id || ""),
      supabase
        .from("pr_status_checks")
        .select("*", { count: "exact", head: true })
        .eq("pr_id", (await supabase.from("pull_requests").select("id").eq("repo_id", repoId).limit(1)).data?.[0]?.id || "")
        .eq("conclusion", "FAILURE"),
    ]);

    return new Response(
      JSON.stringify({
        repo,
        readme,
        recent_commits: recentCommits,
        recent_prs: recentPRs || [],
        active_branches: activeBranches || [],
        open_prs_count: openPRsCount.count || 0,
        pending_reviews_count: pendingReviewsCount.count || 0,
        failing_checks_count: failingChecksCount.count || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Overview error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch overview" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /:repoId/tree - Árvore de arquivos
 */
async function handleGetTree(req: Request, repoId: string, userId: string) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") || "main";
  const path = url.searchParams.get("path") || "";

  // Verify permissions (same as overview)
  const { data: repo } = await supabase
    .from("repos")
    .select("full_name, connection_id")
    .eq("id", repoId)
    .maybeSingle();

  if (!repo) {
    return new Response(
      JSON.stringify({ error: "Repository not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: connection } = await supabase
    .from("provider_connections")
    .select("installation_id")
    .eq("id", repo.connection_id)
    .maybeSingle();

  if (!connection) {
    return new Response(
      JSON.stringify({ error: "Connection not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const octokit = await getGitHubClient({
      connectionId: repo.connection_id,
      installationId: connection.installation_id!,
    });

    const [owner, repoName] = repo.full_name.split("/");

    const { data: treeData } = await octokit.repos.getContent({
      owner,
      repo: repoName,
      path: path,
      ref: ref,
    });

    const entries = Array.isArray(treeData) ? treeData : [treeData];

    const tree = entries.map((item: any) => ({
      name: item.name,
      path: item.path,
      type: item.type,
      sha: item.sha,
      size: item.size,
      mode: item.mode,
    }));

    return new Response(
      JSON.stringify({ tree }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Tree error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch tree" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /:repoId/blob - Conteúdo do arquivo
 */
async function handleGetBlob(req: Request, repoId: string, userId: string) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") || "main";
  const path = url.searchParams.get("path");

  if (!path) {
    return new Response(
      JSON.stringify({ error: "path is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: repo } = await supabase
    .from("repos")
    .select("full_name, connection_id")
    .eq("id", repoId)
    .maybeSingle();

  if (!repo) {
    return new Response(
      JSON.stringify({ error: "Repository not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: connection } = await supabase
    .from("provider_connections")
    .select("installation_id")
    .eq("id", repo.connection_id)
    .maybeSingle();

  if (!connection) {
    return new Response(
      JSON.stringify({ error: "Connection not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const octokit = await getGitHubClient({
      connectionId: repo.connection_id,
      installationId: connection.installation_id!,
    });

    const [owner, repoName] = repo.full_name.split("/");

    const { data: blobData } = await octokit.repos.getContent({
      owner,
      repo: repoName,
      path: path,
      ref: ref,
    });

    if (!("content" in blobData)) {
      return new Response(
        JSON.stringify({ error: "Not a file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const content = atob(blobData.content.replace(/\n/g, ""));

    return new Response(
      JSON.stringify({
        content,
        encoding: "utf-8",
        size: blobData.size,
        sha: blobData.sha,
        path: blobData.path,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Blob error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch blob" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /:repoId/branches - Lista branches
 */
async function handleGetBranches(repoId: string, userId: string) {
  const { data: branches, error } = await supabase
    .from("branches")
    .select("*")
    .eq("repo_id", repoId)
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch branches" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ branches: branches || [] }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * GET /:repoId/commits - Lista commits
 */
async function handleGetCommits(req: Request, repoId: string, userId: string) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") || "main";
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "30");

  const { data: repo } = await supabase
    .from("repos")
    .select("full_name, connection_id")
    .eq("id", repoId)
    .maybeSingle();

  if (!repo) {
    return new Response(
      JSON.stringify({ error: "Repository not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: connection } = await supabase
    .from("provider_connections")
    .select("installation_id")
    .eq("id", repo.connection_id)
    .maybeSingle();

  if (!connection) {
    return new Response(
      JSON.stringify({ error: "Connection not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const octokit = await getGitHubClient({
      connectionId: repo.connection_id,
      installationId: connection.installation_id!,
    });

    const [owner, repoName] = repo.full_name.split("/");

    const { data: commitsData } = await octokit.repos.listCommits({
      owner,
      repo: repoName,
      sha: ref,
      per_page: limit,
      page,
    });

    const commits = (commitsData || []).map((commit: any) => ({
      id: commit.sha,
      repo_id: repoId,
      sha: commit.sha,
      branch_name: ref,
      author_name: commit.commit.author?.name || "",
      author_email: commit.commit.author?.email,
      message: commit.commit.message,
      date: commit.commit.author?.date || "",
      url: commit.html_url,
      parent_shas: commit.parents?.map((p: any) => p.sha) || [],
    }));

    return new Response(
      JSON.stringify({ commits, page, limit }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Commits error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch commits" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /:repoId/commits/:sha - Detalhe do commit
 */
async function handleGetCommitDetail(repoId: string, sha: string, userId: string) {
  const { data: repo } = await supabase
    .from("repos")
    .select("full_name, connection_id")
    .eq("id", repoId)
    .maybeSingle();

  if (!repo) {
    return new Response(
      JSON.stringify({ error: "Repository not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: connection } = await supabase
    .from("provider_connections")
    .select("installation_id")
    .eq("id", repo.connection_id)
    .maybeSingle();

  if (!connection) {
    return new Response(
      JSON.stringify({ error: "Connection not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const octokit = await getGitHubClient({
      connectionId: repo.connection_id,
      installationId: connection.installation_id!,
    });

    const [owner, repoName] = repo.full_name.split("/");

    const { data: commitData } = await octokit.repos.getCommit({
      owner,
      repo: repoName,
      ref: sha,
    });

    const commit = {
      id: commitData.sha,
      repo_id: repoId,
      sha: commitData.sha,
      author_name: commitData.commit.author?.name || "",
      author_email: commitData.commit.author?.email,
      message: commitData.commit.message,
      date: commitData.commit.author?.date || "",
      url: commitData.html_url,
      parent_shas: commitData.parents?.map((p: any) => p.sha) || [],
      files: commitData.files?.map((f: any) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch,
        blob_url: f.blob_url,
        raw_url: f.raw_url,
      })) || [],
    };

    // Get linked tarefas
    const { data: links } = await supabase
      .from("tarefa_git_links")
      .select("tarefa_id, tarefas(id, key, title)")
      .eq("commit_sha", sha);

    return new Response(
      JSON.stringify({
        commit,
        linked_tarefas: links?.map((l: any) => l.tarefas).filter(Boolean) || [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Commit detail error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch commit" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}


