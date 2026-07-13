"use client";

import { useEffect, useState } from "react";

import { apiClient } from "@/lib/hc";

export function ApiHealth() {
  const [status, setStatus] = useState("接続確認中");
  const [online, setOnline] = useState(false);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await apiClient.api.health.$get();
        if (!response.ok) throw new Error("API health check failed");

        const health = await response.json();
        setStatus(health.status === "ok" ? "API 接続済み" : "API 応答エラー");
        setOnline(health.status === "ok");
      } catch {
        setStatus("API 未接続");
      }
    };

    void checkHealth();
  }, []);

  return (
    <div className="health" aria-live="polite">
      <span className={online ? "dot dotOnline" : "dot"} aria-hidden="true" />
      {status}
    </div>
  );
}
