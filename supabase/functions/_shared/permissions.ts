// Shared permission utilities for Edge Functions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export type AppRole = "admin" | "tech_lead" | "developer" | "viewer";

/**
 * Gets user's role in a project
 */
export async function getProjectRole(
  userId: string,
  projectId: string
): Promise<AppRole | null> {
  const { data, error } = await supabase
    .from("project_members")
    .select("role")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.role as AppRole;
}

/**
 * Checks if user can connect Git providers (admin only)
 */
export async function canConnectGit(
  userId: string,
  projectId: string
): Promise<boolean> {
  const role = await getProjectRole(userId, projectId);
  return role === "admin";
}

/**
 * Checks if user can create PRs (developers+)
 */
export async function canCreatePR(
  userId: string,
  projectId: string
): Promise<boolean> {
  const role = await getProjectRole(userId, projectId);
  return role === "admin" || role === "tech_lead" || role === "developer";
}

/**
 * Checks if user can review PRs (cannot be PR author)
 */
export async function canReviewPR(
  userId: string,
  prId: string
): Promise<boolean> {
  // Get PR author and repo
  const { data: pr } = await supabase
    .from("pull_requests")
    .select("author_id, repo_id")
    .eq("id", prId)
    .maybeSingle();

  if (!pr || pr.author_id === userId) {
    return false; // Cannot review own PR
  }

  // Get project from repo
  const { data: projectRepo } = await supabase
    .from("project_repos")
    .select("project_id")
    .eq("repo_id", pr.repo_id)
    .maybeSingle();

  if (!projectRepo) return false;

  const role = await getProjectRole(userId, projectRepo.project_id);
  return role !== null; // Any project member can review
}

/**
 * Checks if user can merge PRs (admin/tech_lead only)
 */
export async function canMergePR(
  userId: string,
  prId: string
): Promise<boolean> {
  // Get project from PR
  const { data: pr } = await supabase
    .from("pull_requests")
    .select("repo_id")
    .eq("id", prId)
    .maybeSingle();

  if (!pr) return false;

  const { data: projectRepo } = await supabase
    .from("project_repos")
    .select("project_id")
    .eq("repo_id", pr.repo_id)
    .maybeSingle();

  if (!projectRepo) return false;

  const role = await getProjectRole(userId, projectRepo.project_id);
  return role === "admin" || role === "tech_lead";
}

/**
 * Validates JWT and extracts user ID
 */
export async function validateAuth(
  authHeader: string | null
): Promise<{ userId: string; error?: string }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { userId: "", error: "Missing or invalid authorization header" };
  }

  const token = authHeader.replace("Bearer ", "");

  // Verify token with Supabase
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return { userId: "", error: "Invalid token" };
  }

  return { userId: data.user.id };
}

