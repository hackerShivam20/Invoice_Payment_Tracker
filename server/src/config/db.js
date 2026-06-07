import mongoose from "mongoose";

// WHY we export a function, not connect at import time:
// If you connect at module load, you can't control WHEN the connection
// happens. By exporting connectDB(), server.js calls it explicitly
// BEFORE starting the HTTP server. This prevents requests arriving
// before the DB is ready.

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // These options prevent Mongoose deprecation warnings
      // and enable the newer connection engine.
      // In Mongoose 7+, these are defaults — keep them explicit
      // so junior devs know they're intentional.
    });

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);

    // Mongoose emits events you can hook into.
    // 'disconnected' fires if the DB drops mid-run (network blip, Atlas restart).
    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️  MongoDB disconnected. Attempting to reconnect...");
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
      // Don't throw here — Mongoose will try to reconnect automatically.
      // Throwing would crash the server.
    });

  } catch (error) {
    // process.exit(1) is intentional here.
    // If we can't connect on startup, there's nothing to serve.
    // Exit code 1 signals an error to Docker/PM2/systemd so they
    // can restart the process or alert the team.
    console.error("❌ Failed to connect to MongoDB:", error.message);
    process.exit(1);
  }
};

export default connectDB;