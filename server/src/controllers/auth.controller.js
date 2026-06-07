import { User } from "../models/User.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";

// ─── COOKIE OPTIONS ───────────────────────────────────────────────────────────
// Extracted as a constant so both login and refreshToken use identical settings.
// httpOnly: JS on the page CANNOT read this cookie (XSS protection).
// secure: only send over HTTPS (set true in production).
// sameSite: "strict" prevents the cookie being sent on cross-site navigations
// (CSRF protection). Use "lax" if you need cross-origin form submissions.
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
};

// ─── HELPER: generate and persist both tokens ─────────────────────────────────
// WHY a helper: login AND refreshToken both need to generate token pairs.
// DRY principle — one place to change if token logic evolves.
const generateTokens = async (userId) => {
  const user = await User.findById(userId);
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  // Persist refresh token in DB so we can revoke it on logout.
  // save() triggers the pre-save hook — but password isn't modified,
  // so the hook returns early without re-hashing. Correct behavior.
  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });
  // validateBeforeSave: false skips schema validation.
  // WHY: We're only updating one field; re-running full validation
  // would fail if other required fields were missing (they won't be, but it's safer).

  return { accessToken, refreshToken };
};

// ─── REGISTER ─────────────────────────────────────────────────────────────────
export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  // Manual validation — in Phase 2 we add Zod middleware to handle this cleaner.
  if (!name || !email || !password) {
    throw new ApiError(400, "Name, email and password are required");
  }

  // Case-insensitive duplicate check.
  // email is stored as lowercase (schema), so this match works.
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new ApiError(409, "An account with this email already exists");
  }

  // User.create() runs the pre-save hook → password gets hashed automatically.
  // You never hash manually in the controller.
  const user = await User.create({ name, email, password });

  // Fetch the created user without sensitive fields for the response.
  // findById + select is more explicit than trying to exclude from the create result.
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  return res
    .status(201)
    .json(new ApiResponse(201, createdUser, "Account created successfully"));
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  // select("+password") explicitly includes the password field
  // (it's excluded by default via select: false in schema).
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password"
  );

  // WHY the same error for "user not found" and "wrong password":
  // Returning "user not found" tells attackers which emails are registered.
  // "Invalid credentials" reveals nothing.
  if (!user) {
    throw new ApiError(401, "Invalid credentials");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid credentials");
  }

  const { accessToken, refreshToken } = await generateTokens(user._id);

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  // Set refresh token in httpOnly cookie (7 days).
  // Send access token in response body — React stores it in memory (not localStorage!).
  // WHY not localStorage for access token: XSS can steal localStorage.
  // In-memory (React state / Redux) is safer for short-lived tokens.
  return res
    .status(200)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(
      new ApiResponse(200, { user: loggedInUser, accessToken }, "Login successful")
    );
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
export const logout = asyncHandler(async (req, res) => {
  // req.user is set by verifyJWT middleware (runs before this controller).
  // Clear the refresh token from DB → revokes the token server-side.
  await User.findByIdAndUpdate(
    req.user._id,
    { $unset: { refreshToken: 1 } }, // $unset removes the field entirely
    { new: true }
  );

  // Clear the cookie from the browser.
  // The options must match the original cookie options (httpOnly, secure)
  // or some browsers won't clear the cookie.
  return res
    .status(200)
    .clearCookie("refreshToken", cookieOptions)
    .json(new ApiResponse(200, {}, "Logged out successfully"));
});

// ─── REFRESH ACCESS TOKEN ─────────────────────────────────────────────────────
// WHY this route exists:
// Access tokens expire every 15 minutes. Without refresh, the user gets
// logged out constantly. The client calls this route silently in the background
// (Axios interceptor) when it gets a 401 response. The user never notices.
export const refreshAccessToken = asyncHandler(async (req, res) => {
  // Refresh token comes from httpOnly cookie (can't be accessed by JS on the page).
  const incomingRefreshToken = req.cookies?.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "No refresh token — please log in");
  }

  let decoded;
  try {
    decoded = jwt.verify(incomingRefreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw new ApiError(401, "Refresh token expired or invalid — please log in");
  }

  const user = await User.findById(decoded._id);
  if (!user) {
    throw new ApiError(401, "User not found");
  }

  // Compare incoming token against what's stored in DB.
  // WHY: If the user logged out (we cleared the DB field), or logged in
  // on a new device (new refresh token saved), the old cookie is rejected.
  // This prevents token reuse after logout.
  if (user.refreshToken !== incomingRefreshToken) {
    throw new ApiError(401, "Refresh token mismatch — please log in again");
  }

  // Issue a fresh pair. This is "token rotation" — every refresh gives
  // a new refresh token, invalidating the old one. Limits refresh token reuse.
  const { accessToken, refreshToken } = await generateTokens(user._id);

  return res
    .status(200)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(
      new ApiResponse(200, { accessToken }, "Access token refreshed")
    );
});

// ─── GET CURRENT USER ─────────────────────────────────────────────────────────
// Useful for the frontend to restore session on page reload.
// verifyJWT already fetched the user and attached it to req.user.
// We just return it — no extra DB call needed.
export const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "Current user fetched successfully"));
});