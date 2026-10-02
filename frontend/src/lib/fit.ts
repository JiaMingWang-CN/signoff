import { useEffect, useState } from "react";

// Rows that fit the measured height of the element the returned ref is put on,
// so a list shows one screenful and pages instead of scrolling. The ref is a
// callback ref, so a hook can be attached to an element that mounts later or
// moves between tabs.
export function useFitRows(rowHeight: number, chrome = 0, min = 1) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [rows, setRows] = useState(6);
  useEffect(() => {
    if (!el) return;
    const update = () =>
      setRows(
        Math.max(min, Math.floor((el.clientHeight - chrome) / rowHeight)),
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, rowHeight, chrome, min]);
  return [setEl, rows] as const;
}

// Fit-to-height pagination over an in-memory list.
export function useFitPage<T>(items: T[], rowHeight: number, chrome = 0) {
  const [ref, size] = useFitRows(rowHeight, chrome);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages - 1);
  const visible = items.slice(current * size, current * size + size);
  return { ref, size, page: current, pages, setPage, visible, total: items.length };
}

// How many items of `itemHeight` (plus `gap`) fit in the measured element.
export function useCapacity(itemHeight: number, gap = 0, reserve = 0) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [capacity, setCapacity] = useState(99);
  useEffect(() => {
    if (!el) return;
    const update = () =>
      setCapacity(
        Math.max(
          1,
          Math.floor((el.clientHeight - reserve + gap) / (itemHeight + gap)),
        ),
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, itemHeight, gap, reserve]);
  return [setEl, capacity] as const;
}
