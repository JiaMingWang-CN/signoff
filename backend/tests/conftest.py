import os
import tempfile
from pathlib import Path

test_root = Path(tempfile.mkdtemp(prefix="oss-workbench-tests-"))
os.environ["DATABASE_URL"] = "sqlite:///" + (test_root / "tests.db").as_posix()
os.environ["WORKSPACE_DIR"] = str(test_root / "workspaces")
os.environ["APP_SECRET"] = "test-session-secret-with-at-least-thirty-two-bytes"
os.environ["DEMO_GITHUB_TOKEN"] = ""

import pytest
from fastapi.testclient import TestClient

from workbench.app import app


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client
