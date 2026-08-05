"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<null | { emailConfigured: boolean }>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; emailConfigured: boolean }>("/api/auth/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setDone(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card">
      <h1>Reset your password</h1>
      {done ? (
        <>
          <p>
            If an account exists for <strong>{email}</strong>, a reset link (valid for 1 hour) has been created.
          </p>
          {done.emailConfigured ? (
            <p className="muted">Check your inbox for the link.</p>
          ) : (
            <p className="muted">
              This instance doesn't send email — ask an administrator to generate a reset link for you (Admin panel →
              Users → Reset link).
            </p>
          )}
          <p>
            <Link href="/login">← Back to sign in</Link>
          </p>
        </>
      ) : (
        <>
          <p className="muted">Enter your account email and we'll create a reset link.</p>
          <form onSubmit={submit} className="auth-form">
            <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="primary" disabled={busy}>
              {busy ? "…" : "Create reset link"}
            </button>
          </form>
          <p className="muted">
            <Link href="/login">← Back to sign in</Link>
          </p>
        </>
      )}
    </div>
  );
}
