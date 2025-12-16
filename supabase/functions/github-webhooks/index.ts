import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { processAutoLink } from "../_shared/auto-link.ts";
import { updateTarefaStatusFromPR, updateTarefaStatusOnPRApproved } from "../_shared/tarefa-status.ts";
import { logAuditEvent } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GITHUB_WEBHOOK_SECRET = Deno.env.get("GITHUB_WEBHOOK_SECRET") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get headers
    const signature = req.headers.get("x-hub-signature-256");
    const eventType = req.headers.get("x-github-event");
    const deliveryId = req.headers.get("x-github-delivery");

    if (!eventType || !deliveryId) {
      return new Response(
        JSON.stringify({ error: "Missing required headers" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get payload
    const payload = await req.text();
    const payloadObj = JSON.parse(payload);

    // Validate signature
    let signatureOk = false;
    if (GITHUB_WEBHOOK_SECRET && signature) {
      const crypto = globalThis.crypto;
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(GITHUB_WEBHOOK_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      const signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const expectedSignature = `sha256=${signatureHex}`;
      signatureOk = signature === expectedSignature;
    } else {
      // If no secret configured, allow (for development)
      signatureOk = true;
    }

    // Log webhook event
    const { data: logEntry } = await supabase
      .from("webhook_event_logs")
      .insert({
        event_type: eventType,
        delivery_id: deliveryId,
        signature_ok: signatureOk,
        processed_ok: false,
        payload: payloadObj,
      })
      .select()
      .single();

    if (!signatureOk && GITHUB_WEBHOOK_SECRET) {
      await supabase
        .from("webhook_event_logs")
        .update({ error: "Invalid signature", processed_ok: false })
        .eq("id", logEntry.id);

      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process event
    let processedOk = false;
    let error: string | null = null;

    try {
      if (eventType === "push") {
        await handlePushEvent(payloadObj);
        processedOk = true;
      } else if (eventType === "pull_request") {
        await handlePullRequestEvent(payloadObj);
        processedOk = true;
      } else if (eventType === "pull_request_review") {
        await handlePullRequestReviewEvent(payloadObj);
        processedOk = true;
      } else {
        // Unknown event type, but not an error
        processedOk = true;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Unknown error";
      console.error(`Error processing webhook event ${eventType}:`, e);
    }

    // Update log
    await supabase
      .from("webhook_event_logs")
      .update({ processed_ok: processedOk, error })
      .eq("id", logEntry.id);

    // Log audit event
    if (processedOk) {
      await logAuditEvent(
        "system",
        "WEBHOOK_EVENT",
        "Webhook",
        deliveryId,
        null,
        { event_type: eventType, delivery_id: deliveryId }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, processed: processedOk }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("github-webhooks error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Handle push event
 */
async function handlePushEvent(payload: any) {
  const repoFullName = payload.repository.full_name;
  const branchName = payload.ref.replace("refs/heads/", "");
  const commits = payload.commits || [];

  // Find repo
  const { data: repo } = await supabase
    .from("repos")
    .select("id, project_id, connection_id")
    .eq("full_name", repoFullName)
    .maybeSingle();

  if (!repo || !repo.project_id) return;

  // Process each commit
  for (const commit of commits) {
    const commitSha = commit.id;
    const commitMessage = commit.message;

    // Check if commit already exists
    const { data: existingCommit } = await supabase
      .from("commits")
      .select("id")
      .eq("repo_id", repo.id)
      .eq("sha", commitSha)
      .maybeSingle();

    if (!existingCommit) {
      // Create commit record
      const { data: newCommit } = await supabase
        .from("commits")
        .insert({
          repo_id: repo.id,
          sha: commitSha,
          branch_name: branchName,
          author_name: commit.author.name || commit.author.username,
          author_email: commit.author.email,
          message: commitMessage,
          date: commit.timestamp,
          url: commit.url,
        })
        .select()
        .single();

      if (newCommit) {
        // Auto-link by TSK-123 in commit message
        await processAutoLink(
          commitMessage,
          repo.project_id,
          repo.id,
          "commit",
          newCommit.id,
          { commitSha, branchName }
        );
      }
    }
  }

  // Update branch
  await supabase
    .from("branches")
    .upsert(
      {
        repo_id: repo.id,
        name: branchName,
        last_commit_sha: commits[commits.length - 1]?.id || null,
        last_synced_at: new Date().toISOString(),
      },
      {
        onConflict: "repo_id,name",
      }
    );

  // Auto-link by branch name
  await processAutoLink(
    branchName,
    repo.project_id,
    repo.id,
    "branch",
    branchName,
    { branchName }
  );
}

/**
 * Handle pull_request event
 */
async function handlePullRequestEvent(payload: any) {
  const action = payload.action; // opened, closed, synchronize, etc.
  const pr = payload.pull_request;
  const repoFullName = payload.repository.full_name;

  // Find repo
  const { data: repo } = await supabase
    .from("repos")
    .select("id, project_id, connection_id")
    .eq("full_name", repoFullName)
    .maybeSingle();

  if (!repo || !repo.project_id) return;

  // Upsert PR
  const prState = pr.merged
    ? "MERGED"
    : pr.state === "closed"
    ? "CLOSED"
    : "OPEN";

  const { data: prRecord } = await supabase
    .from("pull_requests")
    .upsert(
      {
        repo_id: repo.id,
        number: pr.number,
        title: pr.title,
        description: pr.body || "",
        state: prState,
        source_branch: pr.head.ref,
        target_branch: pr.base.ref,
        author_username: pr.user.login,
        draft: pr.draft || false,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        merged_at: pr.merged_at,
        url: pr.html_url,
      },
      {
        onConflict: "repo_id,number",
      }
    )
    .select()
    .single();

  if (prRecord) {
    // Auto-link by TSK-123 in title, body, or branch
    const textToSearch = `${pr.title} ${pr.body || ""} ${pr.head.ref}`;
    await processAutoLink(
      textToSearch,
      repo.project_id,
      repo.id,
      "pull_request",
      prRecord.id,
      { branchName: pr.head.ref, prNumber: pr.number }
    );

    // Update tarefa status based on PR state
    if (action === "opened" || action === "closed" || action === "reopened") {
      await updateTarefaStatusFromPR(prRecord.id, prState, repo.project_id);
    }
  }
}

/**
 * Handle pull_request_review event
 */
async function handlePullRequestReviewEvent(payload: any) {
  const review = payload.review;
  const pr = payload.pull_request;
  const repoFullName = payload.repository.full_name;

  // Find repo
  const { data: repo } = await supabase
    .from("repos")
    .select("id, project_id")
    .eq("full_name", repoFullName)
    .maybeSingle();

  if (!repo) return;

  // Find PR
  const { data: prRecord } = await supabase
    .from("pull_requests")
    .select("id")
    .eq("repo_id", repo.id)
    .eq("number", pr.number)
    .maybeSingle();

  if (!prRecord) return;

  // Upsert review
  const reviewState =
    review.state === "approved"
      ? "APPROVED"
      : review.state === "changes_requested"
      ? "CHANGES_REQUESTED"
      : "COMMENTED";

  await supabase
    .from("pr_reviews")
    .upsert(
      {
        pr_id: prRecord.id,
        reviewer_username: review.user.login,
        state: reviewState,
        body: review.body || "",
        submitted_at: review.submitted_at,
        url: review.html_url,
      },
      {
        onConflict: "pr_id,reviewer_username",
      }
    );

  // Update tarefa status if PR is approved
  if (reviewState === "APPROVED") {
    await updateTarefaStatusOnPRApproved(prRecord.id, repo.project_id);
  }
}

