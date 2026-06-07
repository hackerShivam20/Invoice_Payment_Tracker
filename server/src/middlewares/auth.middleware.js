import jwt from "jsonwebtoken";
import { User } from "../models/User.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// WHY asyncHandler wraps this:
// jwt.verify is synchronous, but User.findById is async.
// Any thrown error (expired token, DB failure) goes to the global error handler.

export const verifyJWT = asyncHandler(async (req, res, next) => {
  // Token can arrive via:
  // 1. Authorization: Bearer <token>  (standard API clients, mobile apps)
  // 2. req.cookies.accessToken        (browser with httpOnly cookie)
  // We support both for flexibility.
  const token =
    req.cookies?.accessToken ||
    req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    throw new ApiError(401, "Unauthorized — no token provided");
  }

  let decoded;
  try {
    // jwt.verify throws if:
    // - Token is malformed
    // - Token signature doesn't match (tampering)
    // - Token has expired (exp claim in the past)
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    // Translate JWT errors to our ApiError format.
    // We check the name so we can give specific messages.
    if (err.name === "TokenExpiredError") {
      throw new ApiError(401, "Access token expired — please refresh");
    }
    throw new ApiError(401, "Invalid access token");
  }

  // WHY fetch from DB here instead of trusting the JWT payload?
  // The JWT payload is signed at login time. If the user is deleted
  // or their role changes between requests, the JWT still has old data.
  // Fetching from DB gives us the current state.
  // Tradeoff: 1 extra DB query per request. Use Redis caching in Phase 5.
  const user = await User.findById(decoded._id).select(
    "-password -refreshToken"  // never attach sensitive fields to req.user
  );

  if (!user) {
    throw new ApiError(401, "User not found — token may be stale");
  }

  // Attach user to the request object.
  // Every subsequent middleware and controller can access req.user
  // without hitting the DB again.
  req.user = user;
  next();
});