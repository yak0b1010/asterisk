-- Called only by ../999_demo.sh when DEMO_DATA=yes on first initialization.
-- PostgreSQL's entrypoint does not recurse into this subdirectory.
-- Intentionally not an upsert: an accidental rerun must fail, not overwrite
-- provisioned objects. Every demo object is inserted in one transaction.
\set ON_ERROR_STOP on
BEGIN;

-- Seeder constants only: no department entity or helper tables are created.
-- Each range writes directly to the same native tables used by provisioning.
DO $seed$
DECLARE
    department RECORD;
BEGIN
    FOR department IN
        SELECT * FROM (VALUES
            (1, 'Administration', 'q-admin', '010', 'handle-admin'),
            (2, 'Finance', 'q-finance', '011', 'handle-finance'),
            (3, 'IT', 'q-it', '012', 'handle-it'),
            (4, 'Customer Service', 'q-support', '013', 'handle-support'),
            (5, 'Management', 'q-management', '014', 'handle-management')
        ) AS d(prefix, name, queue_name, mailbox, handler)
    LOOP
        INSERT INTO ps_auths (id, auth_type, username, password)
        SELECT n::TEXT, 'userpass', n::TEXT, n::TEXT || 'pass'
        FROM generate_series(department.prefix * 100, department.prefix * 100 + 99) AS n;

        INSERT INTO ps_aors (id, max_contacts, remove_existing)
        SELECT n::TEXT, 2, 'yes'
        FROM generate_series(department.prefix * 100, department.prefix * 100 + 99) AS n;

        INSERT INTO ps_endpoints (
            id, transport, aors, auth, context, disallow, allow,
            direct_media, force_rport, rewrite_contact, rtp_symmetric,
            dtmf_mode, callerid, mailboxes, allow_transfer
        )
        SELECT n::TEXT, 'transport-udp', n::TEXT, n::TEXT, 'internal',
               'all', 'ulaw,alaw,opus,g722', 'no', 'yes', 'yes', 'yes',
               'rfc4733', '"' || department.name || ' ' || n::TEXT || '" <' || n::TEXT || '>',
               n::TEXT || '@default', 'yes'
        FROM generate_series(department.prefix * 100, department.prefix * 100 + 99) AS n;

        INSERT INTO voicemail (context, mailbox, password, fullname)
        SELECT 'default', n::TEXT, '0' || n::TEXT, department.name || ' ' || n::TEXT
        FROM generate_series(department.prefix * 100, department.prefix * 100 + 99) AS n;

        INSERT INTO voicemail (context, mailbox, password, fullname)
        VALUES ('departments', department.mailbox, '0' || department.mailbox, department.name);

        INSERT INTO queues (
            name, strategy, timeout, retry, maxlen, musiconhold,
            ringinuse, servicelevel, autofill
        )
        VALUES (department.queue_name, 'rrmemory', 20, 1, 20, 'default', 'no', 60, 'yes');

        INSERT INTO queue_members (queue_name, interface, membername, state_interface)
        SELECT department.queue_name, 'PJSIP/' || n::TEXT,
               department.name || ' ' || n::TEXT, 'PJSIP/' || n::TEXT
        FROM generate_series(department.prefix * 100, department.prefix * 100 + 99) AS n;

        -- Numeric branches replace standalone labels. Exact DB extensions
        -- beat DB patterns; static base tests 000–004 are resolved first.
        INSERT INTO extensions (context, exten, priority, app, appdata)
        SELECT 'internal', department.mailbox, s.priority, s.app,
               replace(replace(s.data, '{queue}', department.queue_name),
                       '{mailbox}', department.mailbox)
        FROM (VALUES
            (1, 'NoOp', 'Department queue {queue}'),
            (2, 'Queue', '{queue},,,,300'),
            (3, 'GotoIf', '$["${QUEUESTATUS}" = "TIMEOUT"]?7'),
            (4, 'GotoIf', '$["${QUEUESTATUS}" = "FULL"]?7'),
            (5, 'GotoIf', '$["${QUEUESTATUS}" = "JOINEMPTY"]?7'),
            (6, 'Hangup', ''),
            (7, 'VoiceMail', '{mailbox}@departments,u'),
            (8, 'Hangup', '')
        ) AS s(priority, app, data);

        INSERT INTO extensions (context, exten, priority, app, appdata)
        VALUES ('internal', '_' || department.prefix::TEXT || 'XX', 1, 'Goto',
                department.handler || ',${EXTEN},1');

        -- Customer Service uses the queue-specific handler below instead.
        IF department.prefix <> 4 THEN
            -- Ring all contacts, but never execute Dial() with an empty target.
            INSERT INTO extensions (context, exten, priority, app, appdata)
            SELECT department.handler, '_' || department.prefix::TEXT || 'XX',
                   s.priority, s.app, s.data
            FROM (VALUES
                (1, 'Set', 'CONTACTS=${PJSIP_DIAL_CONTACTS(${EXTEN})}'),
                (2, 'GotoIf', '$["${CONTACTS}" = ""]?9'),
                (3, 'Dial', '${CONTACTS},20'),
                (4, 'GotoIf', '$["${DIALSTATUS}" = "ANSWER"]?11'),
                (5, 'GotoIf', '$["${DIALSTATUS}" = "BUSY"]?7'),
                (6, 'Goto', '9'),
                (7, 'VoiceMail', '${EXTEN}@default,b'),
                (8, 'Hangup', ''),
                (9, 'VoiceMail', '${EXTEN}@default,u'),
                (10, 'Hangup', ''),
                (11, 'Hangup', '')
            ) AS s(priority, app, data);
        END IF;
    END LOOP;
END;
$seed$;

INSERT INTO extensions (context, exten, priority, app, appdata) VALUES
    ('internal', '020', 1, 'Answer', ''),
    ('internal', '020', 2, 'VoiceMailMain', ''),
    ('internal', '020', 3, 'Hangup', ''),
    ('internal', '021', 1, 'Answer', ''),
    ('internal', '021', 2, 'VoiceMail', '${CALLERID(num)}@default,u'),
    ('internal', '021', 3, 'Hangup', '');

-- Customer Service's intentional standalone exception: 400–499 enter the
-- department queue. Queue members are direct PJSIP devices, not Local loops.
INSERT INTO extensions (context, exten, priority, app, appdata) VALUES
    ('handle-support', '_4XX', 1, 'Queue', 'q-support,,,,300'),
    ('handle-support', '_4XX', 2, 'GotoIf', '$["${QUEUESTATUS}" = "TIMEOUT"]?6'),
    ('handle-support', '_4XX', 3, 'GotoIf', '$["${QUEUESTATUS}" = "FULL"]?6'),
    ('handle-support', '_4XX', 4, 'GotoIf', '$["${QUEUESTATUS}" = "JOINEMPTY"]?6'),
    ('handle-support', '_4XX', 5, 'Hangup', ''),
    ('handle-support', '_4XX', 6, 'VoiceMail', '013@departments,u'),
    ('handle-support', '_4XX', 7, 'Hangup', '');

-- TP additions, not present in standalone:
-- 030: IVR, 1 = Administration, 2 = Finance, 3 = Customer Service.
-- Stock digit prompts avoid requiring an unshipped/custom menu recording.
-- All menus use unique extension names in the fixed realtime-ivr context.
-- Collect one digit after playback; this sample does not provide barge-in.
INSERT INTO extensions (context, exten, priority, app, appdata) VALUES
    ('internal', '030', 1, 'Goto', 'realtime-ivr,demo-main,1'),
    ('realtime-ivr', 'demo-main', 1, 'Answer', ''),
    ('realtime-ivr', 'demo-main', 2, 'Playback', 'digits/1&digits/2&digits/3'),
    ('realtime-ivr', 'demo-main', 3, 'Read', 'IVR_DIGIT,beep,1,,1,5'),
    ('realtime-ivr', 'demo-main', 4, 'GotoIf', '$["${READSTATUS}" = "TIMEOUT"]?demo-main-timeout,1'),
    ('realtime-ivr', 'demo-main', 5, 'GotoIf', '${DIALPLAN_EXISTS(realtime-ivr,demo-main-${IVR_DIGIT},1)}?demo-main-${IVR_DIGIT},1:demo-main-invalid,1'),
    ('realtime-ivr', 'demo-main', 6, 'Hangup', ''),
    ('realtime-ivr', 'demo-main-1', 1, 'Goto', 'internal,010,1'),
    ('realtime-ivr', 'demo-main-2', 1, 'Goto', 'internal,011,1'),
    ('realtime-ivr', 'demo-main-3', 1, 'Goto', 'internal,013,1'),
    ('realtime-ivr', 'demo-main-invalid', 1, 'Playback', 'pbx-invalid'),
    ('realtime-ivr', 'demo-main-invalid', 2, 'Hangup', ''),
    ('realtime-ivr', 'demo-main-timeout', 1, 'Hangup', ''),
    ('internal', '040', 1, 'Answer', ''),
    ('internal', '040', 2, 'Set', 'CONFBRIDGE(user,pin)=0040'),
    ('internal', '040', 3, 'Set', 'CONFBRIDGE(bridge,max_members)=20'),
    ('internal', '040', 4, 'ConfBridge', 'demo-room'),
    ('internal', '040', 5, 'Hangup', '');

COMMIT;
