"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { RecoveryCodeCard } from "@/components/RecoveryCode";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; recoveryCode: string }>("/api/auth/recover", {
        method: "POST",
        body: JSON.stringify({ email, recoveryCode: code, newPassword: password }),
      });
      setNewCode(res.recoveryCode);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (newCode) {
    return (
      <div className="auth-card">
        <h1>Password reset</h1>
        <p>
          Your password has been updated and all sessions signed out. Your old recovery code is now spent — here is
          your <strong>new</strong> one:
        </p>
        <RecoveryCodeCard code={newCode} />
        <p>
          <Link href="/login">Sign in with your new password →</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h1>Recover your account</h1>
      <p className="muted">
        Enter your email, the recovery code you saved when you created your account (dashes optional), and a new
        password. Lost the code too? An administrator can issue you a new one.
      </p>
      <form onSubmit={submit} className="auth-form">
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          required
          placeholder="Recovery code (XXXX-XXXX-…)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="New password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "…" : "Reset password"}
        </button>
      </form>
      <p className="muted">
        <Link href="/login">← Back to sign in</Link>
      </p>
    </div>
  );
}
