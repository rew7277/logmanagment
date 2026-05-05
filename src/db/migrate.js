import { query, hasDatabase } from './pool.js';

const statements = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  `CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, slug)
  )`,
  `CREATE TABLE IF NOT EXISTS environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    health_score NUMERIC(5,2) NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'healthy',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workspace_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    owner TEXT,
    runtime_version TEXT,
    app_version TEXT,
    status TEXT NOT NULL DEFAULT 'healthy',
    health_score NUMERIC(5,2) NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(environment_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'healthy',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(service_id, method, path)
  )`,
  `CREATE TABLE IF NOT EXISTS log_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    endpoint_id UUID REFERENCES endpoints(id) ON DELETE SET NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    severity TEXT NOT NULL CHECK (severity IN ('DEBUG','INFO','WARN','ERROR','FATAL')),
    trace_id TEXT,
    message TEXT NOT NULL,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_logs_env_time ON log_events(environment_id, timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_trace ON log_events(trace_id) WHERE trace_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_logs_severity ON log_events(environment_id, severity, timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_message_fts ON log_events USING GIN (to_tsvector('simple', message))`,
  `CREATE INDEX IF NOT EXISTS idx_logs_raw_gin ON log_events USING GIN (raw)`,
  `CREATE TABLE IF NOT EXISTS traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    endpoint_id UUID REFERENCES endpoints(id) ON DELETE SET NULL,
    trace_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'success',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE(environment_id, trace_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_traces_env_time ON traces(environment_id, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    endpoint_id UUID REFERENCES endpoints(id) ON DELETE SET NULL,
    severity TEXT NOT NULL CHECK (severity IN ('INFO','P3','P2','P1')),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_env_status ON alerts(environment_id, status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    version TEXT NOT NULL,
    deployed_by TEXT,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    before_error_rate NUMERIC(7,4),
    after_error_rate NUMERIC(7,4),
    before_p95_ms INTEGER,
    after_p95_ms INTEGER,
    notes TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deploy_env_time ON deployments(environment_id, deployed_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('S3','API','UPLOAD')),
    source_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'healthy',
    last_received_at TIMESTAMPTZ,
    accepted_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    parser_errors INTEGER NOT NULL DEFAULT 0,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE log_events ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES ingestion_jobs(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_logs_upload ON log_events(upload_id) WHERE upload_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_ingestion_env ON ingestion_jobs(environment_id, status)`,
  `CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'INFO',
    message TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_security_env_time ON security_events(environment_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(environment_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_saved_search_env ON saved_searches(environment_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    metric TEXT NOT NULL,
    operator TEXT NOT NULL DEFAULT '>',
    threshold NUMERIC(12,3) NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('INFO','P3','P2','P1')) DEFAULT 'P2',
    service_name TEXT,
    endpoint_path TEXT,
    window_minutes INTEGER NOT NULL DEFAULT 15,
    enabled BOOLEAN NOT NULL DEFAULT true,
    notify_webhook BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(environment_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alert_rules_env_enabled ON alert_rules(environment_id, enabled)`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS metric TEXT`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS current_value NUMERIC(12,3)`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS threshold NUMERIC(12,3)`,
  `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS fingerprint TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_env_fingerprint_open ON alerts(environment_id, fingerprint) WHERE status='open' AND fingerprint IS NOT NULL`
,
  `DO $$
   DECLARE r record;
   BEGIN
     FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='environments'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%PROD%UAT%DEV%DR%'
     LOOP EXECUTE 'ALTER TABLE environments DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname); END LOOP;
   EXCEPTION WHEN undefined_table THEN NULL;
   END $$`,
  `CREATE TABLE IF NOT EXISTS environment_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL UNIQUE REFERENCES environments(id) ON DELETE CASCADE,
    retention_days INTEGER NOT NULL DEFAULT 30,
    archive_to_s3 BOOLEAN NOT NULL DEFAULT false,
    max_upload_mb INTEGER NOT NULL DEFAULT 750,
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 180,
    ingest_rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
    allowed_ingestion_sources TEXT[] NOT NULL DEFAULT ARRAY['UPLOAD','API','S3'],
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS masking_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    pattern TEXT,
    replacement TEXT NOT NULL DEFAULT '[MASKED]',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(environment_id, field_name)
  )`,
  `CREATE TABLE IF NOT EXISTS rca_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID NOT NULL UNIQUE REFERENCES environments(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'local',
    model TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_masking_rules_env_enabled ON masking_rules(environment_id, enabled)`,
  `ALTER TABLE masking_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id UUID REFERENCES environments(id) ON DELETE CASCADE,
    actor TEXT DEFAULT 'system',
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    before_value JSONB,
    after_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_env_time ON audit_logs(environment_id, created_at DESC)`
];

export async function migrate() {
  if (!hasDatabase) {
    console.warn('[db] DATABASE_URL missing. Skipping migrations.');
    return;
  }
  for (const sql of statements) {
    await query(sql);
  }
  console.log('[db] migrations completed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[db] migration failed', error);
      process.exit(1);
    });
}
