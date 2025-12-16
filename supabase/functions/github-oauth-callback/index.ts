import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
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
const FRONTEND_URL = Deno.env.get("FRONTEND_URL") || "http://localhost:8080";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Helper para obter URL do frontend
function getFrontendUrl(): string {
  // Se FRONTEND_URL estiver configurado, usar
  if (FRONTEND_URL && FRONTEND_URL !== "http://localhost:8080") {
    return FRONTEND_URL;
  }
  return FRONTEND_URL;
}

serve(async (req) => {
  // Retornar imediatamente para garantir que a função está sendo executada
  // Esta função é COMPLETAMENTE PÚBLICA - não requer autenticação
  
  console.log("=== github-oauth-callback function called ===", {
    method: req.method,
    url: req.url,
    headers: Object.fromEntries(req.headers.entries()),
  });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Esta função é pública - não requer autenticação
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  
  // Retornar resposta imediata para debug
  console.log("Processing GET request - no auth required");

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    console.log("OAuth callback received:", { code: !!code, state });

    // Validate required environment variables
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_REDIRECT_URI) {
      console.error("Missing GitHub OAuth configuration");
      const frontendUrl = getFrontendUrl();
      // Tentar obter project_id do state se disponível
      let projectId = "";
      if (state) {
        const { data: oauthState } = await supabase
          .from("github_oauth_states")
          .select("project_id")
          .eq("state", state)
          .maybeSingle();
        if (oauthState?.project_id) {
          projectId = oauthState.project_id;
        }
      }
      const errorPath = projectId ? `/project/${projectId}/code/repos?error=${encodeURIComponent("GitHub OAuth not configured")}` : `/project/error?message=${encodeURIComponent("GitHub OAuth not configured")}`;
      const errorUrl = `${frontendUrl}${errorPath}`;
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: errorUrl,
        },
      });
    }

    if (!code || !state) {
      console.error("Missing code or state", { code: !!code, state: !!state });
      const frontendUrl = getFrontendUrl();
      // Tentar obter project_id do state se disponível
      let projectId = "";
      if (state) {
        const { data: oauthState } = await supabase
          .from("github_oauth_states")
          .select("project_id")
          .eq("state", state)
          .maybeSingle();
        if (oauthState?.project_id) {
          projectId = oauthState.project_id;
        }
      }
      const errorPath = projectId ? `/project/${projectId}/code/repos?error=${encodeURIComponent("Missing code or state parameter")}` : `/project/error?message=${encodeURIComponent("Missing code or state parameter")}`;
      const errorUrl = `${frontendUrl}${errorPath}`;
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: errorUrl,
        },
      });
    }

    // Validate state e obter userId e projectId do banco
    const { data: oauthState, error: stateError } = await supabase
      .from("github_oauth_states")
      .select("*")
      .eq("state", state)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (stateError || !oauthState) {
      console.error("Invalid or expired state", { stateError, oauthState: !!oauthState });
      const frontendUrl = getFrontendUrl();
      // Tentar obter project_id mesmo com state inválido (pode estar expirado mas ainda ter project_id)
      let projectId = "";
      if (state) {
        const { data: expiredState } = await supabase
          .from("github_oauth_states")
          .select("project_id")
          .eq("state", state)
          .maybeSingle();
        if (expiredState?.project_id) {
          projectId = expiredState.project_id;
        }
      }
      const errorPath = projectId ? `/project/${projectId}/code/repos?error=${encodeURIComponent("Invalid or expired state")}` : `/project/error?message=${encodeURIComponent("Invalid or expired state")}`;
      const errorUrl = `${frontendUrl}${errorPath}`;
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: errorUrl,
        },
      });
    }

    const userId = oauthState.user_id;
    const projectId = oauthState.project_id;
    console.log("State validated, userId:", userId, "projectId:", projectId);

    // Exchange code for access token
    console.log("Exchanging code for token:", {
      hasClientId: !!GITHUB_CLIENT_ID,
      hasClientSecret: !!GITHUB_CLIENT_SECRET,
      clientIdLength: GITHUB_CLIENT_ID?.length,
      clientSecretLength: GITHUB_CLIENT_SECRET?.length,
      redirectUri: GITHUB_REDIRECT_URI,
      codeLength: code?.length,
    });
    
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
      const errorText = await tokenResponse.text();
      console.error("Failed to exchange code for token", {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        body: errorText,
      });
      let errorMsg = "Failed to exchange code for token";
      try {
        const errorData = JSON.parse(errorText);
        errorMsg = errorData.error_description || errorData.error || errorMsg;
      } catch (e) {
        // Usar mensagem padrão
      }
      const frontendUrl = getFrontendUrl();
      const errorUrl = `${frontendUrl}/project/${projectId}/code/repos?error=${encodeURIComponent(errorMsg)}`;
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: errorUrl,
        },
      });
    }

    const tokenData = await tokenResponse.json();
    console.log("Token response received:", {
      hasAccessToken: !!tokenData.access_token,
      hasError: !!tokenData.error,
      error: tokenData.error,
      errorDescription: tokenData.error_description,
      keys: Object.keys(tokenData),
    });
    
    const accessToken = tokenData.access_token;
    const scopes = tokenData.scope?.split(",") || [];

    if (!accessToken) {
      const errorMsg = tokenData.error_description || tokenData.error || "No access token received";
      console.error("No access token received", {
        tokenData,
        error: tokenData.error,
        errorDescription: tokenData.error_description,
      });
      const frontendUrl = getFrontendUrl();
      const errorUrl = `${frontendUrl}/project/${projectId}/code/repos?error=${encodeURIComponent(errorMsg)}`;
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: errorUrl,
        },
      });
    }

    console.log("Access token received, fetching GitHub user info");

    // Get GitHub user info
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `token ${accessToken}`,
        "Accept": "application/vnd.github.v3+json",
      },
    });

    if (!userResponse.ok) {
      console.error("Failed to fetch GitHub user", await userResponse.text());
      const frontendUrl = getFrontendUrl();
      const errorUrl = `${frontendUrl}/project/${projectId}/code/repos?error=${encodeURIComponent("Failed to fetch GitHub user")}`;
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: errorUrl,
        },
      });
    }

    const githubUser = await userResponse.json();
    console.log("GitHub user fetched:", githubUser.login);

    // Encrypt token (simplified - em produção usar pgcrypto ou Vault)
    const accessTokenEncrypted = accessToken; // TODO: Implementar criptografia

    // Create or update connection
    console.log("Checking for existing connection:", {
      projectId: oauthState.project_id,
      provider: "github",
    });
    
    const { data: existingConnection, error: checkError } = await supabase
      .from("provider_connections")
      .select("id, status, username")
      .eq("project_id", oauthState.project_id)
      .eq("provider", "github")
      .maybeSingle();

    console.log("Existing connection check:", {
      found: !!existingConnection,
      connectionId: existingConnection?.id,
      status: existingConnection?.status,
      username: existingConnection?.username,
      error: checkError,
    });

    let connectionId: string;

    if (existingConnection) {
      // Update existing
      console.log("Updating existing connection:", existingConnection.id);
      const { data, error } = await supabase
        .from("provider_connections")
        .update({
          github_user_id: githubUser.id.toString(),
          username: githubUser.login,
          access_token_encrypted: accessTokenEncrypted,
          scopes,
          status: "active",
          updated_at: new Date().toISOString(),
          secrets_ref: `github_oauth_${projectId}_${userId}`, // Referência simples para OAuth
        })
        .eq("id", existingConnection.id)
        .select()
        .single();

      if (error) {
        console.error("❌ Error updating connection:", {
          error,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        const frontendUrl = getFrontendUrl();
        const errorUrl = `${frontendUrl}/project/${projectId}/code/repos?error=${encodeURIComponent("Failed to update connection: " + error.message)}`;
        return new Response(null, {
          status: 302,
          headers: {
            ...corsHeaders,
            Location: errorUrl,
          },
        });
      }

      connectionId = data.id;
      console.log("✅ Connection updated:", {
        connectionId,
        projectId,
        username: githubUser.login,
        status: data.status,
      });
    } else {
      // Create new
      console.log("Creating new connection");
      const connectionData = {
        project_id: projectId,
        provider: "github",
        owner_type: "user",
        owner_name: githubUser.login,
        github_user_id: githubUser.id.toString(),
        username: githubUser.login,
        access_token_encrypted: accessTokenEncrypted,
        scopes,
        status: "active",
        created_by: userId,
        secrets_ref: `github_oauth_${projectId}_${userId}`, // Referência simples para OAuth
      };
      
      console.log("Inserting connection data:", {
        ...connectionData,
        access_token_encrypted: "[REDACTED]",
      });
      
      const { data, error } = await supabase
        .from("provider_connections")
        .insert(connectionData)
        .select()
        .single();

      if (error) {
        console.error("❌ Error creating connection:", {
          error,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          connectionData: {
            ...connectionData,
            access_token_encrypted: "[REDACTED]",
          },
        });
        const frontendUrl = getFrontendUrl();
        const errorUrl = `${frontendUrl}/project/${projectId}/code/repos?error=${encodeURIComponent("Failed to create connection: " + error.message)}`;
        return new Response(null, {
          status: 302,
          headers: {
            ...corsHeaders,
            Location: errorUrl,
          },
        });
      }

      connectionId = data.id;
      console.log("✅ Connection created:", {
        connectionId,
        projectId,
        username: githubUser.login,
        status: data.status,
        fullData: data,
      });
    }

    console.log("✅ Connection saved successfully:", {
      connectionId,
      projectId,
      username: githubUser.login,
    });

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
      { provider: "github", username: githubUser.login, project_id: projectId }
    );

    // Build redirect URL (frontend URL) - redirecionar para a página de repositórios
    const frontendUrl = getFrontendUrl();
    const redirectUrl = `${frontendUrl}/project/${projectId}/code/repos?connected=true`;

    console.log("✅ OAuth callback successful!", {
      userId,
      projectId,
      githubUsername: githubUser.login,
      connectionId,
      redirectUrl,
    });

    // Return redirect response
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: redirectUrl,
      },
    });
  } catch (error) {
    console.error("github-oauth-callback error:", error);
    const frontendUrl = getFrontendUrl();
    // Tentar obter project_id do state se disponível mesmo em caso de erro
    const url = new URL(req.url);
    const state = url.searchParams.get("state");
    let projectId = "";
    if (state) {
      try {
        const { data: oauthState } = await supabase
          .from("github_oauth_states")
          .select("project_id")
          .eq("state", state)
          .maybeSingle();
        if (oauthState?.project_id) {
          projectId = oauthState.project_id;
        }
      } catch (e) {
        // Ignorar erro ao buscar project_id
      }
    }
    const errorPath = projectId ? `/project/${projectId}/code/repos?error=${encodeURIComponent("Internal server error")}` : `/project/error?message=${encodeURIComponent("Internal server error")}`;
    const errorUrl = `${frontendUrl}${errorPath}`;
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: errorUrl,
      },
    });
  }
});

