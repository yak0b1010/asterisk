-- ============================================================================
-- Asterisk call detail records (CDR).
--
-- This schema matches what the `cdr_odbc` module inserts: the start time is
-- stored in `calldate`.  `docker-entrypoint-initdb.d` runs this file once,
-- when the PostgreSQL volume is first created.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cdr (
    calldate    TIMESTAMP    NOT NULL,
    clid        VARCHAR(80)  NOT NULL DEFAULT '',
    src         VARCHAR(80)  NOT NULL DEFAULT '',
    dst         VARCHAR(80)  NOT NULL DEFAULT '',
    dcontext    VARCHAR(80)  NOT NULL DEFAULT '',
    channel     VARCHAR(80)  NOT NULL DEFAULT '',
    dstchannel  VARCHAR(80)  NOT NULL DEFAULT '',
    lastapp     VARCHAR(80)  NOT NULL DEFAULT '',
    lastdata    VARCHAR(80)  NOT NULL DEFAULT '',
    duration    INTEGER      NOT NULL DEFAULT 0,
    billsec     INTEGER      NOT NULL DEFAULT 0,
    disposition VARCHAR(45)  NOT NULL DEFAULT '',
    amaflags    INTEGER      NOT NULL DEFAULT 0,
    accountcode VARCHAR(20)  NOT NULL DEFAULT '',
    uniqueid    VARCHAR(150) NOT NULL DEFAULT '',
    userfield   VARCHAR(255) NOT NULL DEFAULT '',
    peeraccount VARCHAR(20),
    linkedid    VARCHAR(150),
    sequence    INTEGER
);

CREATE INDEX IF NOT EXISTS cdr_calldate_idx ON cdr (calldate);
CREATE INDEX IF NOT EXISTS cdr_uniqueid_idx ON cdr (uniqueid);
CREATE INDEX IF NOT EXISTS cdr_disposition_idx ON cdr (disposition);
