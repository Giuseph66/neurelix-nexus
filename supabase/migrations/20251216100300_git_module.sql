-- Módulo CÓDIGO (Git) - Migração completa
-- Cria todas as tabelas, tipos, índices e RLS necessários

-- ============================================================
-- TIPOS ENUM
-- ============================================================

CREATE TYPE public.git_provider AS ENUM ('github', 'bitbucket');
CREATE TYPE public.connection_status AS ENUM ('active', 'error', 'revoked');
CREATE TYPE public.pr_state AS ENUM ('OPEN', 'MERGED', 'CLOSED');
CREATE TYPE public.review_state AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED');
CREATE TYPE public.check_conclusion AS ENUM ('SUCCESS', 'FAILURE', 'PENDING', 'CANCELLED');
CREATE TYPE public.merge_method AS ENUM ('MERGE', 'SQUASH', 'REBASE');
CREATE TYPE public.audit_action AS ENUM ('CONNECT', 'CREATE_PR', 'REVIEW', 'MERGE', 'RULE_CHANGE', 'SYNC');
CREATE TYPE public.comment_side AS ENUM ('LEFT', 'RIGHT');

-- ============================================================
-- TABELAS PRINCIPAIS
-- ============================================================

-- provider_connections: Armazena conexões OAuth/GitHub App
CREATE TABLE public.provider_connections (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    provider public.git_provider NOT NULL DEFAULT 'github',
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'org')),
    owner_name text NOT NULL,
    installation_id text, -- GitHub App installation ID
    workspace_id text, -- Bitbucket workspace ID
    status public.connection_status NOT NULL DEFAULT 'active',
    secrets_ref text NOT NULL, -- Referência ao Supabase Vault
    last_sync_at timestamp with time zone,
    error_message text,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- repos: Catálogo de repositórios sincronizados
CREATE TABLE public.repos (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    connection_id uuid NOT NULL REFERENCES public.provider_connections(id) ON DELETE CASCADE,
    provider_repo_id text NOT NULL,
    full_name text NOT NULL, -- owner/repo
    default_branch text NOT NULL,
    visibility text NOT NULL CHECK (visibility IN ('public', 'private', 'internal')),
    description text,
    url text,
    last_synced_at timestamp with time zone,
    sync_status text DEFAULT 'pending',
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE(connection_id, provider_repo_id)
);

-- branches: Branches dos repositórios
CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    repo_id uuid NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
    name text NOT NULL,
    last_commit_sha text,
    is_default boolean DEFAULT false,
    protected boolean DEFAULT false,
    ahead_count integer DEFAULT 0,
    behind_count integer DEFAULT 0,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE(repo_id, name)
);

-- commits: Commits dos repositórios
CREATE TABLE public.commits (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    repo_id uuid NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
    sha text NOT NULL,
    branch_name text,
    author_name text NOT NULL,
    author_email text,
    message text NOT NULL,
    date timestamp with time zone NOT NULL,
    url text,
    parent_shas text[], -- Array de SHAs dos commits pais
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE(repo_id, sha)
);

-- pull_requests: Pull Requests
CREATE TABLE public.pull_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    repo_id uuid NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
    number integer NOT NULL,
    title text NOT NULL,
    description text,
    state public.pr_state NOT NULL DEFAULT 'OPEN',
    source_branch text NOT NULL,
    target_branch text NOT NULL DEFAULT 'main',
    author_id uuid REFERENCES auth.users(id),
    author_username text,
    draft boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    merged_at timestamp with time zone,
    merge_commit_sha text,
    url text,
    UNIQUE(repo_id, number)
);

-- pr_reviews: Reviews de Pull Requests
CREATE TABLE public.pr_reviews (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    pr_id uuid NOT NULL REFERENCES public.pull_requests(id) ON DELETE CASCADE,
    reviewer_id uuid NOT NULL REFERENCES auth.users(id),
    reviewer_username text,
    state public.review_state NOT NULL,
    body text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE(pr_id, reviewer_id)
);

-- pr_comments: Comentários em PRs (gerais e por linha)
CREATE TABLE public.pr_comments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    pr_id uuid NOT NULL REFERENCES public.pull_requests(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES auth.users(id),
    author_username text,
    body text NOT NULL,
    line_number integer,
    path text,
    side public.comment_side,
    in_reply_to_id uuid REFERENCES public.pr_comments(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- pr_status_checks: Status checks/CI
CREATE TABLE public.pr_status_checks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    pr_id uuid NOT NULL REFERENCES public.pull_requests(id) ON DELETE CASCADE,
    name text NOT NULL,
    conclusion public.check_conclusion NOT NULL DEFAULT 'PENDING',
    details_url text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE(pr_id, name)
);

-- project_repos: Vínculo de repositórios com projetos
CREATE TABLE public.project_repos (
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    repo_id uuid NOT NULL REFERENCES public.repos(id) ON DELETE CASCADE,
    branch_template text DEFAULT 'feature/{taskKey}-{title}',
    merge_policy public.merge_method DEFAULT 'MERGE',
    min_reviews integer DEFAULT 1,
    require_checks boolean DEFAULT false,
    auto_close_tarefa_on_merge boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (project_id, repo_id)
);

-- audit_events: Auditoria de ações críticas
CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES auth.users(id),
    action public.audit_action NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    before jsonb,
    after jsonb,
    metadata jsonb DEFAULT '{}',
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================================
-- ESTENDER tarefa_git_links
-- ============================================================

-- Adicionar campos novos à tabela existente
ALTER TABLE public.tarefa_git_links 
    ADD COLUMN IF NOT EXISTS pr_id uuid REFERENCES public.pull_requests(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS commit_ids text[] DEFAULT '{}';

-- ============================================================
-- ÍNDICES PARA PERFORMANCE
-- ============================================================

CREATE INDEX idx_repos_connection_id ON public.repos(connection_id);
CREATE INDEX idx_repos_full_name ON public.repos(full_name);
CREATE INDEX idx_branches_repo_id ON public.branches(repo_id);
CREATE INDEX idx_branches_name ON public.branches(name);
CREATE INDEX idx_commits_repo_id ON public.commits(repo_id);
CREATE INDEX idx_commits_sha ON public.commits(sha);
CREATE INDEX idx_commits_branch ON public.commits(repo_id, branch_name);
CREATE INDEX idx_commits_message_gin ON public.commits USING gin(to_tsvector('english', message));
CREATE INDEX idx_pull_requests_repo_state ON public.pull_requests(repo_id, state);
CREATE INDEX idx_pull_requests_state ON public.pull_requests(state);
CREATE INDEX idx_pull_requests_author ON public.pull_requests(author_id);
CREATE INDEX idx_pr_reviews_pr_id ON public.pr_reviews(pr_id);
CREATE INDEX idx_pr_reviews_reviewer ON public.pr_reviews(reviewer_id);
CREATE INDEX idx_pr_comments_pr_id ON public.pr_comments(pr_id);
CREATE INDEX idx_pr_status_checks_pr_id ON public.pr_status_checks(pr_id);
CREATE INDEX idx_project_repos_project ON public.project_repos(project_id);
CREATE INDEX idx_project_repos_repo ON public.project_repos(repo_id);
CREATE INDEX idx_audit_events_actor ON public.audit_events(actor_id);
CREATE INDEX idx_audit_events_entity ON public.audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_events_created ON public.audit_events(created_at DESC);
CREATE INDEX idx_tarefa_git_links_pr_id ON public.tarefa_git_links(pr_id);

-- ============================================================
-- FUNÇÕES SQL HELPER
-- ============================================================

-- get_repo_project: Retorna project_id associado a um repo
CREATE OR REPLACE FUNCTION public.get_repo_project(p_repo_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
    SELECT project_id
    FROM project_repos
    WHERE repo_id = p_repo_id
    LIMIT 1;
$$;

-- can_merge_pr: Verifica permissões de merge
CREATE OR REPLACE FUNCTION public.can_merge_pr(p_user_id uuid, p_pr_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_project_id uuid;
    v_user_role public.app_role;
BEGIN
    -- Obter project_id do PR
    SELECT get_repo_project(r.id) INTO v_project_id
    FROM pull_requests pr
    JOIN repos r ON r.id = pr.repo_id
    WHERE pr.id = p_pr_id;
    
    IF v_project_id IS NULL THEN
        RETURN false;
    END IF;
    
    -- Verificar role do usuário
    SELECT role INTO v_user_role
    FROM project_members
    WHERE user_id = p_user_id AND project_id = v_project_id;
    
    -- Apenas admin e tech_lead podem fazer merge
    RETURN v_user_role IN ('admin', 'tech_lead');
END;
$$;

-- get_pr_review_status: Agrega reviews para decisão
CREATE OR REPLACE FUNCTION public.get_pr_review_status(p_pr_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
    SELECT jsonb_build_object(
        'total_reviews', COUNT(*),
        'approved', COUNT(*) FILTER (WHERE state = 'APPROVED'),
        'changes_requested', COUNT(*) FILTER (WHERE state = 'CHANGES_REQUESTED'),
        'commented', COUNT(*) FILTER (WHERE state = 'COMMENTED')
    )
    FROM pr_reviews
    WHERE pr_id = p_pr_id;
$$;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- provider_connections: apenas admins podem criar/atualizar
ALTER TABLE public.provider_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage connections"
    ON public.provider_connections
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = provider_connections.project_id
            AND pm.user_id = auth.uid()
            AND pm.role = 'admin'
        )
    );

CREATE POLICY "Members can view connections"
    ON public.provider_connections
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = provider_connections.project_id
            AND pm.user_id = auth.uid()
        )
    );

-- repos: membros do projeto podem visualizar
ALTER TABLE public.repos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view repos"
    ON public.repos
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.project_repos pr
            JOIN public.projects p ON p.id = pr.project_id
            JOIN public.project_members pm ON pm.project_id = p.id
            WHERE pr.repo_id = repos.id
            AND pm.user_id = auth.uid()
        )
    );

-- branches: membros do projeto podem visualizar
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view branches"
    ON public.branches
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.repos r
            JOIN public.project_repos pr ON pr.repo_id = r.id
            JOIN public.project_members pm ON pm.project_id = pr.project_id
            WHERE r.id = branches.repo_id
            AND pm.user_id = auth.uid()
        )
    );

-- commits: membros do projeto podem visualizar
ALTER TABLE public.commits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view commits"
    ON public.commits
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.repos r
            JOIN public.project_repos pr ON pr.repo_id = r.id
            JOIN public.project_members pm ON pm.project_id = pr.project_id
            WHERE r.id = commits.repo_id
            AND pm.user_id = auth.uid()
        )
    );

-- pull_requests: membros podem visualizar, developers+ podem criar
ALTER TABLE public.pull_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view PRs"
    ON public.pull_requests
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.repos r
            JOIN public.project_repos pr ON pr.repo_id = r.id
            JOIN public.project_members pm ON pm.project_id = pr.project_id
            WHERE r.id = pull_requests.repo_id
            AND pm.user_id = auth.uid()
        )
    );

CREATE POLICY "Developers can create PRs"
    ON public.pull_requests
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.repos r
            JOIN public.project_repos pr ON pr.repo_id = r.id
            JOIN public.project_members pm ON pm.project_id = pr.project_id
            WHERE r.id = pull_requests.repo_id
            AND pm.user_id = auth.uid()
            AND pm.role IN ('admin', 'tech_lead', 'developer')
        )
    );

-- pr_reviews: membros podem visualizar, reviewers podem criar
ALTER TABLE public.pr_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view reviews"
    ON public.pr_reviews
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.pull_requests pr
            JOIN public.repos r ON r.id = pr.repo_id
            JOIN public.project_repos prj ON prj.repo_id = r.id
            JOIN public.project_members pm ON pm.project_id = prj.project_id
            WHERE pr.id = pr_reviews.pr_id
            AND pm.user_id = auth.uid()
        )
    );

CREATE POLICY "Reviewers can create reviews"
    ON public.pr_reviews
    FOR INSERT
    WITH CHECK (
        reviewer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.pull_requests pr
            JOIN public.repos r ON r.id = pr.repo_id
            JOIN public.project_repos prj ON prj.repo_id = r.id
            JOIN public.project_members pm ON pm.project_id = prj.project_id
            WHERE pr.id = pr_reviews.pr_id
            AND pm.user_id = auth.uid()
            AND pr.author_id != auth.uid() -- Não pode revisar próprio PR
        )
    );

-- pr_comments: membros podem visualizar/criar
ALTER TABLE public.pr_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view comments"
    ON public.pr_comments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.pull_requests pr
            JOIN public.repos r ON r.id = pr.repo_id
            JOIN public.project_repos prj ON prj.repo_id = r.id
            JOIN public.project_members pm ON pm.project_id = prj.project_id
            WHERE pr.id = pr_comments.pr_id
            AND pm.user_id = auth.uid()
        )
    );

CREATE POLICY "Members can create comments"
    ON public.pr_comments
    FOR INSERT
    WITH CHECK (
        author_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.pull_requests pr
            JOIN public.repos r ON r.id = pr.repo_id
            JOIN public.project_repos prj ON prj.repo_id = r.id
            JOIN public.project_members pm ON pm.project_id = prj.project_id
            WHERE pr.id = pr_comments.pr_id
            AND pm.user_id = auth.uid()
        )
    );

-- pr_status_checks: membros podem visualizar
ALTER TABLE public.pr_status_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view status checks"
    ON public.pr_status_checks
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.pull_requests pr
            JOIN public.repos r ON r.id = pr.repo_id
            JOIN public.project_repos prj ON prj.repo_id = r.id
            JOIN public.project_members pm ON pm.project_id = prj.project_id
            WHERE pr.id = pr_status_checks.pr_id
            AND pm.user_id = auth.uid()
        )
    );

-- project_repos: apenas admins/tech_leads podem gerenciar
ALTER TABLE public.project_repos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view project repos"
    ON public.project_repos
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = project_repos.project_id
            AND pm.user_id = auth.uid()
        )
    );

CREATE POLICY "Admins can manage project repos"
    ON public.project_repos
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = project_repos.project_id
            AND pm.user_id = auth.uid()
            AND pm.role IN ('admin', 'tech_lead')
        )
    );

-- audit_events: apenas admins podem visualizar
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit events"
    ON public.audit_events
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.user_id = auth.uid()
            AND pm.role = 'admin'
        )
    );

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_provider_connections_updated_at
    BEFORE UPDATE ON public.provider_connections
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_repos_updated_at
    BEFORE UPDATE ON public.repos
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_branches_updated_at
    BEFORE UPDATE ON public.branches
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pull_requests_updated_at
    BEFORE UPDATE ON public.pull_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pr_reviews_updated_at
    BEFORE UPDATE ON public.pr_reviews
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pr_comments_updated_at
    BEFORE UPDATE ON public.pr_comments
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pr_status_checks_updated_at
    BEFORE UPDATE ON public.pr_status_checks
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_project_repos_updated_at
    BEFORE UPDATE ON public.project_repos
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();


