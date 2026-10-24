-- Application schema.
--
-- This migration is intentionally idempotent: existing deployments created
-- these tables with GORM, while a fresh installation runs this file.  Column
-- types and historical names (notably app_extensions.s_ip_password) match the
-- schema used by the previous backend.

CREATE TABLE IF NOT EXISTS app_users (
    id              UUID PRIMARY KEY,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    username        VARCHAR(64) NOT NULL,
    email           VARCHAR(255),
    full_name       VARCHAR(120),
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(32) NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    last_login_ip   VARCHAR(64)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username ON app_users (username);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users (email);
CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users (role);
CREATE INDEX IF NOT EXISTS idx_app_users_active ON app_users (active);

CREATE TABLE IF NOT EXISTS app_refresh_tokens (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL,
    token_hash      VARCHAR(64) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    replaced_by     VARCHAR(64),
    user_agent      VARCHAR(255),
    ip              VARCHAR(64),
    created_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_refresh_tokens_token_hash ON app_refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_app_refresh_tokens_user_id ON app_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_app_refresh_tokens_expires_at ON app_refresh_tokens (expires_at);

CREATE TABLE IF NOT EXISTS app_extensions (
    id                  UUID PRIMARY KEY,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    number              VARCHAR(16) NOT NULL,
    display_name        VARCHAR(120),
    user_id             UUID,
    context             VARCHAR(64) NOT NULL DEFAULT 'internal',
    codecs              VARCHAR(255) NOT NULL DEFAULT 'ulaw,alaw,opus,g722',
    s_ip_password       VARCHAR(255) NOT NULL,
    caller_id           VARCHAR(120),
    voicemail_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    voicemail_pin       VARCHAR(32),
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    description         VARCHAR(255)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_extensions_number ON app_extensions (number);
CREATE INDEX IF NOT EXISTS idx_app_extensions_user_id ON app_extensions (user_id);
CREATE INDEX IF NOT EXISTS idx_app_extensions_context ON app_extensions (context);
CREATE INDEX IF NOT EXISTS idx_app_extensions_enabled ON app_extensions (enabled);

CREATE TABLE IF NOT EXISTS app_dialplan_rules (
    id              UUID PRIMARY KEY,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    context         VARCHAR(64) NOT NULL,
    pattern         VARCHAR(64) NOT NULL,
    priority        INTEGER NOT NULL,
    app             VARCHAR(64) NOT NULL,
    app_data        VARCHAR(512),
    description     VARCHAR(255),
    enabled         BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_dialplan_unique ON app_dialplan_rules (context, pattern, priority);

CREATE TABLE IF NOT EXISTS app_voicemail_boxes (
    id              UUID PRIMARY KEY,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    extension       VARCHAR(16) NOT NULL,
    context         VARCHAR(64) NOT NULL,
    name            VARCHAR(120),
    email           VARCHAR(255),
    pin             VARCHAR(32) NOT NULL,
    time_zone       VARCHAR(64),
    max_messages    INTEGER NOT NULL DEFAULT 50,
    active          BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vm_extension_context ON app_voicemail_boxes (extension, context);

CREATE TABLE IF NOT EXISTS app_queues (
    id                  UUID PRIMARY KEY,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    name                VARCHAR(128) NOT NULL,
    strategy            VARCHAR(32) NOT NULL DEFAULT 'ringall',
    timeout             INTEGER NOT NULL DEFAULT 30,
    music_on_hold       VARCHAR(128),
    ring_in_use         BOOLEAN NOT NULL DEFAULT FALSE,
    max_wait            INTEGER NOT NULL DEFAULT 300,
    announce            VARCHAR(128),
    announce_frequency  INTEGER NOT NULL DEFAULT 0,
    description         VARCHAR(255),
    active              BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_queues_name ON app_queues (name);

CREATE TABLE IF NOT EXISTS app_queue_members (
    id              UUID PRIMARY KEY,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    queue_id        UUID NOT NULL,
    interface       VARCHAR(80) NOT NULL,
    member_name     VARCHAR(120),
    penalty         INTEGER NOT NULL DEFAULT 0,
    paused          BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_member ON app_queue_members (queue_id, interface);

CREATE TABLE IF NOT EXISTS app_ivr_menus (
    id              UUID PRIMARY KEY,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    name            VARCHAR(120) NOT NULL,
    description     VARCHAR(255),
    greeting_sound  VARCHAR(255),
    invalid_sound   VARCHAR(255),
    timeout         INTEGER NOT NULL DEFAULT 5,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    active          BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_ivr_menus_name ON app_ivr_menus (name);

CREATE TABLE IF NOT EXISTS app_ivr_options (
    id                  UUID PRIMARY KEY,
    created_at          TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    menu_id             UUID NOT NULL,
    digit               VARCHAR(4) NOT NULL,
    destination_type    VARCHAR(32) NOT NULL,
    destination         VARCHAR(128) NOT NULL,
    description         VARCHAR(255),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT fk_app_ivr_menus_options FOREIGN KEY (menu_id)
        REFERENCES app_ivr_menus(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_app_ivr_options_menu_id ON app_ivr_options (menu_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ivr_option ON app_ivr_options (menu_id, digit);

CREATE TABLE IF NOT EXISTS app_conference_rooms (
    id              UUID PRIMARY KEY,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    number          VARCHAR(32) NOT NULL,
    name            VARCHAR(120),
    pin             VARCHAR(32),
    max_members     INTEGER NOT NULL DEFAULT 10,
    muted           BOOLEAN NOT NULL DEFAULT FALSE,
    record          BOOLEAN NOT NULL DEFAULT FALSE,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    description     VARCHAR(255)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_conference_rooms_number ON app_conference_rooms (number);

CREATE TABLE IF NOT EXISTS app_audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID,
    username        VARCHAR(64),
    action          VARCHAR(64),
    entity_type     VARCHAR(64),
    entity_id       VARCHAR(64),
    method          VARCHAR(12),
    path            VARCHAR(255),
    status_code     BIGINT,
    ip              VARCHAR(64),
    user_agent      VARCHAR(255),
    details         TEXT,
    created_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_app_audit_logs_user_id ON app_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_app_audit_logs_username ON app_audit_logs (username);
CREATE INDEX IF NOT EXISTS idx_app_audit_logs_action ON app_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_app_audit_logs_entity_type ON app_audit_logs (entity_type);
CREATE INDEX IF NOT EXISTS idx_app_audit_logs_created_at ON app_audit_logs (created_at);

CREATE TABLE IF NOT EXISTS app_settings (
    key             VARCHAR(120) PRIMARY KEY,
    value           TEXT NOT NULL,
    description     VARCHAR(255),
    updated_by      VARCHAR(64),
    updated_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app_backups (
    id              UUID PRIMARY KEY,
    created_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    filename        VARCHAR(255) NOT NULL,
    size_bytes      BIGINT,
    status          VARCHAR(32) NOT NULL,
    includes        VARCHAR(255),
    error           TEXT,
    created_by      VARCHAR(64),
    completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_app_backups_status ON app_backups (status);

CREATE TABLE IF NOT EXISTS cdr (
    id              BIGSERIAL PRIMARY KEY,
    calldate        TIMESTAMPTZ NOT NULL,
    clid            VARCHAR(80),
    src             VARCHAR(80),
    dst             VARCHAR(80),
    dcontext        VARCHAR(80),
    channel         VARCHAR(80),
    dstchannel      VARCHAR(80),
    lastapp         VARCHAR(80),
    lastdata        VARCHAR(80),
    duration        BIGINT NOT NULL DEFAULT 0,
    billsec         BIGINT NOT NULL DEFAULT 0,
    disposition     VARCHAR(45),
    amaflags        BIGINT NOT NULL DEFAULT 0,
    accountcode     VARCHAR(80),
    uniqueid        VARCHAR(150),
    userfield       VARCHAR(255),
    peeraccount     VARCHAR(80),
    linkedid        VARCHAR(150),
    sequence        BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cdr_calldate ON cdr (calldate);
CREATE INDEX IF NOT EXISTS idx_cdr_src ON cdr (src);
CREATE INDEX IF NOT EXISTS idx_cdr_dst ON cdr (dst);
CREATE INDEX IF NOT EXISTS idx_cdr_disposition ON cdr (disposition);
CREATE INDEX IF NOT EXISTS idx_cdr_uniqueid ON cdr (uniqueid);
CREATE INDEX IF NOT EXISTS idx_cdr_linkedid ON cdr (linkedid);
