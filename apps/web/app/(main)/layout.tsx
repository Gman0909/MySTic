"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          MyST<span>ic</span>
        </Link>
        <nav>
          <Link href="/search">Search</Link>
          <Link href="/tree">Knowledge tree</Link>
          <Link href="/collections">Collections</Link>
          <Link href="/admin">Admin</Link>
        </nav>
        <div className="topbar-auth">
          {ready &&
            (user ? (
              <>
                <Link href="/account" className="muted">
                  {user.name}
                  {user.isAdmin ? " (admin)" : ""}
                </Link>
                <button onClick={() => logout()}>Sign out</button>
              </>
            ) : (
              <Link href="/login">
                <button className="primary">Sign in</button>
              </Link>
            ))}
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
