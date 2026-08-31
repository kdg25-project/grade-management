export const IDLE_TIMEOUT_MS = 600_000;
export const IDLE_CHANNEL_NAME = "grade-management:session-idle";

type IdleActivityMessage = {
  type: "activity";
  sessionKey: string;
  at: number;
};

type IdleLogoutMessage = {
  type: "logout";
  sessionKey: string;
  at: number;
};

export type IdleMessage = IdleActivityMessage | IdleLogoutMessage;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type MessageChannelLike = {
  postMessage(message: IdleMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<IdleMessage>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<IdleMessage>) => void): void;
  close?: () => void;
};
type EventTargetLike = {
  addEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
};

export type IdleCoordinatorOptions = {
  sessionKey: string;
  onLogout: (source: "idle" | "broadcast") => void;
  now?: () => number;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  storage?: StorageLike | null;
  channel?: MessageChannelLike | null;
  storageEventTarget?: EventTargetLike | null;
};

export type IdleCoordinator = {
  start: () => void;
  stop: () => void;
  activity: (at?: number) => void;
  check: (at?: number) => void;
  receive: (message: IdleMessage) => void;
  isLocked: () => boolean;
};

const keyPart = (sessionKey: string) => encodeURIComponent(sessionKey);
const activityKeyFor = (sessionKey: string) => `grade-management:idle-activity:${keyPart(sessionKey)}`;
const lockKeyFor = (sessionKey: string) => `grade-management:idle-lock:${keyPart(sessionKey)}`;

const readTimestamp = (storage: StorageLike | null | undefined, key: string) => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
};

const writeValue = (storage: StorageLike | null | undefined, key: string, value: string) => {
  try { storage?.setItem(key, value); } catch { /* Private browsing and quota errors are non-fatal. */ }
};

export const createIdleCoordinator = (options: IdleCoordinatorOptions): IdleCoordinator => {
  const now = options.now ?? Date.now;
  const scheduleTimer = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const cancelTimer = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const activityKey = activityKeyFor(options.sessionKey);
  const lockKey = lockKeyFor(options.sessionKey);
  let started = false;
  let locked = false;
  let lastActivity = 0;
  let timer: unknown = null;

  const clearTimer = () => {
    if (timer === null) return;
    cancelTimer(timer);
    timer = null;
  };

  const notify = (source: "idle" | "broadcast") => {
    if (locked) return;
    locked = true;
    clearTimer();
    writeValue(options.storage, lockKey, String(now()));
    try { options.channel?.postMessage({ type: "logout", sessionKey: options.sessionKey, at: now() }); } catch { /* Channel failures are non-fatal. */ }
    options.onLogout(source);
  };

  const schedule = () => {
    clearTimer();
    if (!started || locked) return;
    const remaining = lastActivity + IDLE_TIMEOUT_MS - now();
    timer = scheduleTimer(() => {
      timer = null;
      check();
    }, Math.max(0, remaining));
  };

  const check = (at = now()) => {
    if (!started || locked) return;
    if (readTimestamp(options.storage, lockKey) !== null) {
      notify("broadcast");
      return;
    }
    const sharedActivity = readTimestamp(options.storage, activityKey);
    if (sharedActivity !== null && sharedActivity > lastActivity) lastActivity = sharedActivity;
    if (at - lastActivity >= IDLE_TIMEOUT_MS) {
      notify("idle");
      return;
    }
    schedule();
  };

  const receive = (message: IdleMessage) => {
    if (!started || message.sessionKey !== options.sessionKey) return;
    if (message.type === "logout") {
      notify("broadcast");
      return;
    }
    if (locked || message.at <= lastActivity) return;
    lastActivity = message.at;
    check();
  };

  const handleChannelMessage = (event: MessageEvent<IdleMessage>) => receive(event.data);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === lockKey && event.newValue) {
      receive({ type: "logout", sessionKey: options.sessionKey, at: Number(event.newValue) || now() });
      return;
    }
    if (event.key === activityKey && event.newValue) {
      const at = Number(event.newValue);
      if (Number.isFinite(at)) receive({ type: "activity", sessionKey: options.sessionKey, at });
    }
  };

  return {
    start() {
      if (started) return;
      started = true;
      if (readTimestamp(options.storage, lockKey) !== null) {
        notify("broadcast");
        return;
      }
      lastActivity = readTimestamp(options.storage, activityKey) ?? now();
      writeValue(options.storage, activityKey, String(lastActivity));
      options.channel?.addEventListener("message", handleChannelMessage);
      options.storageEventTarget?.addEventListener("storage", handleStorage);
      check();
    },
    stop() {
      if (!started) return;
      started = false;
      clearTimer();
      options.channel?.removeEventListener("message", handleChannelMessage);
      options.storageEventTarget?.removeEventListener("storage", handleStorage);
      options.channel?.close?.();
    },
    activity(at = now()) {
      if (!started || locked) return;
      if (at - lastActivity >= IDLE_TIMEOUT_MS) {
        notify("idle");
        return;
      }
      if (at <= lastActivity) return;
      lastActivity = at;
      writeValue(options.storage, activityKey, String(at));
      try { options.channel?.postMessage({ type: "activity", sessionKey: options.sessionKey, at }); } catch { /* Channel failures are non-fatal. */ }
      schedule();
    },
    check,
    receive,
    isLocked: () => locked,
  };
};

const browserStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
};

const browserChannel = (): BroadcastChannel | null => {
  if (typeof BroadcastChannel === "undefined") return null;
  try { return new BroadcastChannel(IDLE_CHANNEL_NAME); } catch { return null; }
};

export const createBrowserIdleCoordinator = (options: Pick<IdleCoordinatorOptions, "sessionKey" | "onLogout">) => {
  return createIdleCoordinator({
    ...options,
    storage: browserStorage(),
    channel: browserChannel(),
    storageEventTarget: window,
  });
};

/** A lock only applies to the exact session that reached the idle deadline. */
export const hasIdleSessionLock = (storage: StorageLike | null | undefined, sessionKey: string) =>
  readTimestamp(storage, lockKeyFor(sessionKey)) !== null;

export const isIdleSessionLocked = (sessionKey: string) => hasIdleSessionLock(browserStorage(), sessionKey);

export const isTrustedActivityEvent = (event: Pick<Event, "isTrusted">) => event.isTrusted;
