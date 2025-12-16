import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateAuth, canConnectGit } from "../_shared/permissions.ts";
import { logAuditEvent } from "../_shared/audit.ts";
import { getGitHubAppClient } from "../_shared/github-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GITHUB_APP_ID = Deno.env.get("GITHUB_APP_ID") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Supabase Edge Functions: quando deployado, o pathname pode vir de diferentes formas
    // Exemplo: /functions/v1/git-connect/connections ou apenas /connections
    // Vamos normalizar removendo o prefixo da função
    let path = url.pathname;
    
    // Remove todos os prefixos possíveis
    const prefixes = [
      "/functions/v1/git-connect",
      "/git-connect",
    ];
    
    for (const prefix of prefixes) {
      if (path.startsWith(prefix)) {
        path = path.slice(prefix.length);
        break;
      }
    }
    
    // Normaliza path: sempre começa com / ou é vazio (que vira /)
    if (path === "" || path === "/") {
      path = "/";
    } else if (!path.startsWith("/")) {
      path = "/" + path;
    }
    
    const authHeader = req.headers.get("authorization");

    // Validate authentication
    const { userId, error: authError } = await validateAuth(authHeader);
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route handling
    // Normalizar path removendo barra inicial se necessário para comparação
    const normalizedPath = path === "/" ? "/" : path.replace(/^\/+/, "/");
    
    if (req.method === "POST" && (normalizedPath === "/start" || normalizedPath === "/")) {
      return await handleStartConnection(req, userId);
    }

    if (req.method === "POST" && normalizedPath === "/callback") {
      return await handleCallback(req, userId);
    }

    if (req.method === "GET" && normalizedPath === "/connections") {
      return await handleGetConnections(req, userId);
    }

    if (req.method === "POST" && normalizedPath === "/sync") {
      return await handleSync(req, userId);
    }

    if (req.method === "DELETE" && normalizedPath.startsWith("/connections/")) {
      const parts = normalizedPath.split("/").filter(Boolean);
      const connectionId = parts[parts.length - 1];
      return await handleDeleteConnection(connectionId, userId);
    }

    // Debug: retornar informações sobre o path recebido
    console.log("Path received:", normalizedPath, "Method:", req.method, "Full URL:", url.pathname);
    
    return new Response(
      JSON.stringify({ 
        error: "Not found",
        debug: {
          path: normalizedPath,
          method: req.method,
          fullPathname: url.pathname,
          searchParams: Object.fromEntries(url.searchParams)
        }
      }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("git-connect error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * POST /start - Inicia fluxo de conexão GitHub App
 */
async function handleStartConnection(req: Request, userId: string) {
  const { projectId, provider = "github" } = await req.json();

  if (!projectId) {
    return new Response(
      JSON.stringify({ error: "projectId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check permissions
  if (!(await canConnectGit(userId, projectId))) {
    return new Response(
      JSON.stringify({ error: "Forbidden: Only admins can connect Git providers" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (provider === "github") {
    // Generate GitHub App installation URL
    const installationUrl = `https://github.com/apps/${GITHUB_APP_ID}/installations/new`;
    
    // For GitHub App, we need to redirect user to install
    // Store state in a temporary table or return URL
    return new Response(
      JSON.stringify({
        url: installationUrl,
        provider: "github",
        type: "github_app",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ error: "Unsupported provider" }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * POST /callback - Processa callback após instalação GitHub App
 */
async function handleCallback(req: Request, userId: string) {
  const { projectId, installationId, provider = "github", ownerType, ownerName } = await req.json();

  if (!projectId || !installationId) {
    return new Response(
      JSON.stringify({ error: "projectId and installationId are required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check permissions
  if (!(await canConnectGit(userId, projectId))) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Get installation info from GitHub
    const octokit = await getGitHubAppClient();
    const { data: installation } = await octokit.apps.getInstallation({
      installation_id: parseInt(installationId),
    });

    // Store connection in database
    // For now, use a simple secrets_ref (in production, store in Vault)
    const secretsRef = `github_installation_${installationId}`;

    const { data: connection, error } = await supabase
      .from("provider_connections")
      .insert({
        project_id: projectId,
        provider: provider as "github",
        owner_type: ownerType || (installation.account?.type === "Organization" ? "org" : "user"),
        owner_name: ownerName || installation.account?.login || "",
        installation_id: installationId,
        status: "active",
        secrets_ref: secretsRef,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating connection:", error);
      return new Response(
        JSON.stringify({ error: "Failed to create connection" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log audit event
    await logAuditEvent(
      userId,
      "CONNECT",
      "provider_connection",
      connection.id,
      null,
      { provider, installation_id: installationId },
      { project_id: projectId }
    );

    // Trigger initial sync
    // This would be done asynchronously in production
    await syncRepos(connection.id, userId);

    return new Response(
      JSON.stringify({ connection }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Callback error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process callback" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * GET /connections - Lista conexões do projeto
 */
async function handleGetConnections(req: Request, userId: string) {
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

  const { data: connections, error } = await supabase
    .from("provider_connections")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch connections" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get repo counts for each connection
  const connectionsWithCounts = await Promise.all(
    (connections || []).map(async (conn) => {
      const { count } = await supabase
        .from("repos")
        .select("*", { count: "exact", head: true })
        .eq("connection_id", conn.id);

      return {
        ...conn,
        repos_count: count || 0,
      };
    })
  );

  return new Response(
    JSON.stringify({ connections: connectionsWithCounts }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * POST /sync - Dispara sincronização manual
 */
async function handleSync(req: Request, userId: string) {
  const url = new URL(req.url);
  const repoId = url.searchParams.get("repoId");
  const connectionId = url.searchParams.get("connectionId");

  if (!connectionId && !repoId) {
    return new Response(
      JSON.stringify({ error: "connectionId or repoId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (connectionId) {
    await syncRepos(connectionId, userId);
  } else if (repoId) {
    // Sync single repo
    const { data: repo } = await supabase
      .from("repos")
      .select("connection_id")
      .eq("id", repoId)
      .maybeSingle();

    if (repo) {
      await syncRepos(repo.connection_id, userId);
    }
  }

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * DELETE /connections/:id - Revoga conexão
 */
async function handleDeleteConnection(connectionId: string, userId: string) {
  // Get connection to check permissions
  const { data: connection } = await supabase
    .from("provider_connections")
    .select("project_id")
    .eq("id", connectionId)
    .maybeSingle();

  if (!connection) {
    return new Response(
      JSON.stringify({ error: "Connection not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!(await canConnectGit(userId, connection.project_id))) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Mark as revoked
  const { error } = await supabase
    .from("provider_connections")
    .update({ status: "revoked" })
    .eq("id", connectionId);

  if (error) {
    return new Response(
      JSON.stringify({ error: "Failed to revoke connection" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  await logAuditEvent(
    userId,
    "CONNECT",
    "provider_connection",
    connectionId,
    { status: "active" },
    { status: "revoked" },
    {}
  );

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * Sync repositories from GitHub
 */
async function syncRepos(connectionId: string, userId: string) {
  try {
    const { data: connection } = await supabase
      .from("provider_connections")
      .select("*")
      .eq("id", connectionId)
      .maybeSingle();

    if (!connection || !connection.installation_id) {
      throw new Error("Connection not found or invalid");
    }

    // Get GitHub client
    const { getGitHubClient } = await import("../_shared/github-client.ts");
    const octokit = await getGitHubClient({
      connectionId,
      installationId: connection.installation_id,
    });

    // List repositories accessible to this installation
    const { data: installations } = await octokit.apps.listInstallationReposForAuthenticatedUser({
      installation_id: parseInt(connection.installation_id),
      per_page: 100,
    });

    const repos = installations.repositories || [];

    // Sync each repository
    for (const repo of repos) {
      const repoData = {
        connection_id: connectionId,
        provider_repo_id: repo.id.toString(),
        full_name: repo.full_name,
        default_branch: repo.default_branch || "main",
        visibility: repo.visibility || "private",
        description: repo.description || null,
        url: repo.html_url,
        sync_status: "synced",
        last_synced_at: new Date().toISOString(),
      };

      // Upsert repo
      const { error: repoError } = await supabase
        .from("repos")
        .upsert(repoData, {
          onConflict: "connection_id,provider_repo_id",
        });

      if (repoError) {
        console.error(`Error syncing repo ${repo.full_name}:`, repoError);
        continue;
      }

      // Get repo ID
      const { data: syncedRepo } = await supabase
        .from("repos")
        .select("id")
        .eq("connection_id", connectionId)
        .eq("provider_repo_id", repo.id.toString())
        .maybeSingle();

      if (syncedRepo) {
        // Sync branches
        await syncBranches(syncedRepo.id, repo.full_name, octokit);
      }
    }

    // Update connection last_sync_at
    await supabase
      .from("provider_connections")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", connectionId);

    await logAuditEvent(
      userId,
      "SYNC",
      "provider_connection",
      connectionId,
      null,
      { repos_synced: repos.length },
      {}
    );
  } catch (error) {
    console.error("Sync error:", error);
    await supabase
      .from("provider_connections")
      .update({
        status: "error",
        error_message: error instanceof Error ? error.message : "Unknown error",
      })
      .eq("id", connectionId);
  }
}

/**
 * Sync branches for a repository
 */
async function syncBranches(repoId: string, repoFullName: string, octokit: any) {
  try {
    const [owner, repo] = repoFullName.split("/");
    const { data: branches } = await octokit.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });

    for (const branch of branches || []) {
      const branchData = {
        repo_id: repoId,
        name: branch.name,
        last_commit_sha: branch.commit.sha,
        is_default: branch.name === "main" || branch.name === "master",
        protected: branch.protected || false,
      };

      await supabase
        .from("branches")
        .upsert(branchData, {
          onConflict: "repo_id,name",
        });
    }
  } catch (error) {
    console.error(`Error syncing branches for ${repoFullName}:`, error);
  }
}


