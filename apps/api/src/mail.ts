import nodemailer from "nodemailer";
import { getSettings } from "./settings.js";
import type { Db } from "./db/index.js";

/**
 * Send an email via the admin-configured SMTP server. Returns false (and logs)
 * when SMTP isn't configured — callers fall back to non-email flows.
 */
export async function sendMail(db: Db, to: string, subject: string, text: string): Promise<boolean> {
  const s = await getSettings(db);
  if (!s.smtpHost) {
    console.log(`[mail] SMTP not configured — would have sent to ${to}: ${subject}`);
    return false;
  }
  const transport = nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpPort === 465,
    auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPass ?? "" } : undefined,
  });
  await transport.sendMail({
    from: s.smtpFrom ?? `MySTic <no-reply@${new URL(s.publicUrl ?? "http://localhost").hostname}>`,
    to,
    subject,
    text,
  });
  return true;
}
