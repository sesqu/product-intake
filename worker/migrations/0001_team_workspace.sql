-- Product Intake team mode (Cloudflare D1 only; do NOT import from KV in place).
-- Store workspace records in a transactional database: KV last-write-wins is unsafe
-- for simultaneous editing and per-user access rules.
CREATE TABLE IF NOT EXISTS team_users (
 workspace_id TEXT NOT NULL,
 email TEXT NOT NULL COLLATE NOCASE,
 access_sub TEXT,
 role TEXT NOT NULL CHECK(role IN ('owner','manager','tester','viewer')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,email)
);
CREATE UNIQUE INDEX IF NOT EXISTS team_user_subject_unique
 ON team_users(workspace_id,access_sub) WHERE access_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS team_products (
 workspace_id TEXT NOT NULL,
 lpn_key TEXT NOT NULL,
 lpn TEXT NOT NULL,
 data_json TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 locked_by TEXT,
 lock_expires_at INTEGER,
 lock_changed_at INTEGER,
 lock_updated_by TEXT,
 updated_by TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 deleted_at INTEGER,
 PRIMARY KEY(workspace_id,lpn_key)
);
CREATE INDEX IF NOT EXISTS team_products_recent
 ON team_products(workspace_id,deleted_at,updated_at DESC,lpn_key);
CREATE INDEX IF NOT EXISTS team_products_assigned
 ON team_products(workspace_id,locked_by,lock_expires_at);

CREATE TABLE IF NOT EXISTS team_events (
 event_id INTEGER PRIMARY KEY AUTOINCREMENT,
 workspace_id TEXT NOT NULL,
 lpn_key TEXT NOT NULL,
 revision INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('create','update','claim','release','soft-delete')),
 actor_email TEXT NOT NULL,
 at INTEGER NOT NULL,
 data_json TEXT
);
CREATE INDEX IF NOT EXISTS team_events_by_product
 ON team_events(workspace_id,lpn_key,event_id DESC);

-- Triggers make history insertion atomic with the actual D1 product write.
CREATE TRIGGER IF NOT EXISTS team_product_created
AFTER INSERT ON team_products
BEGIN
 INSERT INTO team_events(workspace_id,lpn_key,revision,action,actor_email,at,data_json)
 VALUES (NEW.workspace_id,NEW.lpn_key,NEW.revision,'create',
         NEW.updated_by,NEW.updated_at,NEW.data_json);
END;

CREATE TRIGGER IF NOT EXISTS team_product_updated
AFTER UPDATE ON team_products
BEGIN
 INSERT INTO team_events(workspace_id,lpn_key,revision,action,actor_email,at,data_json)
 VALUES (NEW.workspace_id,NEW.lpn_key,NEW.revision,
   CASE WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'soft-delete'
        WHEN NEW.revision>OLD.revision THEN 'update'
        WHEN NEW.locked_by IS NULL THEN 'release'
        ELSE 'claim' END,
   CASE WHEN NEW.revision>OLD.revision OR NEW.deleted_at IS NOT OLD.deleted_at
        THEN NEW.updated_by ELSE NEW.lock_updated_by END,
   CASE WHEN NEW.revision>OLD.revision OR NEW.deleted_at IS NOT OLD.deleted_at
        THEN NEW.updated_at ELSE NEW.lock_changed_at END,
   NEW.data_json);
END;
