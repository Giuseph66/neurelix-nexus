// Types for the CÓDIGO (Git) module

export type GitProvider = 'github' | 'bitbucket';
export type ConnectionStatus = 'active' | 'error' | 'revoked';
export type PRState = 'OPEN' | 'MERGED' | 'CLOSED';
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
export type CheckConclusion = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'CANCELLED';
export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';
export type CommentSide = 'LEFT' | 'RIGHT';

export interface ProviderConnection {
  id: string;
  project_id: string;
  provider: GitProvider;
  owner_type: 'user' | 'org';
  owner_name: string;
  installation_id?: string;
  workspace_id?: string;
  status: ConnectionStatus;
  secrets_ref: string;
  last_sync_at?: string;
  error_message?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface Repo {
  id: string;
  connection_id: string;
  provider_repo_id: string;
  full_name: string;
  default_branch: string;
  visibility: 'public' | 'private' | 'internal';
  description?: string;
  url?: string;
  last_synced_at?: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  connection?: ProviderConnection;
  branches_count?: number;
  open_prs_count?: number;
}

export interface Branch {
  id: string;
  repo_id: string;
  name: string;
  last_commit_sha?: string;
  is_default: boolean;
  protected: boolean;
  ahead_count: number;
  behind_count: number;
  last_synced_at?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  last_commit?: Commit;
}

export interface Commit {
  id: string;
  repo_id: string;
  sha: string;
  branch_name?: string;
  author_name: string;
  author_email?: string;
  message: string;
  date: string;
  url?: string;
  parent_shas: string[];
  created_at: string;
}

export interface PullRequest {
  id: string;
  repo_id: string;
  number: number;
  title: string;
  description?: string;
  state: PRState;
  source_branch: string;
  target_branch: string;
  author_id?: string;
  author_username?: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  merged_at?: string;
  merge_commit_sha?: string;
  url?: string;
  // Joined fields
  repo?: Repo;
  author?: { id: string; full_name: string; avatar_url?: string };
  reviews?: PRReview[];
  comments_count?: number;
  status_checks?: StatusCheck[];
  review_status?: {
    total_reviews: number;
    approved: number;
    changes_requested: number;
    commented: number;
  };
  linked_tarefas?: Array<{ id: string; key: string; title: string }>;
}

export interface PRReview {
  id: string;
  pr_id: string;
  reviewer_id: string;
  reviewer_username?: string;
  state: ReviewState;
  body?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  reviewer?: { id: string; full_name: string; avatar_url?: string };
}

export interface PRComment {
  id: string;
  pr_id: string;
  author_id: string;
  author_username?: string;
  body: string;
  line_number?: number;
  path?: string;
  side?: CommentSide;
  in_reply_to_id?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  author?: { id: string; full_name: string; avatar_url?: string };
  replies?: PRComment[];
}

export interface StatusCheck {
  id: string;
  pr_id: string;
  name: string;
  conclusion: CheckConclusion;
  details_url?: string;
  started_at?: string;
  completed_at?: string;
  updated_at: string;
}

export interface ProjectRepo {
  project_id: string;
  repo_id: string;
  branch_template: string;
  merge_policy: MergeMethod;
  min_reviews: number;
  require_checks: boolean;
  auto_close_tarefa_on_merge: boolean;
  created_at: string;
  updated_at: string;
  // Joined fields
  repo?: Repo;
}

export interface AuditEvent {
  id: string;
  actor_id: string;
  action: 'CONNECT' | 'CREATE_PR' | 'REVIEW' | 'MERGE' | 'RULE_CHANGE' | 'SYNC';
  entity_type: string;
  entity_id?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_at: string;
  // Joined fields
  actor?: { id: string; full_name: string; avatar_url?: string };
}

// DTOs for API requests
export interface CreatePRInput {
  repoId: string;
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch: string;
  linkedTarefaId?: string;
}

export interface CreatePRCommentInput {
  body: string;
  lineNumber?: number;
  path?: string;
  side?: CommentSide;
  inReplyToId?: string;
}

export interface SubmitReviewInput {
  state: ReviewState;
  body?: string;
}

export interface MergePRInput {
  method: MergeMethod;
  closeTarefaOnMerge?: boolean;
}

export interface LinkTarefaInput {
  tarefaId: string;
  repoId: string;
  branchName?: string;
  prNumber?: number;
  commitSha?: string;
}

export interface CreateBranchFromTarefaInput {
  tarefaId: string;
  repoId: string;
  branchName?: string; // Se não fornecido, usa template do projeto
}

// Tree/Blob types
export interface TreeEntry {
  name: string;
  path: string;
  type: 'tree' | 'blob' | 'dir' | 'file'; // GitHub API usa 'dir' e 'file', mas mantemos 'tree' e 'blob' para compatibilidade
  sha: string;
  size?: number;
  mode: string;
}

export interface BlobContent {
  content: string;
  encoding: 'base64' | 'utf-8';
  size: number;
  sha: string;
  path: string;
}

// File diff types
export interface FileDiff {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  blob_url: string;
  raw_url: string;
}

// Repo overview
export interface RepoOverview {
  repo: Repo;
  readme?: BlobContent;
  recent_commits: Commit[];
  recent_prs: PullRequest[];
  active_branches: Branch[];
  open_prs_count: number;
  pending_reviews_count: number;
  failing_checks_count: number;
}


