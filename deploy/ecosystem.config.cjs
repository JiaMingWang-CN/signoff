module.exports = {
  apps: [{
    name: "signoff-backend",
    script: "/usr/bin/setpriv",
    interpreter: "none",
    args: [
      "--reuid=signoff",
      "--regid=signoff",
      "--init-groups",
      "/programs/signoff/backend/.venv/bin/python",
      "/programs/signoff/backend/run.py"
    ],
    cwd: "/programs/signoff/backend",
    autorestart: true,
    env: {
      HOME: "/home/signoff",
      USER: "signoff",
      LOGNAME: "signoff",
      PATH: "/usr/bin:/bin",
      PYTHONUNBUFFERED: "1",
      AGENT_SANDBOX: "true"
    }
  }]
};
