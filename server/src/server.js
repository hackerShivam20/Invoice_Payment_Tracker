import dotenv from "dotenv";
// CRITICAL: dotenv.config() MUST run before any other import
// that reads process.env. If you import db.js before dotenv runs,
// MONGODB_URI is undefined and the connection fails silently.
dotenv.config();

import { app } from "./app.js";
import connectDB from "./config/db.js";

const PORT = process.env.PORT || 5000;

// WHY this pattern (connectDB then listen):
// If we app.listen() first and DB connection fails,
// we'd have a live server that can't handle any requests.
// Connect to DB first. Only start accepting traffic after DB is ready.
connectDB()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
    });

    // WHY handle unhandledRejection:
    // Any async code that throws without being caught becomes an
    // unhandledRejection. In Node 15+, this crashes the process.
    // We catch it, log it, then shut down gracefully.
    process.on("unhandledRejection", (reason, promise) => {
      console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
      // Graceful shutdown: stop accepting new connections,
      // finish in-flight requests, then exit.
      server.close(() => {
        process.exit(1);
      });
    });

    // WHY handle uncaughtException:
    // Synchronous code that throws outside a try/catch lands here.
    // You CANNOT safely continue after this — the process state is unknown.
    // Log, then exit immediately.
    process.on("uncaughtException", (err) => {
      console.error("❌ Uncaught Exception:", err);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error("❌ Server startup failed:", err);
    process.exit(1);
  });