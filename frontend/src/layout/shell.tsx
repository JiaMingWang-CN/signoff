import {
  AlertCircle,
  Check,
  ChevronsUpDown,
  CircleCheck,
  Code2,
  GitBranch,
  LogIn,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
  X,
} from "lucide-react";
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { api } from "../api";
import { useStore } from "../lib/store";
import { cn } from "../lib/utils";
import { Badge, Button, Menu, MenuLink } from "../components";
import Repositories from "../pages/Repositories";
import RequireRepo from "../pages/RequireRepo";
import { CommandPalette } from "./command";
import { navGroups } from "./nav";

// Each page loads on first visit so the workbench entry chunk stays small.
const AgentRun = lazy(() => import("../pages/AgentRun"));
const Calendar = lazy(() => import("../pages/Calendar"));
const Console = lazy(() => import("../pages/Console"));
const Overview = lazy(() => import("../pages/Overview"));
const Planning = lazy(() => import("../pages/Planning"));
const Runs = lazy(() => import("../pages/Runs"));
const Search_ = lazy(() => import("../pages/Search"));
const Security = lazy(() => import("../pages/Security"));
const Settings = lazy(() => import("../pages/Settings"));

export function Logo() {
  return (
    <span className="logo" aria-hidden="true">
      <Code2 />
    </span>
  );
}

function ThemeButton() {
  const s = useStore();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="tip-b"
      data-tip="切换主题"
      aria-label="切换深浅色主题"
      onClick={() => s.setTheme(s.theme === "light" ? "dark" : "light")}
    >
      {s.theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}


function RepoSwitcher() {
  const s = useStore();
  const [owner, name] = s.repo
    ? s.repo.name.includes("/")
      ? s.repo.name.split("/")
      : ["", s.repo.name]
    : ["", "选择仓库"];
  return (
    <Menu
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className="switcher"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="切换仓库"
          onClick={toggle}
        >
          {owner && <span className="owner">{owner} /</span>}
          <span className="ellipsis">{name}</span>
          <ChevronsUpDown style={{ color: "var(--muted-foreground)" }} />
        </button>
      )}
    >
      <div className="lbl">仓库</div>
      {s.repos.map((r) => (
        <button
          key={r.id}
          type="button"
          role="menuitem"
          onClick={() => s.select(r.id)}
        >
          {r.id === s.repo?.id ? <Check /> : <GitBranch />}
          <span className="ellipsis">{r.name}</span>
        </button>
      ))}
      {!s.repos.length && <div className="lbl">还没有导入仓库</div>}
      <hr />
      <MenuLink to="/repos">
        <Plus />
        导入或管理仓库…
      </MenuLink>
    </Menu>
  );
}

function UserMenu() {
  const s = useStore();
  const user = s.session?.user;
  return (
    <Menu
      align="right"
      trigger={({ toggle }) => (
        <button
          type="button"
          className="avatar"
          aria-label="账户菜单"
          onClick={toggle}
        >
          {user ? <img src={user.avatar_url} alt="" /> : "访"}
        </button>
      )}
    >
      <div className="lbl">
        {user ? user.login : "访客 · 示例仓库只读"}
      </div>
      <MenuLink to="/settings">
        <SettingsIcon />
        设置
      </MenuLink>
      <hr />
      {user ? (
        <button
          type="button"
          role="menuitem"
          onClick={() =>
            void s.perform("logout", async () => {
              await api("/auth/logout", {});
              s.reload();
            })
          }
        >
          <LogIn />
          退出登录
        </button>
      ) : (
        <a href="/api/auth/github/login" role="menuitem">
          <LogIn />
          使用 GitHub 登录
        </a>
      )}
    </Menu>
  );
}

function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const s = useStore();
  const user = s.session?.user;
  return (
    <aside className="sidebar">
      {navGroups.map((group) => (
        <div key={group.label}>
          <div className="nav-label">{group.label}</div>
          <nav className="nav" aria-label={group.label}>
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                data-tip={item.label}
                aria-label={collapsed ? item.label : undefined}
                className={({ isActive }) => cn(isActive && "active")}
              >
                <item.icon />
                <span className="lbl">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      ))}
      <div className="sidebar-foot">
        <div className="health" title={s.online ? "后端在线" : "后端不可用"}>
          <span className={cn("live", !s.online && "off")} />
          <span className="txt">{s.online ? "后端在线" : "后端不可用"}</span>
        </div>
        <div className="user-card">
          <span className="avatar" style={{ cursor: "default" }}>
            {user ? <img src={user.avatar_url} alt="" /> : "访"}
          </span>
          <div className="user-meta">
            <b>{user ? user.login : "访客"}</b>
            <span className="muted">
              {user ? "已登录 GitHub" : "示例仓库只读"}
            </span>
          </div>
        </div>
        {!user && (
          <a
            className="btn btn-outline btn-sm login-btn"
            href="/api/auth/github/login"
          >
            <LogIn />
            使用 GitHub 登录
          </a>
        )}
        <nav className="nav">
          <button
            type="button"
            data-tip="展开侧栏"
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            onClick={onToggle}
          >
            <PanelLeft />
            <span className="lbl">收起侧栏</span>
          </button>
        </nav>
      </div>
    </aside>
  );
}

export function Toaster() {
  const s = useStore();
  return (
    <div className="toast-stack" aria-live="polite">
      {s.toasts.map((t) => (
        <div key={t.id} className="toast" role="status">
          {t.error ? <AlertCircle /> : <CircleCheck />}
          <span className="msg">{t.text}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="关闭通知"
            onClick={() => s.dismiss(t.id)}
          >
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}

function GuardedRoute({ children }: { children: ReactNode }) {
  return <RequireRepo>{children}</RequireRepo>;
}

export default function Shell() {
  const s = useStore();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("ow-nav");
    return saved ? saved === "collapsed" : innerWidth < 1200;
  });
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    localStorage.setItem("ow-nav", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  return (
    <div
      className={
        "ow app page-" + (location.pathname.slice(1) || "overview")
      }
      data-theme={s.theme}
    >
      <header className="topbar">
        <Link className="brand" to="/">
          <Logo />
          <span className="hide-sm">
            Sign<em>/</em>off
          </span>
        </Link>
        <span className="crumb-sep">/</span>
        <RepoSwitcher />
        {!s.session?.user && (
          <Badge tone="brand" className="hide-sm">
            访客模式
          </Badge>
        )}
        <div className="spacer" />
        <button
          type="button"
          className="cmdk-trigger"
          aria-label="打开命令面板"
          onClick={() => setPalette(true)}
        >
          <Search />
          <span>搜索或跳转…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <ThemeButton />
        <UserMenu />
      </header>
      <div className={cn("layout", collapsed && "collapsed")}>
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
        />
        <main className="live-main">
          <Suspense fallback={null}>
          <Routes>
            <Route path="/repos" element={<Repositories />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/console" element={<Console />} />
            <Route
              path="/overview"
              element={
                <GuardedRoute>
                  <Overview />
                </GuardedRoute>
              }
            />
            <Route
              path="/search"
              element={
                <GuardedRoute>
                  <Search_ />
                </GuardedRoute>
              }
            />
            <Route
              path="/security"
              element={
                <GuardedRoute>
                  <Security />
                </GuardedRoute>
              }
            />
            <Route
              path="/planning"
              element={
                <GuardedRoute>
                  <Planning />
                </GuardedRoute>
              }
            />
            <Route
              path="/calendar"
              element={
                <GuardedRoute>
                  <Calendar />
                </GuardedRoute>
              }
            />
            <Route
              path="/agent"
              element={
                <GuardedRoute>
                  <AgentRun />
                </GuardedRoute>
              }
            />
            <Route
              path="/runs"
              element={
                <GuardedRoute>
                  <Runs />
                </GuardedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/repos" replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}
