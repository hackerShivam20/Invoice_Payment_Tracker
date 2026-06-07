// WHY THIS EXISTS:
// Without asyncHandler, every async controller looks like:
//
//   export const getUser = async (req, res, next) => {
//     try {
//       const user = await User.findById(req.params.id);
//       res.json(user);
//     } catch (err) {
//       next(err);   // <-- you must remember this on EVERY controller
//     }
//   };
//
// With asyncHandler, you wrap your function once and never write
// try/catch again. If your async function throws, next(err) is
// called automatically, routing to your global error handler.

const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    next(error);
  }
};

export { asyncHandler };