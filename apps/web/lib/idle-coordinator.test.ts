import { describe, expect, it } from "bun:test";

import { createIdleCoordinator, hasIdleSessionLock, IDLE_TIMEOUT_MS, isTrustedActivityEvent, type IdleMessage } from "./idle-coordinator";

class FakeTimers {
  now = 0;
  private nextId = 0;
  private timers = new Map<number, { callback: () => void; at: number }>();

  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.nextId;
    this.timers.set(id, { callback, at: this.now + delay });
    return id;
  };

  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };

  advance(ms: number) {
    this.now += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.now) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}

class FakeStorage {
  values = new Map<string, string>();
  getItem = (key: string) => this.values.get(key) ?? null;
  setItem = (key: string, value: string) => { this.values.set(key, value); };
}

class FakeChannel {
  peers = new Set<FakeChannel>();
  listener: ((event: MessageEvent<IdleMessage>) => void) | null = null;
  closed = false;
  postMessage = (message: IdleMessage) => {
    for (const peer of this.peers) peer.listener?.({ data: message } as MessageEvent<IdleMessage>);
  };
  addEventListener = (_type: "message", listener: (event: MessageEvent<IdleMessage>) => void) => { this.listener = listener; };
  removeEventListener = (_type: "message", listener: (event: MessageEvent<IdleMessage>) => void) => {
    if (this.listener === listener) this.listener = null;
  };
  close = () => { this.closed = true; this.listener = null; };
}

const coordinatorOptions = (timers: FakeTimers, storage: FakeStorage, onLogout: () => void, channel?: FakeChannel) => ({
  sessionKey: "session-1",
  onLogout,
  now: () => timers.now,
  setTimeout: timers.setTimeout,
  clearTimeout: timers.clearTimeout,
  storage,
  channel,
});

describe("idle coordinator", () => {
  it("logs out at the exact wall-clock deadline", () => {
    const timers = new FakeTimers();
    const events: string[] = [];
    const coordinator = createIdleCoordinator(coordinatorOptions(timers, new FakeStorage(), () => events.push("logout")));
    coordinator.start();
    timers.advance(IDLE_TIMEOUT_MS - 1);
    expect(events).toEqual([]);
    timers.advance(1);
    expect(events).toEqual(["logout"]);
  });

  it("resets the deadline only for explicit activity", () => {
    const timers = new FakeTimers();
    let logouts = 0;
    const coordinator = createIdleCoordinator(coordinatorOptions(timers, new FakeStorage(), () => { logouts += 1; }));
    coordinator.start();
    timers.advance(IDLE_TIMEOUT_MS - 1);
    coordinator.activity(timers.now);
    timers.advance(1);
    expect(logouts).toBe(0);
    timers.advance(IDLE_TIMEOUT_MS - 2);
    expect(logouts).toBe(0);
    timers.advance(1);
    expect(logouts).toBe(1);
  });

  it("is one-shot and cleans up timers and listeners", () => {
    const timers = new FakeTimers();
    const channel = new FakeChannel();
    let logouts = 0;
    const coordinator = createIdleCoordinator(coordinatorOptions(timers, new FakeStorage(), () => { logouts += 1; }, channel));
    coordinator.start();
    coordinator.receive({ type: "logout", sessionKey: "session-1", at: 0 });
    coordinator.receive({ type: "logout", sessionKey: "session-1", at: 0 });
    expect(logouts).toBe(1);
    coordinator.stop();
    expect(channel.closed).toBeTrue();
    timers.advance(IDLE_TIMEOUT_MS * 2);
    expect(logouts).toBe(1);
  });

  it("shares activity and logout across tabs", () => {
    const timers = new FakeTimers();
    const storage = new FakeStorage();
    const channelA = new FakeChannel();
    const channelB = new FakeChannel();
    channelA.peers.add(channelB);
    channelB.peers.add(channelA);
    let logoutsA = 0;
    let logoutsB = 0;
    const first = createIdleCoordinator(coordinatorOptions(timers, storage, () => { logoutsA += 1; }, channelA));
    const second = createIdleCoordinator(coordinatorOptions(timers, storage, () => { logoutsB += 1; }, channelB));
    first.start();
    second.start();
    timers.advance(IDLE_TIMEOUT_MS - 1);
    first.activity(timers.now);
    timers.advance(1);
    expect(logoutsA).toBe(0);
    expect(logoutsB).toBe(0);
    second.receive({ type: "logout", sessionKey: "session-1", at: timers.now });
    expect(logoutsA).toBe(1);
    expect(logoutsB).toBe(1);
  });

  it("reads the latest shared activity before a stale timer logs out", () => {
    const timers = new FakeTimers();
    const storage = new FakeStorage();
    let logouts = 0;
    const coordinator = createIdleCoordinator(coordinatorOptions(timers, storage, () => { logouts += 1; }));
    coordinator.start();
    timers.advance(IDLE_TIMEOUT_MS - 1);
    storage.setItem("grade-management:idle-activity:session-1", String(timers.now));
    timers.advance(1);
    expect(logouts).toBe(0);
  });

  it("checks a background-throttled deadline without requiring an activity event", () => {
    const timers = new FakeTimers();
    let logouts = 0;
    const coordinator = createIdleCoordinator(coordinatorOptions(timers, new FakeStorage(), () => { logouts += 1; }));
    coordinator.start();
    coordinator.check(IDLE_TIMEOUT_MS);
    expect(logouts).toBe(1);
  });

  it("keeps an idle lock scoped to the expired session and accepts only trusted activity", () => {
    const storage = new FakeStorage();
    storage.setItem("grade-management:idle-lock:session-1", "1");
    expect(hasIdleSessionLock(storage, "session-1")).toBe(true);
    expect(hasIdleSessionLock(storage, "session-2")).toBe(false);
    expect(isTrustedActivityEvent({ isTrusted: true })).toBe(true);
    expect(isTrustedActivityEvent({ isTrusted: false })).toBe(false);
  });
});
