from workbench.security import builtin, dependencies, unlocked_manifests


def scan(tmp_path, name, text):
    file = tmp_path / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(text, encoding="utf-8")
    return builtin(tmp_path)


# Real false positives reported for JiaMingWang-CN/dsh-bundles.
FALSE_POSITIVES = {
    "lib/schedule.js": """
const relative = RELATIVE_PATTERN.exec(first);
const interval = INTERVAL_PATTERN.exec(second ?? '');
const daily = CLOCK_PATTERN.exec(second ?? '');
const clock = CLOCK_PATTERN.exec(first);
const absolute = ABSOLUTE_PATTERN.exec(`${first} ${second ?? ''}`.trim());
""",
    "lib/index.js": """
const body = next === undefined
  ? { ret: 0, msgs: [], get_updates_buf: `cursor-${delivered}` }
  : { ret: 0, msgs: [next], get_updates_buf: `cursor-${delivered += 1}` };
""",
    "lib/decision.js": r"""
const rules = {
  irreversible: [/--force\b/, /-f\b.*\brm\b/, /\btruncate\b/i, /\bdelete\s+from\b/i, /\bgit\s+push\b.*--force/]
};
""",
}


def test_javascript_regex_exec_and_lookalike_sql_are_not_findings(tmp_path):
    for name, text in FALSE_POSITIVES.items():
        assert scan(tmp_path, name, text) == [], name


def test_python_safe_patterns_are_not_findings(tmp_path):
    text = (
        "import yaml, re\n"
        "data = yaml.load(raw, Loader=yaml.SafeLoader)\n"
        "match = pattern.exec(text)\n"
        "cur.execute('SELECT * FROM users WHERE id = ?', (uid,))\n"
        "# eval(x) in a comment\n"
    )
    assert scan(tmp_path, "app.py", text) == []


def rules(findings):
    return {f["rule"] for f in findings}


def test_javascript_true_positives_are_still_detected(tmp_path):
    text = (
        "eval(userInput);\n"
        "const f = new Function(code);\n"
        "child_process.exec(cmd);\n"
        "const q = `SELECT * FROM users WHERE id = ${id}`;\n"
        "const q2 = 'DELETE FROM notes WHERE id=' + id;\n"
        "crypto.createHash('md5').update(p);\n"
        "spawn(cmd, { shell: true });\n"
        'const API_KEY = "abcdefghijkl";\n'
    )
    assert rules(scan(tmp_path, "src/server.js", text)) == {
        "eval-exec",
        "sql-interpolation",
        "weak-hash",
        "shell-true",
        "hardcoded-secret",
    }


def test_python_true_positives_are_still_detected(tmp_path):
    text = (
        "eval(user_input)\n"
        "exec(code)\n"
        'cur.execute("SELECT * FROM t WHERE a=%s" % value)\n'
        "yaml.load(payload)\n"
        "pickle.loads(blob)\n"
        "subprocess.run(cmd, shell=True)\n"
        "hashlib.sha1(data)\n"
    )
    assert rules(scan(tmp_path, "tool.py", text)) == {
        "eval-exec",
        "sql-interpolation",
        "unsafe-yaml",
        "pickle-load",
        "shell-true",
        "weak-hash",
    }


def test_test_files_skip_secrets_and_downgrade_other_findings(tmp_path):
    secret = 'const API_KEY = "abcdefghijkl";\n'
    assert scan(tmp_path, "test/channel.test.js", secret) == []
    (finding,) = scan(tmp_path, "tests/test_tool.py", "eval(payload)\n")
    assert finding["severity"] == "low" and "测试文件" in finding["title"]
    findings = scan(tmp_path, "src/channel.js", secret)
    (finding,) = [f for f in findings if f["file"] == "src/channel.js"]
    assert finding["severity"] == "high"


def test_secret_is_hidden_only_where_it_occurs(tmp_path):
    text = (
        "// a task's reply\n"
        "const note = 'keep this visible';\n"
        'const API_KEY = "abcdefghijkl";\n'
        "const other = \"also visible\";\n"
    )
    (finding,) = scan(tmp_path, "src/a.js", text)
    code = finding["code"]
    assert "abcdefghijkl" not in code
    assert "keep this visible" in code and "also visible" in code


# ── dependency manifests ─────────────────────────────────────────────

PNPM_V9 = """lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@deepseek-ai/schemastery':
        specifier: ^3.18.4
        version: 3.18.4

packages:

  '@deepseek-ai/cordis@4.0.4':
    resolution: {integrity: sha512-abc}
    hasBin: true

  '@deepseek-ai/dsh-web@0.2.0-rc.2':
    resolution: {integrity: sha512-def}

  lodash@4.17.20:
    resolution: {integrity: sha512-ghi}

snapshots:

  '@deepseek-ai/dsh-web@0.2.0-rc.2(@deepseek-ai/cordis@4.0.4)':
    dependencies:
      lodash: 4.17.20
"""

YARN_V1 = """# yarn lockfile v1


"@babel/core@^7.0.0", "@babel/core@^7.1.0":
  version "7.1.2"
  resolved "https://example"

lodash@^4.17.0:
  version "4.17.20"
"""


def packages(tmp_path):
    return {(e, n, v) for e, n, v, _, _ in dependencies(tmp_path)}


def test_pnpm_lock_is_parsed_without_duplicates(tmp_path):
    (tmp_path / "pnpm-lock.yaml").write_text(PNPM_V9, encoding="utf-8")
    assert packages(tmp_path) == {
        ("npm", "@deepseek-ai/cordis", "4.0.4"),
        ("npm", "@deepseek-ai/dsh-web", "0.2.0-rc.2"),
        ("npm", "lodash", "4.17.20"),
    }


def test_pnpm_lock_v6_and_v5_keys(tmp_path):
    (tmp_path / "pnpm-lock.yaml").write_text(
        "lockfileVersion: '6.0'\n\npackages:\n\n  /lodash@4.17.20:\n    dev: false\n\n"
        "  /@scope/pkg@1.2.3(peer@1.0.0):\n    dev: false\n",
        encoding="utf-8",
    )
    assert packages(tmp_path) == {
        ("npm", "lodash", "4.17.20"),
        ("npm", "@scope/pkg", "1.2.3"),
    }
    (tmp_path / "pnpm-lock.yaml").write_text(
        "lockfileVersion: 5.4\n\npackages:\n\n  /lodash/4.17.20:\n    dev: false\n\n"
        "  /@scope/pkg/1.2.3_peer@1.0.0:\n    dev: false\n",
        encoding="utf-8",
    )
    assert packages(tmp_path) == {
        ("npm", "lodash", "4.17.20"),
        ("npm", "@scope/pkg", "1.2.3"),
    }


def test_yarn_lock_v1_is_parsed(tmp_path):
    (tmp_path / "yarn.lock").write_text(YARN_V1, encoding="utf-8")
    assert packages(tmp_path) == {
        ("npm", "@babel/core", "7.1.2"),
        ("npm", "lodash", "4.17.20"),
    }


def test_yarn_lock_berry_is_parsed(tmp_path):
    (tmp_path / "yarn.lock").write_text(
        '__metadata:\n  version: 6\n\n"lodash@npm:^4.17.0":\n  version: 4.17.20\n'
        '  resolution: "lodash@npm:4.17.20"\n',
        encoding="utf-8",
    )
    assert packages(tmp_path) == {("npm", "lodash", "4.17.20")}


def test_large_lockfiles_are_not_skipped(tmp_path):
    body = "".join(
        f"  pkg-{i}@1.0.{i}:\n    resolution: {{integrity: sha512-{'a' * 40}}}\n"
        for i in range(8000)
    )
    file = tmp_path / "pnpm-lock.yaml"
    file.write_text("lockfileVersion: '9.0'\n\npackages:\n\n" + body, encoding="utf-8")
    assert file.stat().st_size > 500000
    assert len(dependencies(tmp_path)) == 8000


def test_manifests_with_ranges_and_no_lock_are_reported(tmp_path):
    ranged = '{"dependencies": {"a": "^1.0.0"}}'
    for name in ("with-lock", "without-lock", "exact"):
        (tmp_path / name).mkdir()
    (tmp_path / "with-lock/package.json").write_text(ranged)
    (tmp_path / "with-lock/pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
    (tmp_path / "without-lock/package.json").write_text(ranged)
    (tmp_path / "exact/package.json").write_text('{"dependencies": {"a": "1.0.0"}}')
    assert unlocked_manifests(tmp_path) == ["without-lock/package.json"]
