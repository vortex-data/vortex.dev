# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors

import json
import os
from pathlib import Path
import subprocess
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "provision.sh"


class TrustTests(unittest.TestCase):
    def render(self, role, **overrides):
        env = {k: v for k, v in os.environ.items()
               if k not in {"GITHUB_REPO", "SCHEMA_GITHUB_REPO", "INGEST_GITHUB_REPO", "TARGET_ACCOUNT"}}
        env.update(overrides)
        return subprocess.run(["bash", str(SCRIPT), "--print-trust", role],
                              env=env, text=True, capture_output=True)

    def test_exact_default_subjects(self):
        for role, repo in (("schema", "benchmarks-website"), ("ingest", "vortex")):
            result = self.render(role)
            self.assertEqual(result.returncode, 0, result.stderr)
            statement, = json.loads(result.stdout)["Statement"]
            self.assertEqual(statement["Action"], "sts:AssumeRoleWithWebIdentity")
            self.assertEqual(statement["Principal"], {"Federated":
                "arn:aws:iam::245040174862:oidc-provider/token.actions.githubusercontent.com"})
            self.assertEqual(statement["Condition"], {"StringEquals": {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": f"repo:vortex-data/{repo}:ref:refs/heads/develop",
            }})

    def test_repository_inputs_are_independent(self):
        overrides = {"SCHEMA_GITHUB_REPO": "example/schema", "INGEST_GITHUB_REPO": "example/writer"}
        for role, repo in (("schema", "schema"), ("ingest", "writer")):
            result = self.render(role, **overrides)
            self.assertEqual(result.returncode, 0, result.stderr)
            condition = json.loads(result.stdout)["Statement"][0]["Condition"]
            self.assertEqual(condition["StringEquals"]["token.actions.githubusercontent.com:sub"],
                             f"repo:example/{repo}:ref:refs/heads/develop")

    def test_shared_legacy_input_is_rejected(self):
        result = self.render("schema", GITHUB_REPO="example/old")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("was replaced", result.stderr)
