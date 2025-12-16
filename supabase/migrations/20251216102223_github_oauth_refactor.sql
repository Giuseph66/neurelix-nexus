-- Migração: Refatoração para OAuth GitHub (estilo Vercel/Lovable)
-- Ajusta tabelas existentes e adiciona novas para suportar OAuth flow

-- ============================================================
-- AJUSTAR TABELAS EXISTENTES
-- ============================================================

-- provider_connections: Adicionar campos OAuth
ALTER TABLE public.provider_connections
    ADD COLUMN IF NOT EXISTS github_user_id text,
    ADD COLUMN IF NOT EXISTS username text,
    ADD COLUMN IF NOT EXISTS access_token_encrypted text, -- Token criptografado (usar pgcrypto)
    ADD COLUMN IF NOT EXISTS scopes text[] DEFAULT ARRAY[]::text[],
    -- installation_id pode ser NULL para OAuth
    ALTER COLUMN installation_id DROP NOT NULL,
    ALTER COLUMN secrets_ref DROP NOT NULL;

-- repos: Adicionar selected e project_id direto
ALTER TABLE public.repos
    ADD COLUMN IF NOT EXISTS selected boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
    -- connection_id pode ser NULL temporariamente durante seleção
    ALTER COLUMN connection_id DROP NOT NULL;

-- Criar índice para project_id em repos
CREATE INDEX IF NOT EXISTS idx_repos_project_id ON public.repos(project_id);
CREATE INDEX IF NOT EXISTS idx_repos_selected ON public.repos(selected);

-- ============================================================
-- NOVAS TABELAS
-- ============================================================

-- github_oauth_states: Estados temporários do OAuth flow
CREATE TABLE IF NOT EXISTS public.github_oauth_states (
    state uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '5 minutes')
);

-- Índice para limpeza de estados expirados
CREATE INDEX IF NOT EXISTS idx_github_oauth_states_expires ON public.github_oauth_states(expires_at);

-- Função para limpar estados expirados (executar periodicamente)
CREATE OR REPLACE FUNCTION public.cleanup_expired_oauth_states()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.github_oauth_states
    WHERE expires_at < now();
END;
$$;

-- webhook_event_logs: Log de eventos webhook
CREATE TABLE IF NOT EXISTS public.webhook_event_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    event_type text NOT NULL,
    delivery_id text NOT NULL UNIQUE,
    signature_ok boolean DEFAULT false,
    processed_ok boolean DEFAULT false,
    error text,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_event_logs_event_type ON public.webhook_event_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_event_logs_created ON public.webhook_event_logs(created_at DESC);

-- ============================================================
-- FUNÇÃO PARA AUTO-LINK POR TSK-123
-- ============================================================

-- Função para detectar e criar links automáticos
CREATE OR REPLACE FUNCTION public.detect_and_link_tarefas(
    p_text text,
    p_repo_id uuid,
    p_project_id uuid,
    p_entity_type text, -- 'branch', 'commit', 'pull_request'
    p_entity_id uuid,
    p_branch_name text DEFAULT NULL,
    p_commit_sha text DEFAULT NULL,
    p_pr_number integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_match text;
    v_tarefa_key text;
    v_tarefa_id uuid;
BEGIN
    -- Regex para encontrar TSK-123 ou TSK-ABC-123
    -- Padrão: TSK- seguido de números ou letras-números
    FOR v_match IN 
        SELECT regexp_matches(p_text, 'TSK-([A-Z0-9]+(?:-[A-Z0-9]+)*)', 'gi')
    LOOP
        -- Extrair a chave da tarefa (TSK-123)
        v_tarefa_key := 'TSK-' || (v_match)[1];
        
        -- Buscar tarefa pelo key no projeto
        SELECT id INTO v_tarefa_id
        FROM public.tarefas
        WHERE project_id = p_project_id
        AND key = v_tarefa_key
        LIMIT 1;
        
        -- Se encontrou a tarefa, criar link se não existir
        IF v_tarefa_id IS NOT NULL THEN
            INSERT INTO public.tarefa_git_links (
                tarefa_id,
                provider,
                branch,
                commit_sha,
                pr_number,
                metadata
            )
            VALUES (
                v_tarefa_id,
                'github',
                p_branch_name,
                p_commit_sha,
                p_pr_number,
                jsonb_build_object(
                    'entity_type', p_entity_type,
                    'entity_id', p_entity_id,
                    'auto_linked', true,
                    'detected_from', p_text
                )
            )
            ON CONFLICT DO NOTHING; -- Evita duplicatas
        END IF;
    END LOOP;
END;
$$;

-- ============================================================
-- TRIGGERS PARA AUTO-LINK
-- ============================================================

-- Trigger para commits: detectar TSK-123 na mensagem
CREATE OR REPLACE FUNCTION public.auto_link_commit_tarefas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_id uuid;
BEGIN
    -- Obter project_id do repo
    SELECT project_id INTO v_project_id
    FROM public.repos
    WHERE id = NEW.repo_id;
    
    IF v_project_id IS NOT NULL THEN
        -- Detectar TSK-123 na mensagem do commit
        PERFORM public.detect_and_link_tarefas(
            NEW.message,
            NEW.repo_id,
            v_project_id,
            'commit',
            NEW.id,
            NEW.branch_name,
            NEW.sha,
            NULL
        );
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_auto_link_commits
    AFTER INSERT ON public.commits
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_link_commit_tarefas();

-- Trigger para pull_requests: detectar TSK-123 no título/descrição/branch
CREATE OR REPLACE FUNCTION public.auto_link_pr_tarefas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_id uuid;
    v_text_to_search text;
BEGIN
    -- Obter project_id do repo
    SELECT project_id INTO v_project_id
    FROM public.repos
    WHERE id = NEW.repo_id;
    
    IF v_project_id IS NOT NULL THEN
        -- Combinar título, descrição e branch para busca
        v_text_to_search := COALESCE(NEW.title, '') || ' ' || 
                           COALESCE(NEW.description, '') || ' ' || 
                           COALESCE(NEW.source_branch, '');
        
        -- Detectar TSK-123
        PERFORM public.detect_and_link_tarefas(
            v_text_to_search,
            NEW.repo_id,
            v_project_id,
            'pull_request',
            NEW.id,
            NEW.source_branch,
            NULL,
            NEW.number
        );
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_auto_link_prs
    AFTER INSERT ON public.pull_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_link_pr_tarefas();

-- Trigger para branches: detectar TSK-123 no nome
CREATE OR REPLACE FUNCTION public.auto_link_branch_tarefas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_id uuid;
BEGIN
    -- Obter project_id do repo
    SELECT project_id INTO v_project_id
    FROM public.repos
    WHERE id = NEW.repo_id;
    
    IF v_project_id IS NOT NULL THEN
        -- Detectar TSK-123 no nome da branch
        PERFORM public.detect_and_link_tarefas(
            NEW.name,
            NEW.repo_id,
            v_project_id,
            'branch',
            NEW.id,
            NEW.name,
            NULL,
            NULL
        );
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_auto_link_branches
    AFTER INSERT ON public.branches
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_link_branch_tarefas();

-- ============================================================
-- RLS PARA NOVAS TABELAS
-- ============================================================

-- github_oauth_states: apenas o usuário que criou pode ver
ALTER TABLE public.github_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own oauth states"
    ON public.github_oauth_states
    FOR ALL
    USING (auth.uid() = user_id);

-- webhook_event_logs: apenas admins podem ver
ALTER TABLE public.webhook_event_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view webhook logs"
    ON public.webhook_event_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.user_id = auth.uid()
            AND pm.role = 'admin'
        )
    );

-- ============================================================
-- AJUSTAR RLS DE repos PARA SUPORTAR project_id
-- ============================================================

-- Atualizar política de repos para considerar project_id
DROP POLICY IF EXISTS "Members can view repos" ON public.repos;

CREATE POLICY "Members can view repos"
    ON public.repos
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.project_members pm
            WHERE pm.project_id = COALESCE(repos.project_id, 
                (SELECT pr.project_id FROM public.project_repos pr WHERE pr.repo_id = repos.id LIMIT 1))
            AND pm.user_id = auth.uid()
        )
    );

