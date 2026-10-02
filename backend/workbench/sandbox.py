import os
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse

from .config import ROOT, settings


def sandbox_command(args, cwd):
    local = (urlparse(settings.public_url).hostname or "").lower() in (
        "127.0.0.1", "localhost", "::1"
    )
    if local and not settings.agent_sandbox:
        return args
    executable = shutil.which("bwrap") if os.name == "posix" else None
    if not executable:
        raise RuntimeError("公开部署的仓库命令需要 Linux bubblewrap 隔离；未安装时拒绝执行")
    work = Path(cwd).resolve()
    if ROOT.is_relative_to(work) or work.is_relative_to(ROOT):
        raise ValueError("隔离工作区不能包含应用目录")
    command = [
        executable, "--unshare-all", "--unshare-user", "--disable-userns", "--die-with-parent", "--new-session",
        "--cap-drop", "ALL", "--clearenv",
    ]
    for name in ("/usr", "/bin", "/lib", "/lib64"):
        if Path(name).exists():
            if ROOT.is_relative_to(Path(name).resolve()):
                raise ValueError("系统运行时挂载不能包含应用目录")
            command += ["--ro-bind", name, name]
    for name in ("/etc/ssl", "/etc/ld.so.cache", "/etc/passwd", "/etc/group",
                 "/etc/nsswitch.conf", "/etc/hosts", "/etc/resolv.conf"):
        if Path(name).exists():
            command += ["--ro-bind", name, name]
    runtime = str(Path(sys.prefix).resolve())
    if not Path(runtime).is_relative_to("/usr"):
        command += ["--ro-bind", runtime, runtime]
    base_runtime = str(Path(sys.base_prefix).resolve())
    if not Path(base_runtime).is_relative_to("/usr") and base_runtime != runtime:
        if ROOT.is_relative_to(base_runtime):
            raise ValueError("Python 基础运行时不能包含应用目录")
        command += ["--ro-bind", base_runtime, base_runtime]
    command += [
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
        "--dir", "/home/worker", "--bind", str(work), str(work),
    ]
    if (work / ".git").is_file():
        command += ["--ro-bind", "/dev/null", str(work / ".git")]
    for key, value in {
        "HOME": "/home/worker", "TMPDIR": "/tmp", "LANG": "C.UTF-8",
        "PATH": str(Path(sys.executable).parent) + ":/usr/local/bin:/usr/bin:/bin",
        "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8",
        "LD_LIBRARY_PATH": str(Path(base_runtime) / "lib"),
    }.items():
        command += ["--setenv", key, value]
    return command + ["--chdir", str(work), "--", *args]
