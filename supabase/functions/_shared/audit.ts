// Shared audit logging utilities for Edge Functions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export type AuditAction =
  | "CONNECT"
  | "CREATE_PR"
  | "REVIEW"
  | "MERGE"
  | "RULE_CHANGE"
  | "SYNC"
  | "WEBHOOK_EVENT";

/**
 * Logs an audit event
 */
export async function logAuditEvent(
  actorId: string,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  before: Record<string, unknown> | null = null,
  after: Record<string, unknown> | null = null
): Promise<void> {
  try {
    // For system/webhook events, use a placeholder UUID or skip actor_id requirement
    // In production, you might want to create a system user
    const finalActorId = actorId === "system" ? "00000000-0000-0000-0000-000000000000" : actorId;

    await supabase.from("audit_events").insert({
      actor_id: finalActorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      before: before ? (before as unknown) : null,
      after: after ? (after as unknown) : null,
      metadata: {},
    });
  } catch (error) {
    console.error("Failed to log audit event:", error);
    // Don't throw - audit logging should not break the main flow
  }
}


