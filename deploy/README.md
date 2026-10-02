# Signoff 公网部署

部署目录 `/programs/signoff`，主地址 `https://www.signoff.top`。证书和现有 `backend/.env` 留在服务器，不进入 Git。

- 使用 `nginx-signoff.conf` 替换旧的 Signoff IP/域名虚拟主机，先执行 `nginx -t` 再 reload。其它网站的虚拟主机不需要改动。
- 使用已有 PM2 的 `startOrRestart deploy/ecosystem.config.cjs --update-env` 和 `save` 更新后端。
- Ubuntu 安装 `bubblewrap`，在 `signoff` 用户下验证可创建命名空间。公开地址的真实仓库命令缺少此工具时拒绝执行；不能通过关闭 `AGENT_SANDBOX` 绕过公网限制。
- Ubuntu 24.04 的 AppArmor 若阻止 bwrap 创建命名空间，安装本目录 `apparmor-bwrap` 到 `/etc/apparmor.d/signoff-bwrap`，执行 `apparmor_parser -r /etc/apparmor.d/signoff-bwrap`。此例外只匹配 `/usr/bin/bwrap`，不要关闭系统全局的用户命名空间限制；隔离内部禁止再创建用户命名空间。
- 命令只能读写本次 worktree；系统工具和 Python 虚拟环境只读挂载，应用配置、数据库、主机 home 不挂载。网络默认隔离，需要网络的仓库测试会如实失败。完整权限的文件工具仍不能离开 worktree。
- 保持应用 `.env` 为 `root:signoff 640`、数据目录 `signoff:signoff 750`，TLS 私钥为 `root:root 600`。
- 安装依赖前升级虚拟环境 pip：`.venv/bin/python -m pip install --upgrade 'pip>=26.2.0'`。只安装可信且锁定的依赖。
- 在确认 HTTPS 管理入口仍能访问后，删除 UFW 中 `2005/tcp` 的 Anywhere 放行规则，添加 `ufw deny 2005/tcp`；保留 SSH 和现有 HTTPS 管理入口。
- GitHub 凭据、演示 token 和登录白名单由部署者配置。升级不覆盖这些值。

公网部署（`PUBLIC_URL` 非回环地址）下，访客为只读：后端拒绝未登录请求的所有写类操作（退出登录与打开示例仓库除外），返回 403 与“当前为演示版本，请前往仓库进行本地部署”及仓库链接；下面的访客配额只在本地部署的访客上起作用。

访客使用签名 cookie 中的随机身份隔离会话、扫描、规划和运行；IP 只用于配额。历史没有归属字段的演示记录仅登录管理员可见。每日默认 100 条控制台消息、每 IP 最多 20 个会话，单个会话最多 200 条记录；新建 cookie 不会重置 IP 配额。

单后端进程同时只处理一个访客模型请求，其余返回 429；输入按序列化字节数保守估计，再加输出上限检查额度。这不是供应商账单保证；多进程部署需要共享的原子用量控制。

提供的证书仍需在到期前续期并覆盖原证书路径，随后执行 `nginx -t && systemctl reload nginx`；这里没有创建证书续期任务。
