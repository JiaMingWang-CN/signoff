from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", env_file_encoding="utf-8-sig", extra="ignore"
    )
    app_secret: str = ""
    public_url: str = "http://127.0.0.1:5173"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    database_url: str = "sqlite:///./data/workbench.db"
    github_client_id: str = ""
    github_client_secret: str = ""
    github_oauth_scopes: str = "repo read:user"
    # 逗号分隔的 GitHub 用户名；留空表示任何 GitHub 账号都可登录。
    allowed_github_users: str = ""
    demo_repo: str = "JiaMingWang-CN/oss-workbench-demo"
    demo_github_token: str = ""
    guest_daily_agent_runs: int = 5
    guest_daily_llm_tokens: int = 200000
    guest_daily_console_messages: int = 100
    guest_max_conversations: int = 20
    llm_timeout_seconds: int = 120
    workspace_dir: str = "~/.oss-workbench/workspaces"
    agent_default_permission: str = "approve"
    agent_max_steps: int = 40
    agent_command_timeout_seconds: int = 300
    agent_max_tokens: int = 200000
    agent_sandbox: bool = False
    # 一个审批最多等待多久；超时即判拒绝并结束运行，避免永久挂起。
    agent_approval_timeout_seconds: int = 1800
    codegraph_bin: str = "codegraph"
    osv_api_url: str = "https://api.osv.dev/v1"
    semgrep_bin: str = "semgrep"
    bandit_bin: str = "bandit"


settings = Settings()
(ROOT / "data").mkdir(exist_ok=True)
if not settings.app_secret:
    import secrets

    secret_file = ROOT / "data" / "session.secret"
    if not secret_file.exists():
        # 0600：同机其他用户不能读，否则可伪造会话或解密存储的令牌。
        import os

        fd = os.open(secret_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(secrets.token_urlsafe(48))
        os.chmod(secret_file, 0o600)
    settings.app_secret = secret_file.read_text(encoding="utf-8").strip()


def safe_error(error: Exception | str, limit: int | None = 4000) -> str:
    text = str(error)
    try:
        from .services import llm_api_key

        stored_key = llm_api_key()
    except Exception:
        stored_key = ""
    for value in [
        settings.app_secret,
        stored_key,
        settings.github_client_secret,
        settings.demo_github_token,
    ]:
        # A placeholder such as "0" is not a secret; replacing it would mangle
        # ordinary text like a status code.
        if value and len(value) >= 8:
            text = text.replace(value, "[redacted]")
    import re

    # Require a word boundary and a realistic token length so that ordinary
    # text such as "Flask-SQLAlchemy" or "task-list" is left untouched.
    text = re.sub(
        r"(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})",
        "[redacted]",
        text,
    )
    return text[:limit] if limit else text
