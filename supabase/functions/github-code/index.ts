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
    const prefixes = ["/functions/v1/github-code", "/github-code"];
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

    console.log("github-code path parsing:", {
      originalPath: url.pathname,
      normalizedPath,
      pathParts,
      method: req.method,
    });

    // GET /repos/:repoId/branches
    if (req.method === "GET" && pathParts.length === 3 && pathParts[0] === "repos" && pathParts[2] === "branches") {
      const repoId = pathParts[1];
      return await handleGetBranches(req, repoId, userId);
    }

    // GET /repos/:repoId/commits
    if (req.method === "GET" && pathParts.length === 3 && pathParts[0] === "repos" && pathParts[2] === "commits") {
      const repoId = pathParts[1];
      return await handleGetCommits(req, repoId, userId);
    }

    // GET /repos/:repoId/compare
    if (req.method === "GET" && pathParts.length === 3 && pathParts[0] === "repos" && pathParts[2] === "compare") {
      const repoId = pathParts[1];
      return await handleCompareBranches(req, repoId, userId);
    }

    // GET /repos/:repoId/tree
    if (req.method === "GET" && pathParts.length === 3 && pathParts[0] === "repos" && pathParts[2] === "tree") {
      const repoId = pathParts[1];
      return await handleGetTree(req, repoId, userId);
    }

    // GET /repos/:repoId/blob
    if (req.method === "GET" && pathParts.length === 3 && pathParts[0] === "repos" && pathParts[2] === "blob") {
      const repoId = pathParts[1];
      return await handleGetBlob(req, repoId, userId);
    }

    return new Response(
      JSON.stringify({ error: "Not found", path: normalizedPath }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("github-code error:", error);
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
  // Get repo and connection
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
 * GET /repos/:repoId/branches - Lista branches com destaque para TSK-
 */
async function handleGetBranches(req: Request, repoId: string, userId: string) {
  const url = new URL(req.url);
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
    const { data: branches } = await octokit.repos.listBranches({
      owner,
      repo: repoName,
      per_page: 100,
    });

    // Filter by search
    let filteredBranches = branches || [];
    if (search) {
      const searchLower = search.toLowerCase();
      filteredBranches = filteredBranches.filter((b) =>
        b.name.toLowerCase().includes(searchLower)
      );
    }

    // Format and detect TSK-123
    const formattedBranches = filteredBranches.map((branch: any) => {
      const hasTarefaKey = /TSK-[A-Z0-9]+(?:-[A-Z0-9]+)*/i.test(branch.name);
      
      return {
        id: branch.name,
        repo_id: repoId,
        name: branch.name,
        last_commit_sha: branch.commit.sha,
        is_default: branch.name === "main" || branch.name === "master",
        protected: branch.protected || false,
        has_tarefa_key: hasTarefaKey,
      };
    });

    // Auto-link branches with TSK-123
    for (const branch of formattedBranches) {
      if (branch.has_tarefa_key) {
        await processAutoLink(
          branch.name,
          clientData.projectId,
          repoId,
          "branch",
          branch.id,
          { branchName: branch.name }
        );
      }
    }

    return new Response(
      JSON.stringify({ branches: formattedBranches }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching branches:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch branches" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /repos/:repoId/compare - Compara duas branches e retorna commits
 */
async function handleCompareBranches(req: Request, repoId: string, userId: string) {
  const url = new URL(req.url);
  const base = url.searchParams.get("base");
  const head = url.searchParams.get("head");

  if (!base || !head) {
    return new Response(
      JSON.stringify({ error: "base and head parameters are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

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
    // Comparar branches usando GitHub API
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo: repoName,
      base,
      head,
    });

    const commits = (comparison.commits || []).map((commit: any) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author?.name || "",
      date: commit.commit.author?.date || "",
    }));

    return new Response(
      JSON.stringify({ 
        commits,
        ahead_by: comparison.ahead_by || 0,
        behind_by: comparison.behind_by || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error comparing branches:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to compare branches" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /repos/:repoId/commits - Lista commits com auto-link
 */
async function handleGetCommits(req: Request, repoId: string, userId: string) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") || "main";
  const cursor = url.searchParams.get("cursor") || "";

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
    const { data: commits } = await octokit.repos.listCommits({
      owner,
      repo: repoName,
      sha: ref,
      per_page: 30,
    });

    const formattedCommits = (commits || []).map((commit: any) => ({
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

    // Auto-link commits with TSK-123 in message
    for (const commit of formattedCommits) {
      await processAutoLink(
        commit.message,
        clientData.projectId,
        repoId,
        "commit",
        commit.id,
        { commitSha: commit.sha, branchName: ref }
      );
    }

    return new Response(
      JSON.stringify({ commits: formattedCommits, nextCursor: "" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching commits:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch commits" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /repos/:repoId/tree - Árvore de arquivos
 */
async function handleGetTree(req: Request, repoId: string, userId: string) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") || "main";
  const path = url.searchParams.get("path") || "";

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
    console.error("Error fetching tree:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch tree" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /repos/:repoId/blob - Conteúdo do arquivo
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
    console.error("Error fetching blob:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch blob" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

