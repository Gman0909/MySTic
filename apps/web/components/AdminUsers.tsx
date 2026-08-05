"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth";
import { api } from "@/lib/api";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  handle: string | null;
  profilePublic: boolean;
  createdAt: string;
  collectionCount: number;
}

export function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api<AdminUser[]>("/api/admin/users").then(setUsers).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

  const setAdmin = async (u: AdminUser, isAdmin: boolean) => {
    if (isAdmin && !confirm(`Grant admin rights to ${u.email}? Admins can manage sites, users, and settings.`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ isAdmin }) });
      refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const remove = async (u: AdminUser) => {
    if (!confirm(`Delete ${u.email}? Their ${u.collectionCount} collection(s) transfer to you.`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const newRecoveryCode = async (u: AdminUser) => {
    if (!confirm(`Issue a new recovery code for ${u.email}? Their previous code stops working immediately.`)) return;
    try {
      const res = await api<{ recoveryCode: string }>(`/api/admin/users/${u.id}/recovery-code`, { method: "POST" });
      // prompt() so the admin can copy the code to hand to the user out-of-band.
      prompt(
        `New recovery code for ${u.email} — copy and send it to them (they use it at /recover; shown only once):`,
        res.recoveryCode,
      );
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <section className="admin-section">
      <h2>Users</h2>
      {error && <p className="error-text">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Profile</th>
            <th>Collections</th>
            <th>Joined</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                <strong>{u.name}</strong>
                <div className="muted" style={{ fontSize: "0.82rem" }}>{u.email}</div>
              </td>
              <td>{u.isAdmin ? <span className="badge">admin</span> : <span className="badge plain">member</span>}</td>
              <td className="muted">{u.profilePublic && u.handle ? `/u/${u.handle}` : "—"}</td>
              <td>{u.collectionCount}</td>
              <td className="muted">{new Date(u.createdAt).toLocaleDateString()}</td>
              <td>
                <div className="row-actions">
                  <button onClick={() => newRecoveryCode(u)} title="Issue a new recovery code to hand to this user">
                    Recovery code
                  </button>
                  {u.id !== me?.id && (
                    <>
                      <button onClick={() => setAdmin(u, !u.isAdmin)}>
                        {u.isAdmin ? "Revoke admin" : "Make admin"}
                      </button>
                      <button onClick={() => remove(u)}>Delete</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
