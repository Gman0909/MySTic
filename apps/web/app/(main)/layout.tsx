"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth";

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!user) return null;
  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="user-avatar">{user.name.charAt(0).toUpperCase()}</span>
        {user.name}
        <span className="muted">▾</span>
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <Link href="/account" onClick={() => setOpen(false)}>
            Account settings
          </Link>
          {user.isAdmin && (
            <Link href="/admin" onClick={() => setOpen(false)}>
              Admin panel
            </Link>
          )}
          <button
            className="linklike"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
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
          <Link href="/sites">Sites</Link>
        </nav>
        <div className="topbar-auth">
          {ready &&
            (user ? (
              <UserMenu />
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
