# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "provision.sh"

# Sources provision.sh and runs ensure_security_group against a fake `aws`. The
# fake returns $PERMISSIONS for the group's ingress rules and records each
# authorize call in $CALLS.
HARNESS = r"""
source "$SCRIPT"
DEFAULT_VPC_ID=vpc-test
aws() {
    case "$*" in
        *"describe-security-groups --filters"*) echo sg-test ;;
        *"describe-security-groups --group-ids"*) printf '%s\n' "$PERMISSIONS" ;;
        *"authorize-security-group-ingress"*) echo "$*" >> "$CALLS" ;;
        *) echo "unexpected: aws $*" >&2; return 1 ;;
    esac
}
ensure_security_group
"""


def rule(protocol, from_port, to_port, *cidrs):
    return {"IpProtocol": protocol, "FromPort": from_port, "ToPort": to_port,
            "IpRanges": [{"CidrIp": cidr} for cidr in cidrs]}


class SecurityGroupTests(unittest.TestCase):
    def authorize_calls(self, permissions):
        with tempfile.NamedTemporaryFile("r") as calls:
            result = subprocess.run(
                ["bash", "-c", HARNESS],
                env={"PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
                     "SCRIPT": str(SCRIPT), "CALLS": calls.name,
                     "PERMISSIONS": json.dumps(permissions)},
                text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return calls.read().splitlines()

    def test_skips_when_the_exact_rule_exists(self):
        for permissions in ([rule("tcp", 5432, 5432, "0.0.0.0/0")],
                            [rule("tcp", 5432, 5432, "10.0.0.0/8", "0.0.0.0/0")]):
            self.assertEqual(self.authorize_calls(permissions), [])

    def test_authorizes_when_only_a_similar_rule_exists(self):
        for permissions in ([],
                            [rule("udp", 5432, 5432, "0.0.0.0/0")],
                            [rule("tcp", 5432, 5440, "0.0.0.0/0")],
                            [rule("tcp", 5432, 5432, "203.0.113.0/24")]):
            calls = self.authorize_calls(permissions)
            self.assertEqual(len(calls), 1, permissions)
            self.assertIn("--protocol tcp --port 5432 --cidr 0.0.0.0/0", calls[0])


if __name__ == "__main__":
    unittest.main()
