import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.routes.js";
import clientRoutes from "./routes/client.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";

const app = express();

// ─── HELMET ───────────────────────────────────────────────────────────────────
// WHY: Browsers trust whatever headers a server sends.
// Without Helmet, your app is missing ~14 security headers.
// Helmet sets: Content-Security-Policy, X-Frame-Options (clickjacking),
// X-Content-Type-Options (MIME sniffing), Strict-Transport-Security (HTTPS only).
// One line. Massive security gain. Always use it.
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
// WHY: Browsers block cross-origin requests by default (Same-Origin Policy).
// Your React app at localhost:5173 can't call localhost:5000 without CORS headers.
// credentials: true is required for cookies (JWT refresh token in httpOnly cookie).
// Without it, the browser strips cookies from cross-origin requests.
app.use(
  cors({
    origin: process.env.CLIENT_URL,  // never use "*" with credentials
    credentials: true,               // allow cookies to be sent cross-origin
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  })
);

// ─── RATE LIMITING ────────────────────────────────────────────────────────────
// WHY: Without rate limiting, a single attacker can send 10,000 login
// requests per second (brute force, credential stuffing).
// This limiter allows 100 requests per 15-minute window per IP.
// In production you'd use Redis-backed rate limiting for multi-server setups.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes in milliseconds
  max: 100,                  // max requests per window per IP
  standardHeaders: true,     // return rate limit info in RateLimit-* headers
  legacyHeaders: false,      // disable X-RateLimit-* headers (deprecated)
  message: {
    success: false,
    message: "Too many requests from this IP, please try again after 15 minutes",
  },
});
app.use("/api", limiter);  // only rate-limit API routes, not health checks

// ─── BODY PARSING ─────────────────────────────────────────────────────────────
// WHY: Express doesn't parse request bodies by default.
// express.json() parses application/json bodies → available as req.body.
// express.urlencoded() handles HTML form submissions.
// limit: "16kb" prevents payload attacks (sending a 500MB JSON body to crash the server).
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

// ─── COOKIE PARSER ────────────────────────────────────────────────────────────
// WHY: Without this, req.cookies is undefined.
// Our refresh token lives in an httpOnly cookie.
// The secret parameter enables signed cookies (tamper-proof).
app.use(cookieParser(process.env.COOKIE_SECRET));

// ─── LOGGING ──────────────────────────────────────────────────────────────────
// WHY: In development, you need to see every request: method, URL, status, time.
// Morgan's "dev" format: GET /api/v1/invoices 200 45ms
// In production you'd use "combined" format and pipe to a log aggregator (Datadog, etc.)
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// /api/v1 prefix = API versioning.
// WHY: When you make breaking changes (v2 auth, new invoice structure),
// you can release /api/v2 without breaking existing mobile apps still on v1.
// This is how Stripe, Twilio, and every major API does it.
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/clients", clientRoutes);
app.use("/api/v1/invoices", invoiceRoutes);
// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
// WHY: Render/Railway/Docker health checks ping this route to verify
// the server is alive. If it returns 200, the platform keeps traffic flowing.
// If it fails, the platform restarts your container. Never remove this.
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ─── 404 HANDLER ──────────────────────────────────────────────────────────────
// WHY: If no route matched, this middleware runs.
// Without it, Express sends a plain HTML "Cannot GET /api/blah" page —
// terrible for an API. This sends clean JSON.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
// WHY: The 4-argument signature (err, req, res, next) is how Express
// identifies error-handling middleware. It MUST have all 4 params.
// Every next(error) call anywhere in your app lands here.
// This is your single source of truth for error responses.
app.use((err, req, res, next) => {
  // Log full error in development for debugging
  if (process.env.NODE_ENV === "development") {
    console.error("🔴 ERROR:", err);
  }

  const statusCode = err.statusCode || 500;
  const message = err.isOperational
    ? err.message                          // our ApiError — safe to show user
    : "Internal server error";             // unexpected crash — hide details

  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    errors: err.errors || [],
    // Only expose stack trace in development
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

export { app };