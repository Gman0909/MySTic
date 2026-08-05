"use client";

import Link from "next/link";
import { AdminSettings } from "@/components/AdminSettings";
import { AdminUsers } from "@/components/AdminUsers";
import { useAuth } from "@/components/auth";

export default function AdminPanelPage() {
  const { user, ready } = useAuth();
  if (!ready) return <p className="muted">Loading…</p>;
  if (!user?.isAdmin)
    return (
      <p className="muted">
        The admin panel requires an administrator account.{" "}
        {!user && <Link href="/login">Sign in</Link>}
      </p>
    );
  return (
    <div>
      <h1>Admin panel</h1>
      <p className="muted">
        Manage people and instance-wide settings. Indexed sites are managed on the <Link href="/sites">Sites</Link>{" "}
        page.
      </p>
      <AdminUsers />
      <AdminSettings />
    </div>
  );
}
