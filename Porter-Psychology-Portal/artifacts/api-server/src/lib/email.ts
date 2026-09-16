import { Resend } from "resend";
import { logger } from "./logger";
import { ADMIN_TIMEZONE, type DbAppointment } from "./mysql";

const apiKey = process.env.RESEND_API_KEY?.trim();
const from = process.env.EMAIL_FROM?.trim();
const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
const practitionerEmail =
  process.env.PRACTITIONER_NOTIFICATION_EMAIL?.trim() ||
  process.env.ADMIN_EMAIL?.trim();
const resend = apiKey ? new Resend(apiKey) : null;

if ((apiKey || from) && !(apiKey && from && appUrl && practitionerEmail)) {
  throw new Error(
    "RESEND_API_KEY, EMAIL_FROM, APP_URL, and PRACTITIONER_NOTIFICATION_EMAIL (or ADMIN_EMAIL) must all be set to enable email",
  );
}

export const emailConfigured = Boolean(
  resend && from && appUrl && practitionerEmail,
);

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function send(to: string, subject: string, html: string) {
  if (!resend || !from || !appUrl) {
    logger.warn({ subject }, "Email delivery is not configured");
    return false;
  }
  try {
    const result = await resend.emails.send({ from, to, subject, html });
    if (result.error) {
      logger.error(
        { code: result.error.name, subject },
        "Email provider rejected message",
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.error({ error, subject }, "Email delivery failed");
    return false;
  }
}

function actionEmail(
  heading: string,
  copy: string,
  actionLabel: string,
  actionUrl: string,
) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#263b39">
    <h1 style="font-family:Georgia,serif">${escapeHtml(heading)}</h1>
    <p style="line-height:1.6">${escapeHtml(copy)}</p>
    <p style="margin:28px 0"><a href="${escapeHtml(actionUrl)}" style="background:#315c58;color:white;padding:12px 20px;border-radius:999px;text-decoration:none">${escapeHtml(actionLabel)}</a></p>
    <p style="font-size:12px;color:#667571">If you did not request this, you can ignore this email.</p>
  </div>`;
}

export function sendVerificationEmail(email: string, token: string) {
  const url = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return send(
    email,
    "Verify your Porter Psychology email",
    actionEmail(
      "Verify your email",
      "Confirm your email address before booking an appointment.",
      "Verify email",
      url,
    ),
  );
}

export function sendAccountVerifiedEmail(email: string) {
  return send(
    email,
    "Your Porter Psychology account is ready",
    actionEmail(
      "Your account is verified",
      "Your email has been confirmed. You can now sign in and book an appointment.",
      "Open client portal",
      `${appUrl}/client`,
    ),
  );
}

export function sendPasswordResetEmail(email: string, token: string) {
  const url = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return send(
    email,
    "Reset your Porter Psychology password",
    actionEmail(
      "Reset your password",
      "Use this secure link to choose a new password. It expires in one hour.",
      "Reset password",
      url,
    ),
  );
}

export function sendEmailChangeVerification(email: string, token: string) {
  const url = `${appUrl}/verify-email-change?token=${encodeURIComponent(token)}`;
  return send(
    email,
    "Confirm your new Porter Psychology email",
    actionEmail(
      "Confirm your new email",
      "Confirm this address to finish changing the email on your account.",
      "Confirm email change",
      url,
    ),
  );
}

export function sendPasswordChangedEmail(email: string) {
  return send(
    email,
    "Your Porter Psychology password was changed",
    actionEmail(
      "Password changed",
      "Your password was changed successfully. Contact the practice promptly if this was not you.",
      "Sign in",
      `${appUrl}/login`,
    ),
  );
}

export function sendEmailChangedNotice(email: string) {
  return send(
    email,
    "Your Porter Psychology email was changed",
    actionEmail(
      "Email changed",
      "The email address on your account was changed. Contact the practice promptly if this was not you.",
      "Visit Porter Psychology",
      appUrl ?? "",
    ),
  );
}

function appointmentWhen(appointment: DbAppointment) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ADMIN_TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(appointment.start_time));
}

function appointmentEmail(heading: string, copy: string) {
  return actionEmail(
    heading,
    copy,
    "View appointment",
    `${appUrl}/client/appointments`,
  );
}

export async function sendAppointmentNotifications(
  appointment: DbAppointment,
  kind: "booked" | "rescheduled" | "cancelled",
) {
  const when = appointmentWhen(appointment);
  const clientCopy = {
    booked: `Your appointment for ${when} is confirmed.`,
    rescheduled: `Your appointment has been rescheduled to ${when}.`,
    cancelled: `Your appointment for ${when} has been cancelled.`,
  }[kind];
  const practitionerCopy = {
    booked: `A client appointment for ${when} was confirmed.`,
    rescheduled: `A client appointment was rescheduled to ${when}.`,
    cancelled: `A client appointment for ${when} was cancelled.`,
  }[kind];
  await Promise.all([
    send(
      appointment.client_email,
      `Appointment ${kind} — Porter Psychology`,
      appointmentEmail(`Appointment ${kind}`, clientCopy),
    ),
    practitionerEmail
      ? send(
          practitionerEmail,
          `Client appointment ${kind}`,
          actionEmail(
            `Appointment ${kind}`,
            practitionerCopy,
            "Open practitioner portal",
            `${appUrl}/admin/calendar`,
          ),
        )
      : Promise.resolve(false),
  ]);
}

export function sendAppointmentReminder(appointment: DbAppointment) {
  return send(
    appointment.client_email,
    "Appointment reminder — Porter Psychology",
    appointmentEmail(
      "Appointment reminder",
      `You have an appointment scheduled for ${appointmentWhen(appointment)}. Sign in shortly beforehand to access the secure session waiting room.`,
    ),
  );
}

export function sendPaymentRequiredEmail(appointment: DbAppointment) {
  return send(
    appointment.client_email,
    "Payment required to confirm your appointment",
    actionEmail(
      "Complete your appointment payment",
      `A time has been reserved for ${appointmentWhen(appointment)}. Sign in and complete payment before the reservation expires.`,
      "Complete payment",
      `${appUrl}/client/appointments`,
    ),
  );
}
