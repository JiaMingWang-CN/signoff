import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Repo, Session, Settings } from "../api";
import { ENTRY_UNAVAILABLE } from "../api";
import { useResource } from "./resource";

export type Theme = "light" | "dark";
export type Toast = { id: number; text: string; error?: boolean };

export type Store = {
  session: Session | null;
  settings: Settings | null;
  repos: Repo[];
  repo: Repo | null;
  online: boolean;
  select: (id: string) => void;
  reload: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  notify: (m: string, error?: boolean) => void;
  perform: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
  busy: string;
  error: string;
  clearError: () => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
};

const Context = createContext<Store | null>(null);

export function useStore() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing Workbench");
  return value;
}

let toastId = 0;

export function StoreProvider({ children }: { children: ReactNode }) {
  const auth = useResource<Session>("/auth/me");
  const settings = useResource<Settings>("/settings");
  const repos = useResource<Repo[]>("/repos", 3000);
  const [selected, setSelected] = useState(
    localStorage.getItem("ow-repo") || "",
  );
  const [theme, setTheme] = useState<Theme>(
    localStorage.getItem("ow-theme") === "dark" ? "dark" : "light",
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // Toast timers outlive the provider otherwise; keep them reachable.
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    localStorage.setItem("ow-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (text: string, error = false) => {
      const id = ++toastId;
      setToasts((list) => [...list.slice(-2), { id, text, error }]);
      const timer = setTimeout(() => dismiss(id), 5000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  // Leftover timers would fire after the provider is gone.
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const timer of live.values()) clearTimeout(timer);
      live.clear();
    };
  }, []);

  const select = useCallback((id: string) => {
    setSelected(id);
    localStorage.setItem("ow-repo", id);
  }, []);

  const perform = useCallback(
    async function perform<T>(label: string, fn: () => Promise<T>) {
      setBusy(label);
      setError("");
      try {
        return await fn();
      } catch (e) {
        const message = (e as Error).message;
        setError(message);
        // The banner states what failed; the toast survives navigation.
        if (message !== ENTRY_UNAVAILABLE) notify(message, true);
      } finally {
        setBusy("");
      }
    },
    [notify],
  );

  const repo =
    repos.data?.find((r) => r.id === selected) || repos.data?.[0] || null;
  const reload = useCallback(() => {
    auth.reload();
    settings.reload();
    repos.reload();
  }, [auth.reload, settings.reload, repos.reload]);

  const clearError = useCallback(() => setError(""), []);
  const loadError = auth.error || repos.error;
  const store: Store = useMemo(
    () => ({
      session: auth.data,
      settings: settings.data,
      repos: repos.data || [],
      repo,
      online: !loadError,
      select,
      theme,
      setTheme,
      notify,
      perform,
      busy,
      error: error || loadError,
      clearError,
      reload,
      toasts,
      dismiss,
    }),
    [
      auth.data,
      settings.data,
      repos.data,
      repo,
      loadError,
      select,
      theme,
      notify,
      perform,
      clearError,
      reload,
      busy,
      error,
      toasts,
      dismiss,
    ],
  );
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
