/**
 * Wraps an async Express route handler to catch rejected promises
 * and forward them to Express error handling middleware.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
