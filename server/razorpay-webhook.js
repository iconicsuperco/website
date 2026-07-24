import {
  confirmCapturedPayment,
  recordFailedPayment,
  recordRefundEvent,
} from "./commerce-service.js";
import { HttpError, asHttpError } from "./http-error.js";
import { findOrderByRazorpayOrderId } from "./order-store.js";
import { verifyWebhookSignature } from "./razorpay.js";
import {
  beginWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "./webhook-store.js";

const supportedEvents = new Set([
  "order.paid",
  "payment.captured",
  "payment.failed",
  "payment.authorized",
  "refund.created",
  "refund.processed",
  "refund.failed",
]);

const paymentFromPayload = (payload) => payload?.payload?.payment?.entity;
const refundFromPayload = (payload) => payload?.payload?.refund?.entity;

const processWebhookPayload = async (payload, eventId) => {
  const eventType = String(payload.event || "");
  if (!supportedEvents.has(eventType)) {
    return { outcome: "ignored", eventType };
  }

  if (["order.paid", "payment.captured"].includes(eventType)) {
    const payment = paymentFromPayload(payload);
    if (!payment?.order_id) {
      throw new HttpError(
        400,
        "INVALID_WEBHOOK_PAYLOAD",
        "The payment webhook payload is incomplete.",
      );
    }
    const order = await findOrderByRazorpayOrderId(payment.order_id);
    if (!order) {
      throw new HttpError(
        503,
        "ORDER_NOT_READY",
        "The matching order is not available yet.",
      );
    }
    await confirmCapturedPayment({
      orderId: order.orderId,
      payment,
      source: "razorpay_webhook",
      eventId,
    });
    return { outcome: "payment_confirmed", eventType, orderId: order.orderId };
  }

  if (eventType === "payment.failed") {
    const payment = paymentFromPayload(payload);
    const order = await recordFailedPayment({
      razorpayOrderId: payment?.order_id,
      payment,
      eventId,
    });
    return {
      outcome: order ? "payment_failure_recorded" : "unmatched",
      eventType,
      orderId: order?.orderId,
    };
  }

  if (eventType.startsWith("refund.")) {
    const refund = refundFromPayload(payload);
    const order = await recordRefundEvent({
      eventType,
      refund,
      eventId,
    });
    if (!order) {
      throw new HttpError(
        503,
        "ORDER_NOT_READY",
        "The matching order is not available yet.",
      );
    }
    return {
      outcome: "refund_recorded",
      eventType,
      orderId: order.orderId,
    };
  }

  return { outcome: "acknowledged", eventType };
};

export const razorpayWebhookHandler = async (request, response) => {
  const rawBody = request.body;
  const signature = request.get("x-razorpay-signature");
  const eventId = String(request.get("x-razorpay-event-id") || "").trim();

  try {
    if (!Buffer.isBuffer(rawBody)) {
      throw new HttpError(
        500,
        "RAW_WEBHOOK_BODY_REQUIRED",
        "Webhook verification is unavailable.",
      );
    }
    if (!eventId || eventId.length > 128) {
      throw new HttpError(
        400,
        "INVALID_WEBHOOK_EVENT_ID",
        "A valid webhook event ID is required.",
      );
    }
    if (!verifyWebhookSignature({ rawBody, signature })) {
      throw new HttpError(
        401,
        "INVALID_WEBHOOK_SIGNATURE",
        "Webhook signature verification failed.",
      );
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new HttpError(
        400,
        "INVALID_WEBHOOK_JSON",
        "The webhook payload is invalid.",
      );
    }

    const registration = await beginWebhookEvent({
      eventId,
      eventType: String(payload.event || "unknown"),
      receivedAt: new Date().toISOString(),
    });
    if (registration.state === "processed") {
      response.json({ received: true, duplicate: true });
      return;
    }
    if (registration.state === "processing") {
      response.status(202).json({ received: true, processing: true });
      return;
    }

    try {
      const result = await processWebhookPayload(payload, eventId);
      await completeWebhookEvent(eventId, result);
      response.json({ received: true });
    } catch (processingError) {
      await failWebhookEvent(eventId, processingError);
      const normalized = asHttpError(
        processingError,
        "Webhook processing failed.",
      );
      console.error("Razorpay webhook processing failed", {
        eventId,
        code: normalized.code,
      });
      if (normalized.status >= 500) {
        response.status(503).json({
          code: "WEBHOOK_RETRY_REQUIRED",
          message: "Webhook processing should be retried.",
        });
        return;
      }
      response.json({ received: true, requiresAttention: true });
    }
  } catch (error) {
    const normalized = asHttpError(error, "Webhook verification failed.");
    response.status(normalized.status).json({
      code: normalized.code,
      message: normalized.expose
        ? normalized.message
        : "Webhook verification failed.",
    });
  }
};
