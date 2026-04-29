import { useEffect, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

type SaveSnapshot = {
  status: SaveState;
  lastSavedAt: string | null;
  error: string;
};

const listeners = new Set<(snapshot: SaveSnapshot) => void>();

let snapshot: SaveSnapshot = {
  status: "idle",
  lastSavedAt: null,
  error: "",
};

let idleTimer: ReturnType<typeof setTimeout> | null = null;

const notify = () => {
  listeners.forEach((listener) => listener(snapshot));
};

const clearIdleTimer = () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
};

const normalizeSavedAt = (value?: string | Date | null) => {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const extractSavedAt = (result: any) => {
  const data = result?.data;
  if (Array.isArray(data)) return data[0]?.updated_at ?? null;
  return data?.updated_at ?? null;
};

const updateSnapshot = (partial: Partial<SaveSnapshot>) => {
  snapshot = { ...snapshot, ...partial };
  notify();
};

export const syncLastSavedAt = (value?: string | Date | null) => {
  const normalized = normalizeSavedAt(value);
  const current = snapshot.lastSavedAt ? new Date(snapshot.lastSavedAt).getTime() : 0;
  const incoming = new Date(normalized).getTime();

  if (incoming >= current) {
    updateSnapshot({ lastSavedAt: normalized });
  }
};

export const markSaveStart = () => {
  clearIdleTimer();
  updateSnapshot({ status: "saving", error: "" });
};

export const markSaveSuccess = (savedAt?: string | Date | null) => {
  clearIdleTimer();
  updateSnapshot({ status: "saved", error: "" });
  syncLastSavedAt(savedAt);
  idleTimer = setTimeout(() => {
    updateSnapshot({ status: "idle" });
    idleTimer = null;
  }, 2000);
};

export const markSaveError = (error: unknown) => {
  clearIdleTimer();
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Error desconocido";
  updateSnapshot({ status: "error", error: message });
};

export async function trackSave<T>(promise: PromiseLike<T>, options?: { savedAt?: string | Date | null }) {
  markSaveStart();
  try {
    const result: any = await promise;
    if (result?.error) throw result.error;
    markSaveSuccess(options?.savedAt ?? extractSavedAt(result));
    return result as T;
  } catch (error) {
    markSaveError(error);
    throw error;
  }
}

export function useGlobalSaveStatus() {
  const [state, setState] = useState(snapshot);

  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return state;
}