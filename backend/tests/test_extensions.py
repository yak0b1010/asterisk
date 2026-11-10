"""API/database integration checks; run only through validate_extensions.py."""
import os
import unittest
import uuid

import app as backend


@unittest.skipUnless(os.environ.get("PROVISIONING_TEST_DB") == "yes", "disposable DB required")
class ExtensionProvisioningTests(unittest.TestCase):
    def setUp(self):
        self.client = backend.app.test_client()
        self.number = "9" + str(uuid.uuid4().int)[:12]
        self.headers = {
            "Authorization": "Bearer " + backend.make_token(
                {"id": 1, "username": "admin", "role": "admin"}
            )
        }

    def create(self, **overrides):
        payload = {"extension": self.number, "secret": "test-password"}
        payload.update(overrides)
        return self.client.post("/api/extensions", json=payload, headers=self.headers)

    def rows(self, table, number=None):
        # Table names are test constants, not external inputs.
        return backend.query(f"SELECT * FROM {table} WHERE id=%s", (number or self.number,))

    def test_create_update_list_delete_native_objects(self):
        self.assertEqual(self.create().status_code, 201)
        endpoint = self.rows("ps_endpoints")[0]
        self.assertEqual(endpoint["context"], "internal")
        self.assertEqual((endpoint["auth"], endpoint["aors"]), (self.number,) * 2)
        self.assertEqual(self.rows("ps_aors")[0]["max_contacts"], 2)
        self.assertEqual(self.rows("ps_auths")[0]["username"], self.number)
        routes = backend.query(
            "SELECT app, appdata FROM extensions WHERE context='internal' AND exten=%s ORDER BY priority",
            (self.number,),
        )
        self.assertEqual([row["app"] for row in routes], ["Dial", "Hangup"])
        self.assertEqual(routes[0]["appdata"], "${PJSIP_DIAL_CONTACTS(" + self.number + ")},20")
        response = self.client.get("/api/extensions?per_page=500", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("test-password", response.get_data(as_text=True))
        self.assertNotIn("secret", response.get_data(as_text=True))
        if not any(row["id"] == self.number for row in response.json["items"]):
            response = self.client.get("/api/extensions?per_page=500&page=2", headers=self.headers)
        item = next(row for row in response.json["items"] if row["id"] == self.number)
        self.assertEqual(item["extension"], self.number)
        self.assertNotIn("is_active", item)
        path = "/api/extensions/" + self.number
        response = self.client.put(path, json={"callerid": "Office", "secret": ""}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.rows("ps_auths")[0]["password"], "test-password")
        self.assertEqual(self.rows("ps_endpoints")[0]["callerid"], "Office")
        response = self.client.put(path, json={"secret": "replacement"}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.rows("ps_auths")[0]["password"], "replacement")
        self.assertEqual(self.client.delete(path, headers=self.headers).status_code, 200)
        for table in ("ps_auths", "ps_aors", "ps_endpoints"):
            self.assertEqual(self.rows(table), [])
        self.assertEqual(self.client.delete(path, headers=self.headers).status_code, 404)
        self.assertEqual(self.client.put(path, json={"callerid": "Missing"}, headers=self.headers).status_code, 404)

    def test_duplicate_and_mid_transaction_conflict_roll_back(self):
        backend.query("INSERT INTO ps_aors (id) VALUES (%s)", (self.number,), fetch=False, commit=True)
        self.assertEqual(self.create().status_code, 409)
        self.assertEqual(self.rows("ps_auths"), [])
        self.assertEqual(self.rows("ps_endpoints"), [])
        other = self.number + "1"
        self.assertEqual(self.create(extension=other).status_code, 201)
        self.assertEqual(self.create(extension=other).status_code, 409)
        self.assertEqual(self.rows("ps_auths", other)[0]["password"], "test-password")

    def test_leading_zero_identifier_is_not_coerced_to_integer(self):
        number = "00" + str(uuid.uuid4().int)[:8]
        self.assertEqual(self.create(extension=number).json["id"], number)
        response = self.client.put(
            "/api/extensions/" + number, json={"callerid": "Office"}, headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.rows("ps_endpoints", number)[0]["id"], number)
        self.assertEqual(self.client.delete(
            "/api/extensions/" + number, headers=self.headers,
        ).status_code, 200)

    def test_external_auth_and_aor_objects_are_preserved(self):
        self.assertEqual(self.create().status_code, 201)
        other = self.number + "2"
        self.assertEqual(self.create(extension=other).status_code, 201)
        backend.query(
            "UPDATE ps_endpoints SET auth=%s,aors=%s WHERE id=%s",
            (self.number, self.number, other), fetch=False, commit=True,
        )
        self.assertEqual(self.client.delete(
            "/api/extensions/" + other, headers=self.headers,
        ).status_code, 200)
        self.assertTrue(self.rows("ps_auths"))
        self.assertTrue(self.rows("ps_aors"))

    def test_mailbox_link_and_delete_preserve_independent_data(self):
        reference = self.number + "@default"
        self.assertEqual(self.create(mailboxes=reference).status_code, 400)
        self.assertEqual(self.rows("ps_auths"), [])
        backend.query(
            "INSERT INTO voicemail(context,mailbox,password,email) VALUES ('default',%s,'1234','office@example.test')",
            (self.number,), fetch=False, commit=True,
        )
        self.assertEqual(self.create(mailboxes=reference).status_code, 201)
        backend.query("INSERT INTO queues(name) VALUES (%s)", (self.number,), fetch=False, commit=True)
        backend.query(
            "INSERT INTO queue_members(queue_name,interface) VALUES (%s,%s)",
            (self.number, f"PJSIP/{self.number}"), fetch=False, commit=True,
        )
        response = self.client.delete("/api/extensions/" + self.number, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["remaining_references"]["queue_members"], 1)
        self.assertGreaterEqual(response.json["remaining_references"]["dialplan_text_matches"], 1)
        mailbox = backend.query("SELECT * FROM voicemail WHERE mailbox=%s", (self.number,))[0]
        self.assertEqual(mailbox["password"], "1234")
        self.assertEqual(mailbox["email"], "office@example.test")
        self.assertEqual(len(backend.query("SELECT * FROM extensions WHERE exten=%s", (self.number,))), 9)
        self.assertEqual(len(backend.query("SELECT * FROM queue_members WHERE queue_name=%s", (self.number,))), 1)

    def test_shared_credentials_are_not_changed_or_deleted(self):
        self.assertEqual(self.create().status_code, 201)
        backend.query(
            "INSERT INTO ps_endpoints(id,auth,aors,outbound_auth) VALUES (%s,%s,%s,%s)",
            (self.number + "-shared", "another," + self.number, self.number, self.number),
            fetch=False, commit=True,
        )
        path = "/api/extensions/" + self.number
        response = self.client.put(
            path, json={"secret": "do-not-write", "callerid": "do-not-write"}, headers=self.headers
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.rows("ps_auths")[0]["password"], "test-password")
        self.assertNotEqual(self.rows("ps_endpoints")[0]["callerid"], "do-not-write")
        response = self.client.delete(path, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json["retained_shared_objects"]), {"ps_auths", "ps_aors"})
        self.assertTrue(self.rows("ps_auths"))
        self.assertTrue(self.rows("ps_aors"))
        self.assertTrue(self.rows("ps_endpoints", self.number + "-shared"))

    def test_validation_and_admin_access(self):
        for fields in (
            {"is_active": False}, {"extension": "../bad"}, {"secret": ""},
            {"secret": "x" * 81}, {"mailboxes": "bad-reference"}, {"context": ""},
            {"technology": "SIP"}, {"email": "unsupported@example.test"},
            {"extension": "alice"}, {"extension": "1" * 33},
            {"display_name": ""}, {"display_name": 'Alice "Bad"'},
            {"display_name": "x" * 40}, {"voicemail": True},
            {"voicemail": {"pin": "abc"}}, {"voicemail": {"pin": 123}},
            {"voicemail": {"pin": ""}}, {"voicemail": {"pin": "1" * 81}},
            {"voicemail": {"email": "bad-address"}}, {"voicemail": {"unknown": "value"}},
            {"voicemail": {}, "mailboxes": "101@default"},
        ):
            with self.subTest(fields=list(fields)):
                self.assertEqual(self.create(**fields).status_code, 400)
        self.assertEqual(self.client.get("/api/extensions").status_code, 401)
        token = backend.make_token({"id": 1, "username": "operator", "role": "operator"})
        self.assertEqual(self.client.get(
            "/api/extensions", headers={"Authorization": "Bearer " + token}
        ).status_code, 403)
        for query in ("page=0", "page=bad", "per_page=0", "per_page=501"):
            self.assertEqual(self.client.get("/api/extensions?" + query, headers=self.headers).status_code, 400)
        self.assertEqual(self.create().status_code, 201)
        self.assertEqual(self.client.put(
            "/api/extensions/" + self.number, json={"extension": "different"},
            headers=self.headers,
        ).status_code, 400)
        audit = backend.query(
            "SELECT details FROM audit_log WHERE table_name='ps_endpoints' AND details=%s",
            (f"endpoint {self.number}",),
        )
        self.assertTrue(audit)
        self.assertNotIn("test-password", str(audit))

    def test_create_voicemail_default_pin_and_busy_unanswered_routes(self):
        response = self.create(display_name="Alice", voicemail={"email": "alice@example.test"})
        self.assertEqual(response.status_code, 201, response.json)
        mailbox = backend.query(
            "SELECT * FROM voicemail WHERE context='default' AND mailbox=%s", (self.number,)
        )[0]
        self.assertEqual(mailbox["password"], "0" + self.number)
        self.assertEqual(mailbox["email"], "alice@example.test")
        self.assertEqual(mailbox["fullname"], "Alice")
        endpoint = self.rows("ps_endpoints")[0]
        self.assertEqual(endpoint["callerid"], f'"Alice" <{self.number}>')
        self.assertEqual(endpoint["mailboxes"], self.number + "@default")
        routes = backend.query(
            "SELECT priority, app, appdata FROM extensions WHERE context='internal' AND exten=%s ORDER BY priority",
            (self.number,),
        )
        self.assertEqual(len(routes), 9)
        self.assertEqual(routes[0]["appdata"],
                         '$["${PJSIP_DIAL_CONTACTS(' + self.number + ')}" = ""]?8')
        self.assertEqual(routes[2]["appdata"], '$["${DIALSTATUS}" = "BUSY"]?6')
        self.assertIn('"NOANSWER"', routes[3]["appdata"])
        self.assertIn('"CHANUNAVAIL"', routes[3]["appdata"])
        self.assertEqual((routes[5]["app"], routes[5]["appdata"]),
                         ("VoiceMail", self.number + "@default,b"))
        self.assertEqual((routes[7]["app"], routes[7]["appdata"]),
                         ("VoiceMail", self.number + "@default,u"))
        listing = self.client.get("/api/voicemail", headers=self.headers)
        self.assertNotIn(mailbox["password"], listing.get_data(as_text=True))
        self.assertNotIn(mailbox["password"], response.get_data(as_text=True))

    def test_custom_voicemail_pin_preserves_leading_zeros(self):
        response = self.create(voicemail={"pin": "001234"})
        self.assertEqual(response.status_code, 201, response.json)
        mailbox = backend.query("SELECT password FROM voicemail WHERE mailbox=%s", (self.number,))[0]
        self.assertEqual(mailbox["password"], "001234")

    def test_voicemail_and_routes_rollback_on_endpoint_conflict(self):
        backend.query("INSERT INTO ps_aors (id) VALUES (%s)", (self.number,), fetch=False, commit=True)
        self.assertEqual(self.create(voicemail={}).status_code, 409)
        self.assertEqual(self.rows("ps_auths"), [])
        self.assertEqual(self.rows("ps_endpoints"), [])
        self.assertEqual(backend.query("SELECT * FROM voicemail WHERE mailbox=%s", (self.number,)), [])
        self.assertEqual(backend.query("SELECT * FROM extensions WHERE exten=%s", (self.number,)), [])

    def test_existing_routes_and_mailboxes_are_never_overwritten(self):
        backend.query(
            "INSERT INTO extensions(context,exten,priority,app) VALUES ('internal',%s,9,'Hangup')",
            (self.number,), fetch=False, commit=True,
        )
        self.assertEqual(self.create(voicemail={}).status_code, 409)
        self.assertEqual(self.rows("ps_endpoints"), [])
        self.assertEqual(backend.query("SELECT * FROM voicemail WHERE mailbox=%s", (self.number,)), [])
        other = self.number + "3"
        backend.query(
            "INSERT INTO voicemail(context,mailbox,password) VALUES ('default',%s,'0007')",
            (other,), fetch=False, commit=True,
        )
        self.assertEqual(self.create(extension=other, voicemail={}).status_code, 409)
        self.assertEqual(self.rows("ps_endpoints", other), [])
        self.assertEqual(backend.query("SELECT password FROM voicemail WHERE mailbox=%s", (other,))[0]["password"], "0007")

    def test_reserved_static_service_numbers_are_rejected(self):
        self.assertEqual(self.create(extension="000").status_code, 409)
        self.assertEqual(self.rows("ps_endpoints", "000"), [])


if __name__ == "__main__":
    unittest.main()
