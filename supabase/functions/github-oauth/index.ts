import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateAuth, canConnectGit } from "../_shared/permissions.ts";
import { logAuditEvent } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GITHUB_CLIENT_ID = Deno.env.get("GITHUB_CLIENT_ID") || "";
const GITHUB_CLIENT_SECRET = Deno.env.get("GITHUB_CLIENT_SECRET") || "";
const GITHUB_REDIRECT_URI = Deno.env.get("GITHUB_REDIRECT_URI") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  // Log inicial para debug
  console.log("=== github-oauth function called ===", {
    method: req.method,
    url: req.url,
    pathname: new URL(req.url).pathname,
    hasAuth: !!req.headers.get("authorization"),
  });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const pathname = url.pathname;
    
    console.log("Pathname check:", { pathname, includesCallback: pathname.includes("/callback") });
    
    // O callback NÃO requer autenticação (é chamado pelo GitHub diretamente)
    // Verificar diretamente no pathname antes de qualquer processamento
    if (req.method === "GET" && pathname.includes("/callback")) {
      console.log("✅ Handling OAuth callback - no auth required", { 
        pathname, 
        method: req.method,
        url: req.url 
      });
      try {
        const result = await handleOAuthCallback(req);
        console.log("✅ Callback handled successfully");
        return result;
      } catch (callbackError) {
        console.error("❌ Error in handleOAuthCallback:", callbackError);
        const frontendUrl = GITHUB_REDIRECT_URI.split("/callback")[0] || "http://localhost:5173";
        const errorUrl = `${frontendUrl}/project/error?message=${encodeURIComponent("OAuth callback error")}`;
        return new Response(null, {
          status: 302,
          headers: {
            ...corsHeaders,
            Location: errorUrl,
          },
        });
      }
    }
    
    console.log("⚠️ Not a callback, proceeding with auth check");
    
    // Normalizar path para outras rotas
    let path = pathname;
    const prefixes = ["/functions/v1/github-oauth", "/github-oauth"];
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

    const normalizedPath = path === "/" ? "/" : path.replace(/^\/+/, "/");

    // Todas as outras rotas requerem autenticação
    const authHeader = req.headers.get("authorization");
    const { userId, error: authError } = await validateAuth(authHeader);
    
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route handling para rotas autenticadas
    if (req.method === "POST" && normalizedPath === "/start") {
      return await handleOAuthStart(req, userId);
    }

    if (req.method === "GET" && normalizedPath === "/connection") {
      return await handleGetConnection(req, userId);
    }

    if (req.method === "POST" && normalizedPath === "/connection/revoke") {
      return await handleRevokeConnection(req, userId);
    }

    return new Response(
      JSON.stringify({ error: "Not found", path: normalizedPath }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("github-oauth error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * POST /start - Inicia fluxo OAuth
 */
async function handleOAuthStart(req: Request, userId: string) {
  const { projectId } = await req.json();

  if (!projectId) {
    return new Response(
      JSON.stringify({ error: "projectId is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check permissions
  if (!(await canConnectGit(userId, projectId))) {
    return new Response(
      JSON.stringify({ error: "Forbidden: Only admins can connect GitHub" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Generate state UUID
  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Save state
  const { error: stateError } = await supabase
    .from("github_oauth_states")
    .insert({
      state,
      project_id: projectId,
      user_id: userId,
      expires_at: expiresAt.toISOString(),
    });

  if (stateError) {
    console.error("Error saving OAuth state:", stateError);
    return new Response(
      JSON.stringify({ error: "Failed to initiate OAuth" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate required environment variables
  if (!GITHUB_CLIENT_ID || !GITHUB_REDIRECT_URI) {
    console.error("Missing GitHub OAuth configuration:", {
      hasClientId: !!GITHUB_CLIENT_ID,
      hasRedirectUri: !!GITHUB_REDIRECT_URI,
    });
    return new Response(
      JSON.stringify({ 
        error: "GitHub OAuth not configured. Please set GITHUB_CLIENT_ID and GITHUB_REDIRECT_URI environment variables.",
        details: "Contact your administrator to configure GitHub OAuth integration."
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Build GitHub OAuth URL
  // Usar a função separada github-oauth-callback para o callback
  // Construir URL base do Supabase se não estiver configurada
  const supabaseUrl = SUPABASE_URL || "https://hgbnmrhzxewziagjdjke.supabase.co";
  const callbackUrl = GITHUB_REDIRECT_URI && GITHUB_REDIRECT_URI.includes("github-oauth-callback")
    ? GITHUB_REDIRECT_URI
    : `${supabaseUrl}/functions/v1/github-oauth-callback`;
  
  const scopes = "repo read:org";
  const authorizeUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${encodeURIComponent(scopes)}&state=${state}`;
  
  console.log("OAuth URL generated:", { callbackUrl, authorizeUrl });

  return new Response(
    JSON.stringify({ authorizeUrl, state }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * GET /callback - Processa callback OAuth
 * Esta função NÃO requer autenticação (é chamada pelo GitHub diretamente)
 */
async function handleOAuthCallback(req: Request) {
  // Validate required environment variables
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_REDIRECT_URI) {
    console.error("Missing GitHub OAuth configuration in callback");
    const frontendUrl = GITHUB_REDIRECT_URI.split("/callback")[0] || "http://localhost:5173";
    const errorUrl = `${frontendUrl}/project/error?message=${encodeURIComponent("GitHub OAuth not configured")}`;
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: errorUrl,
      },
    });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    const frontendUrl = GITHUB_REDIRECT_URI.split("/callback")[0] || "http://localhost:5173";
    const errorUrl = `${frontendUrl}/project/error?message=${encodeURIComponent("Missing code or state parameter")}`;
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: errorUrl,
      },
    });
  }

  // Validate state e obter userId do banco (não do header de autorização)
  const { data: oauthState, error: stateError } = await supabase
    .from("github_oauth_states")
    .select("*")
    .eq("state", state)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (stateError || !oauthState) {
    const frontendUrl = GITHUB_REDIRECT_URI.split("/callback")[0] || "http://localhost:5173";
    const errorUrl = `${frontendUrl}/project/error?message=${encodeURIComponent("Invalid or expired state")}`;
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: errorUrl,
      },
    });
  }

  // Obter userId do state salvo no banco
  const userId = oauthState.user_id;

  // Exchange code for access token
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_REDIRECT_URI,
    }),
  });

  if (!tokenResponse.ok) {
    const frontendUrl = GITHUB_REDIRECT_URI.split("/callback")[0] || "http://localhost:5173";
    const errorUrl = `${frontendUrl}/project/error?message=${encodeURIComponent("Failed to exchange code for token")}`;
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: errorUrl,
      },
    });
  }

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;
  const scopes = tokenData.scope?.split(",") || [];

  if (!accessToken) {
    const frontendUrl = GITHUB_REDIRECT_URI.split("/callback")[0] || "http://localhost:5173";
    const errorUrl = `${frontendUrl}/project/error?message=${encodeURIComponent("No access token received")}`;
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: errorUrl,
      },
    });
  }

  // Get GitHub user info
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      "Authorization": `token ${accessToken}`,
      "Accept": "application/vnd.github.v3+json",
    },
  });

  if (!userResponse.ok) {
    const frontendUrl = GITHUB_REDIRECT_URI.split("/callback")[0] || "http://localhost:5173";
    const errorUrl = `${frontendUrl}/project/error?message=${encodeURIComponent("Failed to fetch GitHub user")}`;
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: errorUrl,
      },
    });
  }

  const githubUser = await userResponse.json();

  // Encrypt token (simplified - em produção usar pgcrypto ou Vault)
  // Por enquanto, vamos armazenar em texto (em produção deve ser criptografado)
  const accessTokenEncrypted = accessToken; // TODO: Implementar criptografia

  // Create or update connection
  const { data: existingConnection } = await supabase
    .from("provider_connections")
    .select("id")
    .eq("project_id", oauthState.project_id)
    .eq("provider", "github")
    .maybeSingle();

  let connectionId: string;

  if (existingConnection) {
    // Update existing
    const { data, error } = await supabase
      .from("provider_connections")
      .update({
        github_user_id: githubUser.id.toString(),
        username: githubUser.login,
        access_token_encrypted: accessTokenEncrypted,
        scopes,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingConnection.id)
      .select()
      .single();

    if (error) {
      console.error("Error updating connection:", error);
      const frontendUrl = GITHUB_REDIRECT_URI.split("/callback")[0] || "http://localhost:5173";
      const errorUrl = `${frontendUrl}/project/error?message=${encodeURIComponent("Failed to update connection")}`;
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: errorUrl,
        },
      });
    }

    connectionId = data.id;
  } else {
    // Create new
    const { data, error } = await supabase
      .from("provider_connections")
      .insert({
        project_id: oauthState.project_id,
        provider: "github",
        owner_type: "user",
        owner_name: githubUser.login,
        github_user_id: githubUser.id.toString(),
        username: githubUser.login,
        access_token_encrypted: accessTokenEncrypted,
        scopes,
        status: "active",
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating connection:", error);
      const frontendUrl = GITHUB_REDIRECT_URI.split("/callback")[0] || "http://localhost:5173";
      const errorUrl = `${frontendUrl}/project/error?message=${encodeURIComponent("Failed to create connection")}`;
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: errorUrl,
        },
      });
    }

    connectionId = data.id;
  }

  // Delete used state
  await supabase
    .from("github_oauth_states")
    .delete()
    .eq("state", state);

  // Log audit event
  await logAuditEvent(
    userId,
    "CONNECT",
    "provider_connection",
    connectionId,
    null,
    { provider: "github", username: githubUser.login, project_id: oauthState.project_id }
  );

  // Build redirect URL (frontend URL)
  const frontendUrl = GITHUB_REDIRECT_URI.split("/callback")[0] || "http://localhost:5173";
  const redirectUrl = `${frontendUrl}/project/${oauthState.project_id}/code/select-repos?connected=true`;

  // Return redirect response
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: redirectUrl,
    },
  });
}

/**
 * GET /connection - Retorna status da conexão
 */
async function handleGetConnection(req: Request, userId: string) {
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

  // Buscar conexão - usar SERVICE_ROLE_KEY para bypass RLS
  const { data: connection, error: connectionError } = await supabase
    .from("provider_connections")
    .select("id, username, status, scopes, created_at, last_sync_at, project_id, provider")
    .eq("project_id", projectId)
    .eq("provider", "github")
    .maybeSingle();

  console.log("handleGetConnection:", {
    projectId,
    userId,
    connectionFound: !!connection,
    connectionId: connection?.id,
    username: connection?.username,
    status: connection?.status,
    projectIdMatch: connection?.project_id === projectId,
    providerMatch: connection?.provider === "github",
    error: connectionError,
    errorMessage: connectionError?.message,
    errorDetails: connectionError?.details,
  });

  // Verificar se conexão existe e está ativa
  const isConnected = !!connection && connection.status === "active";

  return new Response(
    JSON.stringify({
      connected: isConnected,
      username: connection?.username || null,
      status: connection?.status || null,
      scopes: connection?.scopes || [],
      lastSyncAt: connection?.last_sync_at || null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * POST /connection/revoke - Revoga conexão
 */
async function handleRevokeConnection(req: Request, userId: string) {
  const { projectId } = await req.json();

  if (!projectId) {
    return new Response(
      JSON.stringify({ error: "projectId is required" }),
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

  // Get connection
  const { data: connection } = await supabase
    .from("provider_connections")
    .select("id, access_token_encrypted")
    .eq("project_id", projectId)
    .eq("provider", "github")
    .maybeSingle();

  if (!connection) {
    return new Response(
      JSON.stringify({ error: "Connection not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Revoke token on GitHub (if we have it)
  if (connection.access_token_encrypted) {
    try {
      await fetch("https://api.github.com/applications/" + GITHUB_CLIENT_ID + "/token", {
        method: "DELETE",
        headers: {
          "Authorization": `Basic ${btoa(GITHUB_CLIENT_ID + ":" + GITHUB_CLIENT_SECRET)}`,
          "Accept": "application/vnd.github.v3+json",
        },
        body: JSON.stringify({
          access_token: connection.access_token_encrypted,
        }),
      });
    } catch (error) {
      console.error("Error revoking token on GitHub:", error);
      // Continue anyway
    }
  }

  // Mark as revoked
  const { error } = await supabase
    .from("provider_connections")
    .update({ status: "revoked" })
    .eq("id", connection.id);

  if (error) {
    return new Response(
      JSON.stringify({ error: "Failed to revoke connection" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Remove selected repos
  await supabase
    .from("repos")
    .update({ selected: false })
    .eq("connection_id", connection.id);

  await logAuditEvent(
    userId,
    "CONNECT",
    "provider_connection",
    connection.id,
    { status: "active" },
    { status: "revoked" }
  );

  return new Response(
    JSON.stringify({ ok: true }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

