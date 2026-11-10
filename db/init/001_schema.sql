-- Fresh-database schema, not a migration. Deliberately fail on existing objects.
-- Consumer fields derived from Asterisk tag certified-22.8-cert4:
-- contrib/ast-db-manage/config/versions/ and cdr/versions/.
-- See ../README.md for provenance, supported subset, and application deviations.
\set ON_ERROR_STOP on
BEGIN;

-- Text values, not PostgreSQL BOOLEAN: Asterisk consumes/writes textual options.
CREATE DOMAIN ast_bool AS VARCHAR(5)
    CHECK (VALUE IN ('0', '1', 'off', 'on', 'false', 'true', 'no', 'yes'));
CREATE DOMAIN ast_yesno AS VARCHAR(3)
    CHECK (VALUE IN ('yes', 'no'));

-- App-only authentication and audit data; never exposed as PJSIP options.
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(80) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'operator'
        CHECK (role IN ('admin', 'operator')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    table_name VARCHAR(80),
    record_id INTEGER,
    details TEXT,
    ip VARCHAR(64),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE ps_auths (
    id VARCHAR(255) PRIMARY KEY,
    auth_type VARCHAR(20) CHECK (auth_type IN ('userpass', 'md5', 'google_oauth')),
    nonce_lifetime INTEGER,
    md5_cred VARCHAR(40),
    password VARCHAR(80),
    realm VARCHAR(255),
    username VARCHAR(40),
    refresh_token VARCHAR(255),
    oauth_clientid VARCHAR(255),
    oauth_secret VARCHAR(255),
    password_digest VARCHAR(1024),
    supported_algorithms_uas VARCHAR(1024),
    supported_algorithms_uac VARCHAR(1024)
);

CREATE TABLE ps_aors (
    id VARCHAR(255) PRIMARY KEY,
    contact VARCHAR(255),
    default_expiration INTEGER,
    minimum_expiration INTEGER,
    maximum_expiration INTEGER,
    mailboxes VARCHAR(80),
    max_contacts INTEGER CHECK (max_contacts >= 0),
    remove_existing ast_bool,
    remove_unavailable ast_bool,
    qualify_frequency INTEGER CHECK (qualify_frequency >= 0),
    qualify_timeout DOUBLE PRECISION CHECK (qualify_timeout > 0),
    qualify_2xx_only ast_bool,
    authenticate_qualify ast_bool,
    outbound_proxy VARCHAR(255),
    support_path ast_bool,
    voicemail_extension VARCHAR(40)
);
CREATE INDEX ps_aors_qualifyfreq_contact ON ps_aors (qualify_frequency, contact);

-- Deliberate simple-PBX subset, not every PJSIP option in the upstream schema.
-- Unset options inherit Asterisk defaults. Transports/global objects stay static.
CREATE TABLE ps_endpoints (
    id VARCHAR(255) PRIMARY KEY,
    transport VARCHAR(40),
    aors VARCHAR(2048),
    auth VARCHAR(255),
    context VARCHAR(40),
    disallow VARCHAR(200),
    allow VARCHAR(200),
    direct_media ast_bool,
    force_rport ast_bool,
    rewrite_contact ast_bool,
    rtp_symmetric ast_bool,
    ice_support ast_bool,
    dtmf_mode VARCHAR(20)
        CHECK (dtmf_mode IN ('rfc4733', 'inband', 'info', 'auto', 'auto_info')),
    callerid VARCHAR(40),
    mailboxes VARCHAR(40),
    voicemail_extension VARCHAR(40),
    language VARCHAR(40),
    from_domain VARCHAR(40),
    from_user VARCHAR(40),
    outbound_auth VARCHAR(255),
    outbound_proxy VARCHAR(255),
    identify_by VARCHAR(80),
    allow_transfer ast_bool,
    allow_subscribe ast_bool,
    direct_media_method VARCHAR(10)
        CHECK (direct_media_method IN ('invite', 'reinvite', 'update')),
    trust_id_inbound ast_bool,
    trust_id_outbound ast_bool,
    send_pai ast_bool,
    send_rpid ast_bool,
    media_address VARCHAR(40),
    media_encryption VARCHAR(10) CHECK (media_encryption IN ('no', 'sdes', 'dtls')),
    use_avpf ast_bool,
    rtcp_mux ast_bool,
    webrtc ast_bool,
    dtls_auto_generate_cert ast_bool,
    dtls_verify VARCHAR(40),
    dtls_setup VARCHAR(10) CHECK (dtls_setup IN ('active', 'passive', 'actpass')),
    dtls_cert_file VARCHAR(200),
    dtls_private_key VARCHAR(200),
    dtls_ca_file VARCHAR(200),
    set_var TEXT
);

-- Application metadata belongs outside ps_endpoints: Sorcery interprets fields
-- returned from that table as PJSIP configuration, not arbitrary app metadata.
CREATE TABLE user_endpoints (
    endpoint_id VARCHAR(255) PRIMARY KEY REFERENCES ps_endpoints(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX user_endpoints_user_id ON user_endpoints (user_id);

-- Runtime registration state: Asterisk creates/updates/deletes these rows.
-- No FK to endpoints: registration cleanup and provisioning have separate lives.
CREATE TABLE ps_contacts (
    id VARCHAR(255) PRIMARY KEY,
    uri VARCHAR(511),
    expiration_time BIGINT,
    qualify_frequency INTEGER,
    outbound_proxy VARCHAR(255),
    path TEXT,
    user_agent VARCHAR(255),
    qualify_timeout DOUBLE PRECISION,
    qualify_2xx_only ast_bool,
    reg_server VARCHAR(255),
    authenticate_qualify ast_bool,
    via_addr VARCHAR(40),
    via_port INTEGER,
    call_id VARCHAR(255),
    endpoint VARCHAR(255),
    prune_on_boot ast_bool
);
CREATE INDEX ps_contacts_qualifyfreq_exp ON ps_contacts (qualify_frequency, expiration_time);
CREATE INDEX ps_contacts_endpoint ON ps_contacts (endpoint);
CREATE INDEX ps_contacts_expiration ON ps_contacts (expiration_time);

CREATE TABLE ps_domain_aliases (
    id VARCHAR(255) PRIMARY KEY,
    domain VARCHAR(255)
);

CREATE TABLE ps_endpoint_id_ips (
    id VARCHAR(255) PRIMARY KEY,
    endpoint VARCHAR(255),
    "match" VARCHAR(80),
    srv_lookups ast_bool,
    match_header VARCHAR(255),
    match_request_uri VARCHAR(255)
);
CREATE INDEX ps_endpoint_id_ips_endpoint ON ps_endpoint_id_ips (endpoint);

-- Native pbx_realtime steps. Priorities/branch destinations are numeric;
-- realtime switches do not resolve static dialplan labels or provide hints.
CREATE TABLE extensions (
    id BIGSERIAL PRIMARY KEY,
    context VARCHAR(40) NOT NULL,
    exten VARCHAR(40) NOT NULL,
    priority INTEGER NOT NULL CHECK (priority > 0),
    app VARCHAR(40) NOT NULL,
    appdata VARCHAR(256) NOT NULL DEFAULT '',
    UNIQUE (context, exten, priority)
);

-- Mailbox configuration only. Messages/greetings remain in the spool volume.
CREATE TABLE voicemail (
    uniqueid SERIAL PRIMARY KEY,
    context VARCHAR(80) NOT NULL,
    mailbox VARCHAR(80) NOT NULL,
    password VARCHAR(80) NOT NULL,
    fullname VARCHAR(80),
    alias VARCHAR(80),
    email VARCHAR(80),
    pager VARCHAR(80),
    attach ast_yesno,
    attachfmt VARCHAR(10),
    serveremail VARCHAR(80),
    language VARCHAR(20),
    tz VARCHAR(30),
    deletevoicemail ast_yesno,
    saycid ast_yesno,
    sendvoicemail ast_yesno,
    review ast_yesno,
    tempgreetwarn ast_yesno,
    operator ast_yesno,
    envelope ast_yesno,
    sayduration INTEGER,
    forcename ast_yesno,
    forcegreetings ast_yesno,
    callback VARCHAR(80),
    dialout VARCHAR(80),
    exitcontext VARCHAR(80),
    maxmsg INTEGER CHECK (maxmsg >= 0),
    volgain NUMERIC(5,2),
    imapuser VARCHAR(80),
    imappassword VARCHAR(80),
    imapserver VARCHAR(80),
    imapport VARCHAR(8),
    imapflags VARCHAR(80),
    stamp TIMESTAMP,
    UNIQUE (context, mailbox)
);
CREATE INDEX voicemail_mailbox ON voicemail (mailbox);

-- Supported simple call-center options; queue numbers are dialplan entries.
CREATE TABLE queues (
    name VARCHAR(128) PRIMARY KEY,
    musiconhold VARCHAR(128),
    announce VARCHAR(128),
    context VARCHAR(128),
    timeout INTEGER CHECK (timeout >= 0),
    ringinuse ast_yesno,
    setinterfacevar ast_yesno,
    setqueuevar ast_yesno,
    setqueueentryvar ast_yesno,
    membergosub VARCHAR(512),
    announce_frequency INTEGER,
    announce_holdtime VARCHAR(128),
    announce_position VARCHAR(128),
    periodic_announce VARCHAR(50),
    periodic_announce_frequency INTEGER,
    retry INTEGER CHECK (retry >= 0),
    wrapuptime INTEGER CHECK (wrapuptime >= 0),
    autofill ast_yesno,
    autopause VARCHAR(3) CHECK (autopause IN ('yes', 'no', 'all')),
    autopausedelay INTEGER,
    autopausebusy ast_yesno,
    autopauseunavail ast_yesno,
    maxlen INTEGER CHECK (maxlen >= 0),
    servicelevel INTEGER CHECK (servicelevel >= 0),
    strategy VARCHAR(20) CHECK (strategy IN (
        'ringall', 'leastrecent', 'fewestcalls', 'random',
        'rrmemory', 'linear', 'wrandom', 'rrordered'
    )),
    joinempty VARCHAR(128),
    leavewhenempty VARCHAR(128),
    reportholdtime ast_yesno,
    memberdelay INTEGER,
    weight INTEGER,
    timeoutrestart ast_yesno,
    defaultrule VARCHAR(128),
    timeoutpriority VARCHAR(128)
);

CREATE TABLE queue_members (
    queue_name VARCHAR(80) NOT NULL REFERENCES queues(name) ON DELETE CASCADE,
    interface VARCHAR(80) NOT NULL,
    uniqueid SERIAL UNIQUE NOT NULL,
    membername VARCHAR(80),
    state_interface VARCHAR(80),
    penalty INTEGER NOT NULL DEFAULT 0 CHECK (penalty >= 0),
    paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
    wrapuptime INTEGER CHECK (wrapuptime >= 0),
    ringinuse ast_yesno,
    reason_paused VARCHAR(80),
    PRIMARY KEY (queue_name, interface)
);

-- CDR is append-only runtime output, not an extconfig realtime family.
-- calldate aliases the CDR "start" value in cdr_adaptive_odbc.conf.
CREATE TABLE cdr (
    id BIGSERIAL PRIMARY KEY,
    calldate TIMESTAMP NOT NULL,
    answer TIMESTAMP,
    "end" TIMESTAMP,
    clid VARCHAR(80),
    src VARCHAR(80),
    dst VARCHAR(80),
    dcontext VARCHAR(80),
    channel VARCHAR(80),
    dstchannel VARCHAR(80),
    lastapp VARCHAR(80),
    lastdata VARCHAR(256),
    duration INTEGER,
    billsec INTEGER,
    disposition VARCHAR(45),
    amaflags VARCHAR(45),
    accountcode VARCHAR(80),
    uniqueid VARCHAR(150),
    userfield VARCHAR(256),
    peeraccount VARCHAR(80),
    linkedid VARCHAR(150),
    sequence INTEGER
);
CREATE INDEX cdr_calldate ON cdr (calldate);
CREATE INDEX cdr_uniqueid ON cdr (uniqueid);
CREATE INDEX cdr_linkedid ON cdr (linkedid);
CREATE INDEX cdr_disposition ON cdr (disposition);

COMMIT;
