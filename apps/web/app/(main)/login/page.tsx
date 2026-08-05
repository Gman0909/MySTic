"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { api, API_URL, setToken } from "@/lib/api";

export default function LoginPage() {
  const { user, login, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<{ githubOauth: boolean; allowRegistration: boolean } | null>(null);

  // OAuth hand-off: the API callback redirects here with #token=… or #oauth_error=…
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const token = hash.get("token");
    const oauthError = hash.get("oauth_error");
    if (token) {
      setToken(token);
      window.location.replace("/collections");
      return;
    }
    if (oauthError) {
      setError(oauthError);
      window.history.replaceState(null, "", window.location.pathname);
    }
    api<{ githubOauth: boolean; allowRegistration: boolean }>("/api/config").then(setConfig).catch(() => {});
  }, []);

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
      {config?.githubOauth && (
        <>
          <a href={`${API_URL}/api/auth/oauth/github`} className="oauth-button">
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Continue with GitHub
          </a>
          <div className="auth-divider">
            <span>or</span>
          </div>
        </>
      )}
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
            <Link href="/forgot">Forgot password?</Link> · No account?{" "}
            <button className="linklike" onClick={() => setMode("register")}>Create one</button>
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
