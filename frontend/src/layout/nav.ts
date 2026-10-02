import {
  Bot,
  CalendarDays,
  History,
  LayoutDashboard,
  MessagesSquare,
  ListChecks,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
};

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "总控",
    items: [{ path: "/console", label: "总控台", icon: MessagesSquare }],
  },
  {
    label: "仓库",
    items: [
      { path: "/overview", label: "概览", icon: LayoutDashboard },
      { path: "/search", label: "检索", icon: Search },
      { path: "/security", label: "漏洞分析", icon: ShieldAlert },
      { path: "/planning", label: "规划", icon: ListChecks },
      { path: "/calendar", label: "日历", icon: CalendarDays },
    ],
  },
  {
    label: "执行",
    items: [
      { path: "/agent", label: "Agent 运行", icon: Bot },
      { path: "/runs", label: "运行记录与审计", icon: History },
    ],
  },
  {
    label: "系统",
    items: [{ path: "/settings", label: "设置", icon: SlidersHorizontal }],
  },
];

export const navItems = navGroups.flatMap((g) => g.items);
