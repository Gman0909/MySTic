"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

interface PublicProfile {
  name: string;
  handle: string;
  collections: { slug: string; name: string; description: string | null; updatedAt: string }[];
}

export default function PublicProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PublicProfile>(`/api/users/${handle}`)
      .then(setProfile)
      .catch((e) => setError((e as Error).message));
  }, [handle]);

  if (error) return <p className="error-text">{error}</p>;
  if (!profile) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>{profile.name}</h1>
      <p className="muted">
        @{profile.handle} — public collections curated with MySTic
      </p>
      <div className="profile-collections">
        {profile.collections.map((c) => (
          <a className="profile-card" key={c.slug} href={`/c/${c.slug}`}>
            <strong>{c.name}</strong>
            {c.description && <p>{c.description}</p>}
            <span className="muted">Updated {new Date(c.updatedAt).toLocaleDateString()}</span>
          </a>
        ))}
        {profile.collections.length === 0 && <p className="muted">No public collections yet.</p>}
      </div>
    </div>
  );
}
