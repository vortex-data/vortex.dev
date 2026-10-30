import { type NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

// `{"email": "..."}` fits easily; anything larger is not from the form.
const MAX_BODY_BYTES = 1024;

// Requests per client IP per window. The counts live in this instance's
// memory, so they are not a global limit, but Fluid Compute reuses instances,
// so they blunt one client hammering the endpoint. A person subscribes once.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;
// At most this many IPs are tracked, so a burst of distinct IPs can't grow the
// map, or the time spent cleaning it, without bound.
const MAX_TRACKED_IPS = 10_000;
// Every window has the same length and a new or renewed window is added at
// the end, so the Map's insertion order is also oldest-window first.
const hits = new Map<string, { count: number; resetAt: number }>();

// Browsers send Origin on every POST, and Referer when a privacy setting
// strips Origin. Requiring one of them to match this endpoint's full origin
// (scheme, host and port) rejects cross-site posts, and posts from an http://
// page on the same host. It can't stop a non-browser client, which the rate
// limit covers.
function isSameOrigin(request: NextRequest): boolean {
  const source =
    request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) return false;
  try {
    return new URL(source).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

// Vercel sets x-real-ip and x-forwarded-for itself, so a client can't spoof
// them there.
function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

// Returns the seconds until the window resets when the client is over the
// limit, or 0 when the request may go ahead.
function rateLimited(ip: string, now: number): number {
  const entry = hits.get(ip);
  if (entry && entry.resetAt > now) {
    entry.count += 1;
    return entry.count > RATE_LIMIT
      ? Math.ceil((entry.resetAt - now) / 1000)
      : 0;
  }
  // A new window. Delete first so it is re-added at the end.
  if (entry) hits.delete(ip);
  if (hits.size >= MAX_TRACKED_IPS) {
    // Drop the expired windows at the front and, if a burst of distinct IPs
    // still fills the map, the oldest tenth. Each cleanup then frees room for
    // a thousand new IPs, so its cost is not paid on every request.
    let toDrop = hits.size - Math.floor(MAX_TRACKED_IPS * 0.9);
    for (const [key, oldest] of hits) {
      if (oldest.resetAt > now && toDrop <= 0) break;
      hits.delete(key);
      toDrop -= 1;
    }
  }
  hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
  return 0;
}

// Reads the body as text, or returns null as soon as it passes `limit` bytes,
// so an oversized body without a Content-Length is never held in memory.
async function readBodyWithin(
  request: NextRequest,
  limit: number
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const retryAfter = rateLimited(clientIp(request), Date.now());
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    const declaredLength = Number(request.headers.get("content-length"));
    if (declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }
    const raw = await readBodyWithin(request, MAX_BODY_BYTES);
    if (raw === null) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY is not configured");
      return NextResponse.json(
        { error: "Subscription service is not configured" },
        { status: 503 }
      );
    }
    const resend = new Resend(apiKey);

    let email: unknown;
    try {
      ({ email } = JSON.parse(raw));
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Basic email validation. Domain labels exclude ".", so the pattern can
    // match a string only one way and runs in linear time; a pattern whose
    // label could also match "." backtracks polynomially (CodeQL
    // js/polynomial-redos). 254 characters is the longest valid address.
    const emailRegex = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
    if (email.length > 254 || !emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    const { error } = await resend.contacts.create({
      email: email.toLowerCase().trim(),
      unsubscribed: false
    });

    // Resend returns an error if the contact already exists. Answer exactly
    // as for a new contact, so the response doesn't reveal who is subscribed.
    if (error && !error.message?.includes("already exists")) {
      console.error("Resend error:", error);
      return NextResponse.json(
        { error: "Failed to subscribe. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Subscribe error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
