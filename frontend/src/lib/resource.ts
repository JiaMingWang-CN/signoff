import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

// One entry per path: every component mounted on the same path shares one
// request, one poll timer and one copy of the data, instead of each firing
// its own fetch against the backend.
type Entry = {
  data: unknown;
  error: string;
  seq: number; // increments per fetch; a slow late answer is dropped
  subscribers: Map<() => void, number>; // notify callback -> its interval
  timer?: ReturnType<typeof setInterval>;
  detach?: () => void;
};

const entries = new Map<string, Entry>();

function entryFor(path: string) {
  let entry = entries.get(path);
  if (!entry) {
    entry = {
      data: null,
      error: "",
      seq: 0,
      subscribers: new Map(),
    };
    entries.set(path, entry);
  }
  return entry;
}

// The shortest requested interval wins; an interval of 0 means no polling.
function minInterval(entry: Entry) {
  let smallest = 0;
  for (const interval of entry.subscribers.values()) {
    if (!interval) continue;
    if (!smallest || interval < smallest) smallest = interval;
  }
  return smallest;
}

function notify(entry: Entry) {
  for (const rerender of entry.subscribers.keys()) rerender();
}

async function load(path: string, entry: Entry) {
  const seq = ++entry.seq;
  try {
    const result = await api<unknown>(path);
    if (seq !== entry.seq) return; // a newer request already started
    entry.data = result;
    entry.error = "";
  } catch (e) {
    if (seq !== entry.seq) return;
    entry.error = (e as Error).message;
  }
  notify(entry);
}

function stopTimer(entry: Entry) {
  if (entry.timer) {
    clearInterval(entry.timer);
    entry.timer = undefined;
  }
  if (entry.detach) {
    entry.detach();
    entry.detach = undefined;
  }
}

function syncTimer(path: string, entry: Entry) {
  stopTimer(entry);
  const period = minInterval(entry);
  if (!period) return;
  const onVisible = () => {
    if (!document.hidden) void load(path, entry);
  };
  document.addEventListener("visibilitychange", onVisible);
  entry.detach = () => document.removeEventListener("visibilitychange", onVisible);
  entry.timer = setInterval(() => {
    // Nothing to keep fresh while nobody is looking; on the first moment
    // someone is, the poll fires immediately instead of showing stale data.
    if (document.hidden) return;
    void load(path, entry);
  }, period);
}

// GET a path and keep it fresh (optional polling). Switching path clears the
// data. Two components on the same path share one fetch loop.
export function useResource<T>(path: string | null, interval = 0) {
  const [, force] = useState({});
  const current = useRef(path);
  current.current = path;

  useEffect(() => {
    if (!path) return;
    const entry = entryFor(path);
    const rerender = () => force({});
    entry.subscribers.set(rerender, interval);
    syncTimer(path, entry);
    void load(path, entry);
    return () => {
      entry.subscribers.delete(rerender);
      if (entry.subscribers.size === 0) {
        stopTimer(entry);
        entries.delete(path);
      } else {
        syncTimer(path, entry);
      }
    };
    // path and interval are the only things that change this effect.
  }, [path, interval]);

  const reload = useCallback(() => {
    const path = current.current;
    if (path) void load(path, entryFor(path));
  }, []);

  const entry = path ? entries.get(path) : undefined;
  return {
    data: (entry?.data as T | null) ?? null,
    error: entry?.error ?? "",
    reload,
  };
}