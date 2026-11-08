-- Asterisk Management Appliance — Database Schema (init)
-- Owned by backend/frontend team. Asterisk (other developer) reads these
-- tables via ODBC realtime. Backend is the only writer.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(80) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'operator', -- admin | operator
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS extensions (
    id SERIAL PRIMARY KEY,
    extension VARCHAR(20) UNIQUE NOT NULL,      -- e.g. 1001
    name VARCHAR(120) NOT NULL,                  -- display name
    secret VARCHAR(80) NOT NULL,                 -- SIP password
    context VARCHAR(80) NOT NULL DEFAULT 'from-internal',
    technology VARCHAR(20) NOT NULL DEFAULT 'PJSIP',
    voicemail_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    voicemail_password VARCHAR(20),
    email VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dialplan (
    id SERIAL PRIMARY KEY,
    pattern VARCHAR(80) NOT NULL,                -- e.g. 1XXX, _1001
    context VARCHAR(80) NOT NULL DEFAULT 'from-internal',
    destination VARCHAR(120) NOT NULL,           -- extension/queue/ivr
    priority INTEGER NOT NULL DEFAULT 1,
    application VARCHAR(80) NOT NULL DEFAULT 'Dial',
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voicemail (
    id SERIAL PRIMARY KEY,
    mailbox VARCHAR(20) UNIQUE NOT NULL,
    password VARCHAR(20) NOT NULL,
    full_name VARCHAR(120),
    email VARCHAR(255),
    attach BOOLEAN NOT NULL DEFAULT FALSE,
    delete_msg BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queues (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    number VARCHAR(20) UNIQUE NOT NULL,          -- extension to dial the queue
    strategy VARCHAR(40) NOT NULL DEFAULT 'ringall', -- ringall|leastrecent|fewestcalls|random|rrmemory
    wrapup_time INTEGER NOT NULL DEFAULT 0,      -- seconds
    max_len INTEGER NOT NULL DEFAULT 0,          -- 0 = unlimited
    timeout INTEGER NOT NULL DEFAULT 60,         -- seconds before abandon
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queue_members (
    id SERIAL PRIMARY KEY,
    queue_id INTEGER NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    interface VARCHAR(80) NOT NULL,              -- e.g. PJSIP/1001
    penalty INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ivr_menus (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    extension VARCHAR(20) UNIQUE NOT NULL,       -- dial to reach IVR
    prompt_file VARCHAR(255),                    -- audio prompt path
    timeout INTEGER NOT NULL DEFAULT 5,          -- seconds
    invalid_prompt_file VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ivr_routes (
    id SERIAL PRIMARY KEY,
    ivr_id INTEGER NOT NULL REFERENCES ivr_menus(id) ON DELETE CASCADE,
    digit VARCHAR(5) NOT NULL,                   -- 0-9, *, #
    destination_type VARCHAR(20) NOT NULL,       -- extension|queue|ivr|hangup|voicemail
    destination VARCHAR(120) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cdr (
    id SERIAL PRIMARY KEY,
    calldate TIMESTAMP NOT NULL DEFAULT NOW(),
    src VARCHAR(80),
    dst VARCHAR(80),
    dcontext VARCHAR(80),
    channel VARCHAR(80),
    dstchannel VARCHAR(80),
    lastapp VARCHAR(80),
    lastdata TEXT,
    duration INTEGER NOT NULL DEFAULT 0,         -- seconds
    billsec INTEGER NOT NULL DEFAULT 0,
    disposition VARCHAR(20),                     -- ANSWERED|BUSY|NO ANSWER|FAILED|CONGESTION
    amaflags VARCHAR(80),
    accountcode VARCHAR(80),
    uniqueid VARCHAR(128),
    userfield TEXT
);

CREATE TABLE IF NOT EXISTS conferences (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    number VARCHAR(20) UNIQUE NOT NULL,
    pin VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    table_name VARCHAR(80),
    record_id INTEGER,
    details TEXT,
    ip VARCHAR(64),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed default admin user (password: admin123 -> change on first login)
INSERT INTO users (username, email, password_hash, role)
VALUES ('admin', 'admin@appliance.local', '$2b$12$LVMdZtyGcbOqfcWQ21U80Ot4wKeCod7iiLG9/7JObI6X36ZTT61JW', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Seed sample dialplan numbering plan
INSERT INTO dialplan (pattern, context, destination, priority, application, description)
VALUES
    ('_1XXX', 'from-internal', 'EXTENSION', 1, 'Dial', 'Admin extensions 1000-1999'),
    ('_2XXX', 'from-internal', 'EXTENSION', 1, 'Dial', 'Finance extensions 2000-2999'),
    ('_3XXX', 'from-internal', 'EXTENSION', 1, 'Dial', 'IT extensions 3000-3999'),
    ('_4XXX', 'from-internal', 'EXTENSION', 1, 'Dial', 'Customer Service 4000-4999'),
    ('_5XXX', 'from-internal', 'EXTENSION', 1, 'Dial', 'Management 5000-5999')
ON CONFLICT DO NOTHING;
