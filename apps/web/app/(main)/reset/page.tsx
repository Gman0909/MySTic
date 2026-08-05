"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

export default function ResetPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ResetInner />
    </Suspense>
  );
}

function ResetInner() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!token) return <p className="error-text">This reset link is missing its token — request a new one.</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords don't match");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, newPassword: password }) });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card">
      <h1>Choose a new password</h1>
      {done ? (
        <p>
          Password updated — <Link href="/login">sign in</Link> with it now.
        </p>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <input
            type="password"
            required
            minLength={8}
            placeholder="New password (min 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            type="password"
            required
            placeholder="Repeat new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error && <p className="error-text">{error}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "…" : "Set password"}
          </button>
        </form>
      )}
    </div>
  );
}
