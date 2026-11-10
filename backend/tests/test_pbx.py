"""Native schema compatibility checks, only against disposable test databases."""
import os
import unittest
import uuid

import app as backend


@unittest.skipUnless(os.environ.get("PROVISIONING_TEST_DB") == "yes", "disposable DB required")
class PbxCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.client = backend.app.test_client()
        self.name = "test-" + uuid.uuid4().hex[:10]
        self.headers = {"Authorization": "Bearer " + backend.make_token(
            {"id": 1, "username": "admin", "role": "admin"})}

    def call(self, method, path, data=None):
        return getattr(self.client, method)("/api" + path, json=data, headers=self.headers)

    def test_seeded_login_dashboard_and_pages(self):
        login = self.client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        self.assertEqual(login.status_code, 200, login.json)
        for path in ("/dashboard/stats", "/users", "/dialplan", "/voicemail", "/queues", "/cdr"):
            response = self.call("get", path)
            self.assertEqual(response.status_code, 200, (path, response.json))
        self.assertIsNone(self.call("get", "/dashboard/stats").json["active_calls"])
        self.assertEqual(self.call("get", "/ivr").status_code, 501)

    def test_dialplan_native_rows_and_empty_arguments(self):
        data = {"pattern": self.name, "context": "internal", "priority": 1,
                "application": "Dial", "destination": "${PJSIP_DIAL_CONTACTS(100)},20"}
        response = self.call("post", "/dialplan", data)
        self.assertEqual(response.status_code, 201, response.json)
        path = "/dialplan/" + str(response.json["id"])
        self.assertEqual(self.call("post", "/dialplan", data).status_code, 409)
        row = backend.query("SELECT * FROM extensions WHERE id=%s", (response.json["id"],))[0]
        self.assertEqual(row["appdata"], data["destination"])
        self.assertEqual(self.call("put", path, {"application": "Hangup", "destination": ""}).status_code, 200)
        self.assertEqual(self.call("put", path, {"is_active": False}).status_code, 400)
        self.assertEqual(self.call("post", "/dialplan", {**data, "priority": 0}).status_code, 400)
        self.assertEqual(self.call("delete", path).status_code, 200)
        self.assertEqual(self.call("delete", path).status_code, 404)
        self.assertEqual(self.call("put", path, {"application": "Hangup"}).status_code, 404)

    def test_mailbox_native_boolean_pin_preservation_and_context(self):
        response = self.call("post", "/voicemail", {"mailbox": self.name, "password": "1234",
                                                   "context": "default", "attach": False})
        self.assertEqual(response.status_code, 201, response.json)
        path = "/voicemail/" + str(response.json["id"])
        self.assertEqual(self.call("put", path, {"password": "", "attach": True}).status_code, 200)
        row = backend.query("SELECT * FROM voicemail WHERE uniqueid=%s", (response.json["id"],))[0]
        self.assertEqual((row["password"], row["attach"]), ("1234", "yes"))
        listing = self.call("get", "/voicemail").json
        self.assertTrue(all("password" not in item for item in listing))
        self.assertEqual(self.call("post", "/voicemail", {"mailbox": "bad", "password": "0", "attach": "no"}).status_code, 400)
        self.assertEqual(self.call("delete", path).status_code, 200)

    def test_queue_string_key_and_members(self):
        response = self.call("post", "/queues", {"name": self.name, "strategy": "ringall"})
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["id"], self.name)
        path = "/queues/" + self.name
        self.assertEqual(self.call("put", path, {"timeout": 15, "wrapup_time": 2, "max_len": 5}).status_code, 200)
        self.assertEqual(self.call("post", path + "/members", {"interface": "PJSIP/100", "penalty": 0}).status_code, 201)
        members = self.call("get", path + "/members").json
        self.assertEqual(len(members), 1)
        queue = next(q for q in self.call("get", "/queues").json if q["id"] == self.name)
        self.assertEqual((queue["member_count"], queue["wrapup_time"], queue["max_len"]), (1, 2, 5))
        self.assertEqual(self.call("delete", path + "/members/" + str(members[0]["id"])).status_code, 200)
        self.assertEqual(self.call("delete", path).status_code, 200)

    def test_admin_only_and_deleted_token_revocation(self):
        data = {"username": self.name, "email": self.name + "@example.invalid", "password": "temp-pass"}
        self.assertEqual(self.call("post", "/users", {**data, "role": "operator"}).status_code, 400)
        self.assertEqual(self.call("post", "/users", data).status_code, 201)
        login = self.client.post("/api/auth/login", json=data)
        self.assertEqual(login.status_code, 200)
        user_id = login.json["user"]["id"]
        self.assertEqual(self.call("put", f"/users/{user_id}", {"is_active": False}).status_code, 400)
        self.assertEqual(self.call("delete", f"/users/{user_id}").status_code, 200)
        response = self.client.get("/api/auth/me", headers={"Authorization": "Bearer " + login.json["token"]})
        self.assertEqual(response.status_code, 401)
