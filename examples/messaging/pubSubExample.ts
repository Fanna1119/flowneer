// ---------------------------------------------------------------------------
// Pub/Sub pattern with Flowneer — withChannels
// ---------------------------------------------------------------------------
//
// Architecture:
//
//   Publisher          Broker (fan-out)          Subscribers
//   ─────────          ────────────────          ───────────
//   createUser  ──▶   "user.created"   ──▶   "email.queue"  → emailService
//                                       ──▶   "audit.queue"  → auditLog
//                                       ──▶   "notify.queue" → pushNotify
//
// Key properties:
//   - No step has a direct reference to any other step
//   - Adding a new subscriber = add a queue in the broker + a new step
//   - The broker is the only thing that changes when topology changes
//   - In a multi-process setup, replace the broker step with Redis/NATS/Kafka
//
// Run with: bun run examples/messaging/pubSubExample.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import { withChannels, sendTo, receiveFrom } from "../../plugins/messaging";

// ─── Shared state ────────────────────────────────────────────────────────────

interface AppState {
  userId?: string;
  email?: string;
  results: string[];
}

type UserCreatedEvent = { userId: string; email: string };

// ─── Publisher ───────────────────────────────────────────────────────────────
// Knows nothing about subscribers. Emits to one topic.

async function createUser(shared: AppState) {
  shared.userId = "user_123";
  shared.email = "alice@example.com";

  sendTo<AppState>(shared, "user.created", {
    userId: shared.userId,
    email: shared.email,
  } satisfies UserCreatedEvent);

  console.log("[Publisher]  user.created emitted");
}

// ─── Broker ──────────────────────────────────────────────────────────────────
// Reads one topic; fans out to each subscriber's private queue.
// In a real multi-process system this is an external daemon (Redis/NATS/Kafka).
// To add a new subscriber: add one line here + one step below.

async function broker(shared: AppState) {
  const events = receiveFrom<UserCreatedEvent>(shared, "user.created");

  for (const event of events) {
    sendTo(shared, "email.queue", event);
    sendTo(shared, "audit.queue", event);
    sendTo(shared, "notify.queue", event);
  }
}

// ─── Subscribers ─────────────────────────────────────────────────────────────
// Each subscriber drains its own private queue.
// They run concurrently via .parallel() and are completely unaware of each other.

async function emailService(shared: AppState) {
  for (const e of receiveFrom<UserCreatedEvent>(shared, "email.queue")) {
    const msg = `[EmailService]  welcome email → ${e.email}`;
    shared.results.push(msg);
    console.log(msg);
  }
}

async function auditLog(shared: AppState) {
  for (const e of receiveFrom<UserCreatedEvent>(shared, "audit.queue")) {
    const msg = `[AuditLog]      user created:  ${e.userId}`;
    shared.results.push(msg);
    console.log(msg);
  }
}

async function pushNotify(shared: AppState) {
  for (const e of receiveFrom<UserCreatedEvent>(shared, "notify.queue")) {
    const msg = `[PushNotify]    welcome push → ${e.userId}`;
    shared.results.push(msg);
    console.log(msg);
  }
}

// ─── Flow ────────────────────────────────────────────────────────────────────

const PubSubFlow = FlowBuilder.extend([withChannels]);

const flow = new PubSubFlow<AppState>()
  .withChannels() // initialise shared.__channels Map
  .startWith(createUser) // 1. publish
  .then(broker) // 2. fan-out to subscriber queues
  .parallel([
    // 3. all subscribers run concurrently, independently
    emailService,
    auditLog,
    pushNotify,
  ]);

// ─── Run ─────────────────────────────────────────────────────────────────────

const shared: AppState = { results: [] };
await flow.run(shared);

console.log(
  "\nAll subscribers received the event:",
  shared.results.length === 3,
);

// ─── Multi-process note ──────────────────────────────────────────────────────
//
// The above is in-process. For separate processes, replace the broker step:
//
//   async function broker(shared: AppState) {
//     const events = receiveFrom<UserCreatedEvent>(shared, "user.created");
//     const redis = getRedisClient();
//     for (const event of events) {
//       await redis.publish("user.created", JSON.stringify(event));
//     }
//   }
//
// Each subscriber process then has its own Flowneer flow that reads from Redis:
//
//   async function emailService(shared: AppState) {
//     const redis = getRedisClient();
//     redis.subscribe("user.created", (msg) => {
//       const event = JSON.parse(msg) as UserCreatedEvent;
//       sendTo(shared, "email.queue", event);
//     });
//   }
//
// The Flowneer flow topology and step signatures stay exactly the same.
// Only the transport layer underneath the broker changes.
