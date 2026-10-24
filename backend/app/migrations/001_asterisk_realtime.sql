-- Asterisk Realtime schema (PostgreSQL).
--
-- These are the tables Asterisk 22 reads through res_odbc / sorcery. The
-- backend owns them because the repository does not ship a db/init directory.
-- Column types are deliberately plain VARCHAR/INTEGER: Asterisk's ODBC driver
-- only needs the names, and avoiding custom enum types keeps migrations
-- idempotent across PostgreSQL versions.

CREATE TABLE IF NOT EXISTS ps_endpoints (
    id                  VARCHAR(40) PRIMARY KEY,
    transport           VARCHAR(40) DEFAULT 'transport-udp',
    aors                VARCHAR(200),
    auth                VARCHAR(40),
    context             VARCHAR(40) DEFAULT 'internal',
    disallow            VARCHAR(200) DEFAULT 'all',
    allow               VARCHAR(200) DEFAULT 'ulaw,alaw,opus,g722',
    direct_media        VARCHAR(3)  DEFAULT 'no',
    mailboxes           VARCHAR(200),
    callerid            VARCHAR(120),
    from_domain         VARCHAR(80),
    from_user           VARCHAR(80),
    language            VARCHAR(40),
    moh_suggest         VARCHAR(40),
    ice_support         VARCHAR(3)  DEFAULT 'no',
    media_encryption    VARCHAR(40) DEFAULT 'no',
    rewrite_contact     VARCHAR(3)  DEFAULT 'yes',
    rtp_symmetric       VARCHAR(3)  DEFAULT 'yes',
    force_rport         VARCHAR(3)  DEFAULT 'yes',
    timers              VARCHAR(40),
    dtmf_mode           VARCHAR(40),
    aggregate_mwi       VARCHAR(3)  DEFAULT 'yes',
    trust_id_inbound    VARCHAR(3)  DEFAULT 'no',
    trust_id_outbound   VARCHAR(3)  DEFAULT 'no',
    send_pai            VARCHAR(3)  DEFAULT 'no',
    send_rpid           VARCHAR(3)  DEFAULT 'no',
    allow_transfer      VARCHAR(3)  DEFAULT 'yes',
    allow_subscribe     VARCHAR(3)  DEFAULT 'yes',
    one_touch_recording VARCHAR(3)  DEFAULT 'no',
    message_context     VARCHAR(40),
    named_call_group    VARCHAR(40),
    named_pickup_group  VARCHAR(40),
    call_group          VARCHAR(40),
    pickup_group        VARCHAR(40),
    device_state_busy_at INTEGER,
    outbound_auth       VARCHAR(40),
    outbound_proxy      VARCHAR(40),
    tone_zone           VARCHAR(40),
    endpoint_id         VARCHAR(40)
);
CREATE INDEX IF NOT EXISTS ps_endpoints_id ON ps_endpoints (id);

CREATE TABLE IF NOT EXISTS ps_auths (
    id             VARCHAR(40) PRIMARY KEY,
    auth_type      VARCHAR(40) DEFAULT 'userpass',
    nonce_lifetime INTEGER,
    md5_cred       VARCHAR(40),
    password       VARCHAR(200),
    realm          VARCHAR(40),
    username       VARCHAR(40)
);
CREATE INDEX IF NOT EXISTS ps_auths_id ON ps_auths (id);

CREATE TABLE IF NOT EXISTS ps_aors (
    id                  VARCHAR(40) PRIMARY KEY,
    contact             VARCHAR(255),
    default_expiration  INTEGER,
    mailboxes           VARCHAR(200),
    max_contacts        INTEGER DEFAULT 2,
    minimum_expiration  INTEGER,
    maximum_expiration  INTEGER,
    remove_existing     VARCHAR(3) DEFAULT 'yes',
    qualify_frequency   INTEGER DEFAULT 60,
    qualify_timeout     DOUBLE PRECISION,
    authenticate_qualify VARCHAR(3) DEFAULT 'no',
    support_path        VARCHAR(3) DEFAULT 'no',
    voicemail_extension VARCHAR(40)
);
CREATE INDEX IF NOT EXISTS ps_aors_id ON ps_aors (id);

CREATE TABLE IF NOT EXISTS ps_contacts (
    id                  VARCHAR(255) PRIMARY KEY,
    uri                 VARCHAR(511),
    expiration_time     BIGINT,
    qualify_frequency   INTEGER,
    qualify_timeout     DOUBLE PRECISION,
    outbound_proxy      VARCHAR(255),
    path                TEXT,
    user_agent          VARCHAR(255),
    reg_server          VARCHAR(255),
    authenticate_qualify VARCHAR(3) DEFAULT 'no',
    via_addr            VARCHAR(40),
    via_port            INTEGER,
    call_id             VARCHAR(255),
    endpoint            VARCHAR(40),
    prune_on_boot       VARCHAR(3) DEFAULT 'no',
    mobility            VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS ps_contacts_id ON ps_contacts (id);
CREATE INDEX IF NOT EXISTS ps_contacts_qualifyfreq_exp ON ps_contacts (qualify_frequency, expiration_time);

CREATE TABLE IF NOT EXISTS ps_domain_aliases (
    id     VARCHAR(40) PRIMARY KEY,
    domain VARCHAR(80)
);
CREATE INDEX IF NOT EXISTS ps_domain_aliases_id ON ps_domain_aliases (id);

CREATE TABLE IF NOT EXISTS ps_endpoint_id_ips (
    id       VARCHAR(40) PRIMARY KEY,
    endpoint VARCHAR(40),
    match    VARCHAR(80)
);
CREATE INDEX IF NOT EXISTS ps_endpoint_id_ips_id ON ps_endpoint_id_ips (id);

CREATE TABLE IF NOT EXISTS voicemail (
    uniqueid       SERIAL PRIMARY KEY,
    context        VARCHAR(80) NOT NULL,
    mailbox        VARCHAR(80) NOT NULL,
    password       VARCHAR(80) NOT NULL,
    fullname       VARCHAR(80),
    alias          VARCHAR(80),
    email          VARCHAR(80),
    pager          VARCHAR(80),
    attach         VARCHAR(3) DEFAULT 'yes',
    attachfmt      VARCHAR(10) DEFAULT 'wav',
    serveremail    VARCHAR(80),
    language       VARCHAR(20),
    tz             VARCHAR(30),
    deletevoicemail VARCHAR(3) DEFAULT 'no',
    saycid         VARCHAR(3) DEFAULT 'no',
    sendvoicemail  VARCHAR(3) DEFAULT 'no',
    review         VARCHAR(3) DEFAULT 'yes',
    tempgreetwarn  VARCHAR(3) DEFAULT 'no',
    operator       VARCHAR(3) DEFAULT 'no',
    envelope       VARCHAR(3) DEFAULT 'yes',
    sayduration    INTEGER DEFAULT 2,
    forcename      VARCHAR(3) DEFAULT 'no',
    forcegreetings VARCHAR(3) DEFAULT 'no',
    callback       VARCHAR(80),
    dialout        VARCHAR(80),
    exitcontext    VARCHAR(80),
    maxmsg         INTEGER DEFAULT 50,
    volgain        NUMERIC(5,2),
    imapuser       VARCHAR(80),
    imappassword   VARCHAR(80),
    imapserver     VARCHAR(80),
    imapport       VARCHAR(8),
    imapflags      VARCHAR(80),
    stamp          TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS voicemail_mailbox ON voicemail (mailbox);
CREATE INDEX IF NOT EXISTS voicemail_context ON voicemail (context);
CREATE INDEX IF NOT EXISTS voicemail_mailbox_context ON voicemail (mailbox, context);

CREATE TABLE IF NOT EXISTS queues (
    name                 VARCHAR(128) PRIMARY KEY,
    musiconhold          VARCHAR(128),
    announce             VARCHAR(128),
    context              VARCHAR(128) DEFAULT 'internal',
    timeout              INTEGER DEFAULT 30,
    ringinuse            VARCHAR(3) DEFAULT 'no',
    announce_frequency   INTEGER DEFAULT 0,
    retry                INTEGER DEFAULT 5,
    wrapuptime           INTEGER DEFAULT 0,
    maxlen               INTEGER DEFAULT 0,
    servicelevel         INTEGER DEFAULT 0,
    strategy             VARCHAR(40) DEFAULT 'ringall',
    joinempty           VARCHAR(128),
    leavewhenempty       VARCHAR(128),
    weight               INTEGER DEFAULT 0,
    timeoutpriority      VARCHAR(40)
);

CREATE TABLE IF NOT EXISTS queue_members (
    queue_name     VARCHAR(80) NOT NULL,
    interface      VARCHAR(80) NOT NULL,
    uniqueid       VARCHAR(80) NOT NULL DEFAULT '',
    membername     VARCHAR(80),
    state_interface VARCHAR(80),
    penalty        INTEGER DEFAULT 0,
    paused         INTEGER DEFAULT 0,
    PRIMARY KEY (queue_name, interface)
);

CREATE TABLE IF NOT EXISTS extensions (
    id       BIGSERIAL PRIMARY KEY,
    context  VARCHAR(40) NOT NULL,
    exten    VARCHAR(40) NOT NULL,
    priority INTEGER NOT NULL,
    app      VARCHAR(40) NOT NULL,
    appdata  VARCHAR(256) NOT NULL DEFAULT '',
    UNIQUE (context, exten, priority)
);

CREATE TABLE IF NOT EXISTS meetme (
    confno    VARCHAR(80) PRIMARY KEY,
    pin       VARCHAR(20),
    pinadmin  VARCHAR(20)
);
