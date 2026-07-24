import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultEventsFile = process.env.WEBHOOK_EVENTS_FILE
  ? path.resolve(process.env.WEBHOOK_EVENTS_FILE)
  : path.join(currentDirectory, "data", "webhook-events.json");
const PROCESSING_TIMEOUT_MS = 60 * 1000;

export const createWebhookStore = ({
  eventsFile = defaultEventsFile,
} = {}) => {
  let mutationQueue = Promise.resolve();

  const readEvents = async () => {
    try {
      const value = JSON.parse(await fs.readFile(eventsFile, "utf8"));
      if (!Array.isArray(value)) {
        throw new Error("The webhook store must contain a JSON array.");
      }
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  };

  const writeEvents = async (events) => {
    await fs.mkdir(path.dirname(eventsFile), {
      recursive: true,
      mode: 0o700,
    });
    const temporaryFile = `${eventsFile}.${process.pid}.${crypto
      .randomBytes(5)
      .toString("hex")}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(events, null, 2), {
      mode: 0o600,
    });
    await fs.rename(temporaryFile, eventsFile);
  };

  const mutateEvents = (task) => {
    const mutation = mutationQueue
      .catch(() => undefined)
      .then(async () => {
        const events = await readEvents();
        const result = await task(events);
        await writeEvents(events);
        return result;
      });
    mutationQueue = mutation;
    return mutation;
  };

  const beginWebhookEvent = ({ eventId, eventType, receivedAt }) =>
    mutateEvents((events) => {
      const now = receivedAt || new Date().toISOString();
      const index = events.findIndex((event) => event.eventId === eventId);
      if (index >= 0) {
        const existing = events[index];
        if (existing.status === "processed") {
          return { state: "processed", event: existing };
        }
        const stillProcessing =
          existing.status === "processing" &&
          Date.now() - new Date(existing.updatedAt).getTime() <
            PROCESSING_TIMEOUT_MS;
        if (stillProcessing) {
          return { state: "processing", event: existing };
        }
        events[index] = {
          ...existing,
          eventType,
          status: "processing",
          attempts: Number(existing.attempts || 0) + 1,
          updatedAt: now,
        };
        return { state: "retry", event: events[index] };
      }

      const event = {
        eventId,
        eventType,
        status: "processing",
        attempts: 1,
        receivedAt: now,
        updatedAt: now,
      };
      events.push(event);
      return { state: "new", event };
    });

  const completeWebhookEvent = (eventId, result = {}) =>
    mutateEvents((events) => {
      const index = events.findIndex((event) => event.eventId === eventId);
      if (index === -1) throw new Error("Webhook event record not found.");
      const processedAt = new Date().toISOString();
      events[index] = {
        ...events[index],
        ...result,
        status: "processed",
        processedAt,
        updatedAt: processedAt,
      };
      return events[index];
    });

  const failWebhookEvent = (eventId, error) =>
    mutateEvents((events) => {
      const index = events.findIndex((event) => event.eventId === eventId);
      if (index === -1) throw new Error("Webhook event record not found.");
      const failedAt = new Date().toISOString();
      events[index] = {
        ...events[index],
        status: "failed",
        errorCode: error.code || "PROCESSING_FAILED",
        failedAt,
        updatedAt: failedAt,
      };
      return events[index];
    });

  return {
    beginWebhookEvent,
    completeWebhookEvent,
    failWebhookEvent,
  };
};

const defaultStore = createWebhookStore();

export const beginWebhookEvent = defaultStore.beginWebhookEvent;
export const completeWebhookEvent = defaultStore.completeWebhookEvent;
export const failWebhookEvent = defaultStore.failWebhookEvent;
