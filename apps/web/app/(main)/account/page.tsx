"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth";
import { RecoveryCodeCard } from "@/components/RecoveryCode";
import { api } from "@/lib/api";

interface Profile {
  handle: string | null;
  profilePublic: boolean;
}

export default function AccountPage() {
  const { user, ready } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [handle, setHandle] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !user) return;
    api<Profile>("/api/auth/me").then((p) => {
      setProfile(p);
      setHandle(p.handle ?? "");
    });
  }, [ready, user]);

  if (ready && !user)
    return (
      <p className="muted">
        <Link href="/login">Sign in</Link> to manage your account.
      </p>
    );
  if (!profile) return <p className="muted">Loading…</p>;

  const save = async (patch: { handle?: string | null; profilePublic?: boolean }) => {
    setStatus("Saving…");
    setError(null);
    try {
      const next = await api<Profile>("/api/auth/profile", { method: "PATCH", body: JSON.stringify(patch) });
      setProfile(next);
      setHandle(next.handle ?? "");
      setStatus("Saved");
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setStatus(null);
      setError((e as Error).message);
    }
  };

  const profileUrl = profile.handle ? `${window.location.origin}/u/${profile.handle}` : null;

  return (
    <div className="auth-card" style={{ maxWidth: "32rem", margin: "2rem 0" }}>
      <h1>Account</h1>
      <p className="muted">
        {user!.name} · {user!.email}
        {user!.isAdmin ? " · administrator" : ""}
      </p>
      <h2>
        Public profile <span className="muted" style={{ fontSize: "0.8rem", fontWeight: 400 }}>{status}</span>
      </h2>
      <p className="muted">
        Turn this on to get a shareable page listing your <strong>public</strong> collections. Unlisted and private
        collections never appear there.
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="settings-grid">
        <label>
          <span>
            Handle
            <small>Your profile lives at /u/&lt;handle&gt;. Lowercase letters, digits, hyphens.</small>
          </span>
          <span className="settings-keyrow">
            <input
              placeholder="e.g. rich"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
            />
            <button disabled={handle === (profile.handle ?? "")} onClick={() => save({ handle: handle || null })}>
              Save
            </button>
          </span>
        </label>
        <label className="settings-toggle">
          <span>
            Profile enabled
            <small>Others can browse a read-only list of your public collections.</small>
          </span>
          <input
            type="checkbox"
            checked={profile.profilePublic}
            disabled={!profile.handle}
            onChange={(e) => save({ profilePublic: e.target.checked })}
          />
        </label>
      </div>
      {profile.profilePublic && profileUrl && (
        <p>
          Your profile: <a href={profileUrl}>{profileUrl}</a>
        </p>
      )}
      {!profile.handle && <p className="muted">Set a handle first, then enable the profile.</p>}
      <ChangePassword />
      <RecoverySection />
    </div>
  );
}

function RecoverySection() {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const regenerate = async () => {
    if (
      !confirm(
        "Generate a new recovery code? Your previous code (if any) stops working immediately, and the new one is shown only once.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await api<{ recoveryCode: string }>("/api/auth/recovery-code", { method: "POST" });
      setCode(res.recoveryCode);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Recovery code</h2>
      <p className="muted">
        Your recovery code lets you reset your password if you lose it (Sign in → "Lost password?"). It was shown once
        when you created your account. If you've lost it — or signed up with GitHub and never had one — generate a new
        one here.
      </p>
      {code ? (
        <RecoveryCodeCard code={code} onDone={() => setCode(null)} doneLabel="Done — I've saved it" />
      ) : (
        <button onClick={regenerate} disabled={busy}>
          {busy ? "…" : "Generate new recovery code"}
        </button>
      )}
    </>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current || undefined, newPassword: next }),
      });
      setMsg({ ok: true, text: "Password updated. Other sessions have been signed out." });
      setCurrent("");
      setNext("");
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Change password</h2>
      <form onSubmit={submit} className="auth-form">
        <input
          type="password"
          placeholder="Current password (leave empty if you signed up with GitHub)"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="New password (min 8 characters)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        {msg && <p className={msg.ok ? "muted" : "error-text"}>{msg.text}</p>}
        <button className="primary" disabled={busy || next.length < 8}>
          {busy ? "…" : "Update password"}
        </button>
      </form>
    </>
  );
}
