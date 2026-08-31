import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { authClient } from "@/lib/auth-client";
import { createBrowserIdleCoordinator, isTrustedActivityEvent } from "@/lib/idle-coordinator";

export function SessionIdleLogout({ sessionKey, children }: Readonly<{ sessionKey: string; children: React.ReactNode }>) {
  const navigate = useNavigate();

  useEffect(() => {
    const coordinator = createBrowserIdleCoordinator({
      sessionKey,
      onLogout: (source) => {
        if (source === "broadcast") {
          navigate("/login", { replace: true });
          return;
        }
        // Keep the same session's idle lock in place until the request settles. If offline,
        // LoginPage sees the lock and does not redirect the stale cached session back inside.
        void Promise.resolve()
          .then(() => authClient.signOut())
          .catch(() => undefined)
          .finally(() => navigate("/login", { replace: true }));
      },
    });
    coordinator.start();

    const activity = (event: Event) => {
      if (isTrustedActivityEvent(event)) coordinator.activity();
    };
    const check = () => coordinator.check();
    document.addEventListener("pointerdown", activity);
    document.addEventListener("keydown", activity);
    document.addEventListener("input", activity);
    document.addEventListener("touchstart", activity, { passive: true });
    window.addEventListener("scroll", activity, { passive: true });
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);

    return () => {
      document.removeEventListener("pointerdown", activity);
      document.removeEventListener("keydown", activity);
      document.removeEventListener("input", activity);
      document.removeEventListener("touchstart", activity);
      window.removeEventListener("scroll", activity);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      coordinator.stop();
    };
  }, [navigate, sessionKey]);

  return <>{children}</>;
}
