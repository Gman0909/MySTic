"use client";

import { useState } from "react";

/**
 * One-time display of a recovery code with a copy button. The code is never
 * retrievable again — only its hash is stored server-side.
 */
export function RecoveryCodeCard(props: { code: string; onDone?: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the code is selectable below
    }
  };

  return (
    <div className="recovery-card">
      <h3>Your recovery code</h3>
      <p className="muted">
        This is the <strong>only</strong> way to regain access if you forget your password. Save it somewhere safe —
        it's shown <strong>once</strong> and never again.
      </p>
      <div className="recovery-code-row">
        <code className="recovery-code">{props.code}</code>
        <button onClick={copy}>{copied ? "✓ Copied" : "Copy"}</button>
      </div>
      {props.onDone && (
        <button className="primary" onClick={props.onDone}>
          {props.doneLabel ?? "I've saved my recovery code"}
        </button>
      )}
    </div>
  );
}
