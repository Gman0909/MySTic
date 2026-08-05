"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    router.replace("/collections");
    return <p className="muted">Signed in — redirecting…</p>;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, name || email.split("@")[0]!);
      router.push("/collections");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card">
      <h1>{mode === "login" ? "Sign in" : "Create an account"}</h1>
      <p className="muted">
        {mode === "login" ? "Welcome back." : "The first account on a MySTic instance becomes its administrator."}
      </p>
      <form onSubmit={submit} className="auth-form">
        {mode === "register" && (
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="muted">
        {mode === "login" ? (
          <>
            No account? <button className="linklike" onClick={() => setMode("register")}>Create one</button>
          </>
        ) : (
          <>
            Already registered? <button className="linklike" onClick={() => setMode("login")}>Sign in</button>
          </>
        )}
      </p>
    </div>
  );
}
