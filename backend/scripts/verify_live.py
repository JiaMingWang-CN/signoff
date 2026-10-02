"""Exercise the configured LLM and a simulated demo-repository repair."""

import json
import time

import httpx

with httpx.Client(base_url="http://127.0.0.1:8000", timeout=180) as client:
    repos = client.get("/api/repos").json()
    repo = next(r for r in repos if r.get("demo"))
    plans = client.get("/api/repos/" + repo["id"] + "/plans").json()
    assert plans, "Generate a real LLM plan before running this verification."
    plan = plans[0]
    schedule = client.post(
        "/api/repos/" + repo["id"] + "/schedule",
        json={"tasks": plan["tasks"], "capacity": plan["capacity"]},
    )
    schedule.raise_for_status()
    print("Saved calendar:", schedule.json()["id"], flush=True)
    task = next(t for t in plan["tasks"] if "搜索" in t["title"])
    task = {
        **task,
        "title": task["title"]
        + "；虚拟新增单引号回归测试并修复参数绑定，同时虚拟将 app/importer.py 的 yaml.load 改为 yaml.safe_load。仅展示这些虚拟变更与测试命令预览，不运行项目程序，不声称测试通过。",
    }
    response = client.post(
        "/api/repos/" + repo["id"] + "/runs",
        json={
            "task": task,
            "config": {"preset": "approve", "max_steps": 25, "max_tokens": 100000},
        },
    )
    response.raise_for_status()
    identity = response.json()["id"]
    print("Simulated Agent run:", identity, flush=True)
    for _ in range(360):
        run = client.get("/api/runs/" + identity).json()
        if run["status"] not in ("starting", "running", "waiting"):
            print(
                json.dumps(
                    {
                        "run": identity,
                        "status": run["status"],
                        "test_exit": run["tests"].get("exit_code"),
                        "output": run["tests"].get("output", ""),
                        "hash_valid": run["hash_valid"],
                        "error": run["error"],
                        "diff_bytes": len(run["diff"]),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            assert run["status"] == "completed" and run["config"]["simulated"]
            assert run["tests"]["simulated"] and run["tests"]["exit_code"] is None
            assert not run["branch"] and not run["commit_sha"] and not run["pr_url"]
            assert run["hash_valid"] and run["diff"]
            report = client.get("/api/runs/" + identity + "/report?format=json")
            report.raise_for_status()
            assert report.json()["hash_valid"]
            break
        time.sleep(1)
    else:
        client.post("/api/runs/" + identity + "/stop")
        raise RuntimeError("Agent verification timed out and was stopped.")
