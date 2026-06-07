// WHY: Without this, different developers on your team
// would return { data: ... }, { result: ... }, { payload: ... }
// inconsistently. Frontend would need to handle all cases.
// With ApiResponse, the contract is ALWAYS:
// { statusCode, data, message, success }

class ApiResponse {
  constructor(statusCode, data, message = "Success") {
    this.statusCode = statusCode;
    this.data = data;
    this.message = message;
    // HTTP 2xx codes = success. Simple, semantic rule.
    this.success = statusCode < 400;
  }
}

export { ApiResponse };