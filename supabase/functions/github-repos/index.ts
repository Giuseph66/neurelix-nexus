import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateAuth } from "../_shared/permissions.ts";
import { Octokit } from "https://esm.sh/@octokit/rest@20.0.1";

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
    const prefixes = ["/functions/v1/github-repos", "/github-repos"];
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

    if (req.method === "GET" && normalizedPath === "/available") {
      return await handleGetAvailableRepos(req, userId);
    }

    if (req.method === "POST" && normalizedPath === "/select") {
      return await handleSelectRepos(req, userId);
    }

    if (req.method === "GET" && normalizedPath === "/selected") {
      return await handleGetSelectedRepos(req, userId);
    }

    return new Response(
      JSON.stringify({ error: "Not found", path: normalizedPath }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("github-repos error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * GET /available - Lista repositórios disponíveis
 */
async function handleGetAvailableRepos(req: Request, userId: string) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const org = url.searchParams.get("org") || "";
  const search = url.searchParams.get("search") || "";
  const cursor = url.searchParams.get("cursor") || "";

  if (!projectId) {
    return new Response(
      JSON.stringify({ error: "projectId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get connection
  const { data: connection } = await supabase
    .from("provider_connections")
    .select("id, access_token_encrypted, username")
    .eq("project_id", projectId)
    .eq("provider", "github")
    .eq("status", "active")
    .maybeSingle();

  if (!connection || !connection.access_token_encrypted) {
    return new Response(
      JSON.stringify({ error: "GitHub not connected" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const octokit = new Octokit({
      auth: connection.access_token_encrypted,
    });

    // Get user's repos (including orgs)
    const repos: any[] = [];
    let nextCursor = "";

    // Get user repos
    const userRepos = await octokit.repos.listForAuthenticatedUser({
      type: "all",
      per_page: 100,
      sort: "updated",
    });

    repos.push(...(userRepos.data || []));

    // Get orgs and their repos
    const orgs = await octokit.orgs.listForAuthenticatedUser({
      per_page: 100,
    });

    for (const orgData of orgs.data || []) {
      try {
        const orgRepos = await octokit.repos.listForOrg({
          org: orgData.login,
          type: "all",
          per_page: 100,
        });
        repos.push(...(orgRepos.data || []));
      } catch (error) {
        console.error(`Error fetching repos for org ${orgData.login}:`, error);
        // Continue with other orgs
      }
    }

    // Filter by org if specified
    let filteredRepos = repos;
    if (org) {
      filteredRepos = repos.filter((repo) => repo.owner.login === org);
    }

    // Filter by search
    if (search) {
      const searchLower = search.toLowerCase();
      filteredRepos = filteredRepos.filter(
        (repo) =>
          repo.name.toLowerCase().includes(searchLower) ||
          repo.full_name.toLowerCase().includes(searchLower) ||
          repo.description?.toLowerCase().includes(searchLower)
      );
    }

    // Remove duplicates (by full_name)
    const uniqueRepos = Array.from(
      new Map(filteredRepos.map((repo) => [repo.full_name, repo])).values()
    );

    // Format response
    const formattedRepos = uniqueRepos.map((repo: any) => ({
      fullName: repo.full_name,
      name: repo.name,
      owner: repo.owner.login,
      private: repo.private,
      defaultBranch: repo.default_branch || "main",
      description: repo.description || "",
      url: repo.html_url,
      updatedAt: repo.updated_at,
    }));

    // Get already selected repos
    const { data: selectedRepos } = await supabase
      .from("repos")
      .select("full_name")
      .eq("project_id", projectId)
      .eq("selected", true);

    const selectedFullNames = new Set((selectedRepos || []).map((r) => r.full_name));

    // Mark which are selected
    const reposWithSelection = formattedRepos.map((repo) => ({
      ...repo,
      selected: selectedFullNames.has(repo.fullName),
    }));

    // Get unique orgs for filter
    const orgsList = Array.from(new Set(formattedRepos.map((r) => r.owner))).sort();

    return new Response(
      JSON.stringify({
        repos: reposWithSelection,
        nextCursor,
        orgs: orgsList,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching repos:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch repositories" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * POST /select - Seleciona repositórios
 */
async function handleSelectRepos(req: Request, userId: string) {
  const { projectId, selectedFullNames } = await req.json();

  if (!projectId || !Array.isArray(selectedFullNames)) {
    return new Response(
      JSON.stringify({ error: "projectId and selectedFullNames array are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get connection
  const { data: connection } = await supabase
    .from("provider_connections")
    .select("id, access_token_encrypted")
    .eq("project_id", projectId)
    .eq("provider", "github")
    .eq("status", "active")
    .maybeSingle();

  if (!connection) {
    return new Response(
      JSON.stringify({ error: "GitHub not connected" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const octokit = new Octokit({
      auth: connection.access_token_encrypted,
    });

    // Fetch repo details from GitHub
    const reposToSave = [];
    for (const fullName of selectedFullNames) {
      const [owner, repo] = fullName.split("/");
      try {
        const { data: repoData } = await octokit.repos.get({
          owner,
          repo,
        });

        reposToSave.push({
          connection_id: connection.id,
          project_id: projectId,
          provider_repo_id: repoData.id.toString(),
          full_name: repoData.full_name,
          default_branch: repoData.default_branch || "main",
          visibility: repoData.private ? "private" : "public",
          description: repoData.description || null,
          url: repoData.html_url,
          selected: true,
          sync_status: "synced",
          last_synced_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error(`Error fetching repo ${fullName}:`, error);
        // Continue with other repos
      }
    }

    // Mark all repos as not selected first
    await supabase
      .from("repos")
      .update({ selected: false })
      .eq("project_id", projectId);

    // Upsert selected repos
    for (const repoData of reposToSave) {
      const { error: upsertError } = await supabase
        .from("repos")
        .upsert(
          {
            ...repoData,
            // Use connection_id + provider_repo_id as unique constraint
          },
          {
            onConflict: "connection_id,provider_repo_id",
            ignoreDuplicates: false,
          }
        );

      if (upsertError) {
        console.error("Error upserting repo:", upsertError);
      }
    }

    // Create project_repos links
    const { data: savedRepos } = await supabase
      .from("repos")
      .select("id")
      .eq("project_id", projectId)
      .eq("selected", true);

    for (const repo of savedRepos || []) {
      await supabase
        .from("project_repos")
        .upsert(
          {
            project_id: projectId,
            repo_id: repo.id,
          },
          {
            onConflict: "project_id,repo_id",
          }
        );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        selected: reposToSave.map((r) => r.full_name),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error selecting repos:", error);
    return new Response(
      JSON.stringify({ error: "Failed to select repositories" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /selected - Lista repositórios selecionados
 */
async function handleGetSelectedRepos(req: Request, userId: string) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");

  if (!projectId) {
    return new Response(
      JSON.stringify({ error: "projectId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check permissions
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

  const { data: repos, error } = await supabase
    .from("repos")
    .select("*")
    .eq("project_id", projectId)
    .eq("selected", true)
    .order("full_name", { ascending: true });

  if (error) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch selected repos" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ repos: repos || [] }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

