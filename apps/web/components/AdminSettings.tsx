"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Settings {
  recrawlHours: number;
  contentTtlMinutes: number;
  aiLabeling: boolean;
  allowRegistration: boolean;
  crawlConcurrency: number;
  hasAnthropicKey: boolean;
  anthropicKeySource: "settings" | "environment" | null;
  effectiveLabeling: "local" | "claude";
}

export function AdminSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Settings>("/api/admin/settings").then(setS).catch((e) => setError(e.message));
  }, []);

  const save = async (patch: Record<string, unknown>) => {
    setStatus("Saving…");
    setError(null);
    try {
      setS(await api<Settings>("/api/admin/settings", { method: "PUT", body: JSON.stringify(patch) }));
      setStatus("Saved");
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setStatus(null);
      setError((e as Error).message);
    }
  };

  if (!s) return null;

  return (
    <section className="admin-section">
      <h2>
        Instance settings <span className="muted" style={{ fontSize: "0.8rem", fontWeight: 400 }}>{status}</span>
      </h2>
      {error && <p className="error-text">{error}</p>}
      <div className="settings-grid">
        <label>
          <span>
            Recrawl every (hours)
            <small>How often the scheduler refreshes each site. Minimum 6 — be kind to upstream servers.</small>
          </span>
          <input
            type="number"
            min={6}
            max={720}
            defaultValue={s.recrawlHours}
            onBlur={(e) => Number(e.target.value) !== s.recrawlHours && save({ recrawlHours: Number(e.target.value) })}
          />
        </label>
        <label>
          <span>
            Live-content cache (minutes)
            <small>How long collection pages and previews cache upstream content. Minimum 1.</small>
          </span>
          <input
            type="number"
            min={1}
            max={1440}
            defaultValue={s.contentTtlMinutes}
            onBlur={(e) =>
              Number(e.target.value) !== s.contentTtlMinutes && save({ contentTtlMinutes: Number(e.target.value) })
            }
          />
        </label>
        <label>
          <span>
            Crawl concurrency
            <small>Pages fetched at once per site (1–8).</small>
          </span>
          <input
            type="number"
            min={1}
            max={8}
            defaultValue={s.crawlConcurrency}
            onBlur={(e) =>
              Number(e.target.value) !== s.crawlConcurrency && save({ crawlConcurrency: Number(e.target.value) })
            }
          />
        </label>
        <label className="settings-toggle">
          <span>
            Concept labeling{" "}
            <span className="badge" style={{ fontWeight: 600 }}>
              {s.effectiveLabeling === "claude" ? "Claude" : "Local AI"}
            </span>
            <small>
              Local AI (TF-IDF labels, no external calls) is the default and the only mode without an API key. With a
              key, this toggle switches knowledge-tree labels to Claude-written ones.
              {s.hasAnthropicKey ? ` Key source: ${s.anthropicKeySource}.` : ""}
            </small>
          </span>
          <input
            type="checkbox"
            checked={s.aiLabeling && s.hasAnthropicKey}
            disabled={!s.hasAnthropicKey}
            title={s.hasAnthropicKey ? "" : "Add an Anthropic API key below to enable Claude labeling"}
            onChange={(e) => save({ aiLabeling: e.target.checked })}
          />
        </label>
        <label className="settings-toggle">
          <span>
            Open registration
            <small>Allow new people to create accounts on this instance.</small>
          </span>
          <input
            type="checkbox"
            checked={s.allowRegistration}
            onChange={(e) => save({ allowRegistration: e.target.checked })}
          />
        </label>
        <label>
          <span>
            Anthropic API key
            <small>
              Stored server-side, never shown again.{" "}
              {s.hasAnthropicKey ? "A key is configured — enter a new one to replace it." : "Paste a key to enable AI labeling."}
            </small>
          </span>
          <span className="settings-keyrow">
            <input
              type="password"
              placeholder="sk-ant-…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button
              disabled={!keyInput.trim()}
              onClick={() => {
                save({ anthropicApiKey: keyInput.trim() });
                setKeyInput("");
              }}
            >
              Save key
            </button>
            {s.anthropicKeySource === "settings" && (
              <button onClick={() => save({ anthropicApiKey: null })}>Clear</button>
            )}
          </span>
        </label>
      </div>
    </section>
  );
}
