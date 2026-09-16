import type { Request, Response } from "express";
import Stripe from "stripe";
import {
  appointmentResponse,
  execute,
  getAppointment,
  type DbAppointment,
} from "./mysql";
import { sendAppointmentNotifications } from "./email";
import { logger } from "./logger";

const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
const appUrl = process.env.APP_URL?.replace(/\/+$/, "");
const stripe = secretKey ? new Stripe(secretKey) : null;

if ((secretKey || webhookSecret) && !(secretKey && webhookSecret && appUrl)) {
  throw new Error(
    "STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and APP_URL must all be set to enable payments",
  );
}

export const paymentsConfigured = Boolean(stripe && webhookSecret && appUrl);

function requireStripe() {
  if (!stripe || !appUrl) {
    throw new Error("Stripe payments are not configured");
  }
  return stripe;
}

export async function createCheckout(appointment: DbAppointment) {
  const client = requireStripe();
  if (!appointment.amount_cents || appointment.amount_cents < 1) {
    throw new Error("Appointment does not have a valid payment amount");
  }
  if (appointment.stripe_checkout_session_id) {
    const existing = await client.checkout.sessions.retrieve(
      appointment.stripe_checkout_session_id,
    );
    if (existing.url && existing.status === "open") return existing.url;
  }
  const session = await client.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: appointment.client_email,
      client_reference_id: String(appointment.id),
      metadata: { appointmentId: String(appointment.id) },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: appointment.currency.toLowerCase(),
            unit_amount: Number(appointment.amount_cents),
            product_data: { name: "Virtual appointment" },
          },
        },
      ],
      success_url: `${appUrl}/client/appointments?payment=success`,
      cancel_url: `${appUrl}/client/appointments?payment=cancelled`,
      expires_at: Math.floor(
        new Date(appointment.payment_expires_at!).getTime() / 1000,
      ),
    },
    { idempotencyKey: `porter-appointment-${appointment.id}` },
  );
  await execute(
    "UPDATE appointments SET stripe_checkout_session_id = ? WHERE id = ?",
    [session.id, appointment.id],
  );
  if (!session.url) throw new Error("Stripe did not return a Checkout URL");
  return session.url;
}

export async function expireAppointmentCheckout(appointment: DbAppointment) {
  if (!appointment.stripe_checkout_session_id) return true;
  const client = requireStripe();
  const session = await client.checkout.sessions.retrieve(
    appointment.stripe_checkout_session_id,
  );
  if (session.status === "expired") return true;
  if (session.status === "complete") return false;
  await client.checkout.sessions.expire(session.id);
  return true;
}

async function completeCheckout(session: Stripe.Checkout.Session) {
  const appointmentId = Number(
    session.metadata?.appointmentId ?? session.client_reference_id,
  );
  if (!Number.isInteger(appointmentId)) return;
  const appointment = await getAppointment(appointmentId);
  if (!appointment || appointment.payment_status === "paid") return;
  if (
    session.payment_status !== "paid" ||
    session.amount_total !== Number(appointment.amount_cents) ||
    session.currency?.toUpperCase() !== appointment.currency.toUpperCase()
  ) {
    throw new Error("Stripe Checkout payment details do not match appointment");
  }
  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  await execute(
    `UPDATE appointments
     SET status = 'confirmed', payment_status = 'paid',
       stripe_payment_intent_id = ?, payment_expires_at = NULL
     WHERE id = ? AND status = 'pending_payment'`,
    [paymentIntent ?? null, appointmentId],
  );
  const confirmed = await getAppointment(appointmentId);
  if (confirmed?.payment_status === "paid") {
    await sendAppointmentNotifications(confirmed, "booked");
  }
}

async function expireCheckout(session: Stripe.Checkout.Session) {
  const appointmentId = Number(
    session.metadata?.appointmentId ?? session.client_reference_id,
  );
  if (!Number.isInteger(appointmentId)) return;
  await execute(
    `UPDATE appointments
     SET status = 'cancelled', payment_status = 'failed'
     WHERE id = ? AND status = 'pending_payment'`,
    [appointmentId],
  );
}

export async function stripeWebhook(request: Request, response: Response) {
  if (!stripe || !webhookSecret) {
    response.status(503).json({ error: "Stripe webhook is not configured" });
    return;
  }
  const signature = request.headers["stripe-signature"];
  if (!signature) {
    response.status(400).json({ error: "Missing Stripe signature" });
    return;
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      request.body,
      signature,
      webhookSecret,
    );
  } catch {
    response.status(400).json({ error: "Invalid Stripe signature" });
    return;
  }
  try {
    if (event.type === "checkout.session.completed") {
      await completeCheckout(event.data.object);
    } else if (event.type === "checkout.session.expired") {
      await expireCheckout(event.data.object);
    }
    response.json({ received: true });
  } catch (error) {
    logger.error({ error, eventId: event.id }, "Stripe webhook failed");
    response.status(500).json({ error: "Webhook processing failed" });
  }
}

export async function refundAppointment(appointment: DbAppointment) {
  const client = requireStripe();
  if (
    appointment.payment_status !== "paid" ||
    !appointment.stripe_payment_intent_id
  ) {
    throw new Error("Appointment does not have a refundable payment");
  }
  const wasCancelled = appointment.status === "cancelled";
  await client.refunds.create(
    { payment_intent: appointment.stripe_payment_intent_id },
    { idempotencyKey: `porter-refund-${appointment.id}` },
  );
  await execute(
    `UPDATE appointments
     SET payment_status = 'refunded', status = 'cancelled'
     WHERE id = ?`,
    [appointment.id],
  );
  const refunded = (await getAppointment(appointment.id))!;
  if (!wasCancelled) {
    await sendAppointmentNotifications(refunded, "cancelled");
  }
  return appointmentResponse(refunded);
}
