class ApiError extends Error {
  constructor(status, message, code = "REQUEST_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function notFound(req, res, next) {
  next(new ApiError(404, "The requested endpoint was not found.", "NOT_FOUND"));
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) {
    console.error("Request failed:", error);
  }

  res.status(status).json({
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: status >= 500 && process.env.NODE_ENV === "production"
        ? "An unexpected server error occurred."
        : error.message || "An unexpected server error occurred."
    }
  });
}

module.exports = { ApiError, notFound, errorHandler };
