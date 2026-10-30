import { type NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

// `{"email": "..."}` fits easily; anything larger is not from the form.
const MAX_BODY_BYTES = 1024;

// Requests per client IP per window. The counts live in this instance's
// memory, so they are not a global limit, but Fluid Compute reuses instances,
// so they blunt one client hammering the endpoint. A person subscribes once.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, { count: number; resetAt: number }>();

// Browsers send Origin on every POST, and Referer when a privacy setting
// strips Origin. Requiring one of them to match the host rejects cross-site
// form posts; it can't stop a non-browser client, which the rate limit covers.
function isSameOrigin(request: NextRequest): boolean {
  const host = request.headers.get("host");
  const source =
    request.headers.get("origin") ?? request.headers.get("referer");
  if (!host || !source) return false;
  try {
    return new URL(source).host === host;
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
  if (hits.size > 10_000) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return 0;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT ? Math.ceil((entry.resetAt - now) / 1000) : 0;
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
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
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

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
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
