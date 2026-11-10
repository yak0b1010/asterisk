"""Request/action logging checks; no database or running services required."""
import json
import unittest
from unittest.mock import patch

import app as backend


class LoggingTests(unittest.TestCase):
    def setUp(self):
        self.client = backend.app.test_client()

    def test_failed_login_logs_status_without_secrets(self):
        with patch.object(backend, "query", return_value=[]):
            with self.assertLogs("backend.actions", level="INFO") as logs:
                response = self.client.post(
                    "/api/auth/login?token=query-secret",
                    json={"username": "someone", "password": "password-secret"},
                    headers={"Authorization": "Bearer token-secret"},
                )
        entry = json.loads(logs.records[-1].getMessage())
        self.assertEqual(entry["status"], 401)
        self.assertEqual(entry["route"], "/api/auth/login")
        self.assertEqual(entry["request_id"], response.headers["X-Request-ID"])
        self.assertGreaterEqual(entry["duration_ms"], 0)
        self.assertNotIn("secret", str(logs.output))

    def test_unmatched_path_is_not_logged(self):
        with self.assertLogs("backend.actions", level="INFO") as logs:
            response = self.client.get("/private-secret")
        entry = json.loads(logs.records[-1].getMessage())
        self.assertEqual(response.status_code, 404)
        self.assertEqual(entry["route"], "<unmatched>")
        self.assertNotIn("private-secret", str(logs.output))

    def test_committed_extension_and_audit_failure_are_visible(self):
        with backend.app.test_request_context("/api/extensions", method="POST"):
            backend.start_request_log()
            backend.request.current_user = {"id": 1}
            with patch.object(backend, "get_conn", side_effect=RuntimeError("secret")):
                with self.assertLogs("backend.actions", level="INFO") as logs:
                    backend.audit("create_extension", "ps_endpoints", details="endpoint 7001")
        entries = [json.loads(record.getMessage()) for record in logs.records]
        self.assertEqual(entries[0]["action"], "create_extension")
        self.assertEqual(entries[0]["user_id"], 1)
        self.assertEqual(entries[1]["event"], "audit_write_failed")
        self.assertEqual(entries[1]["error_type"], "RuntimeError")
        self.assertNotIn("secret", str(logs.output))


if __name__ == "__main__":
    unittest.main()
