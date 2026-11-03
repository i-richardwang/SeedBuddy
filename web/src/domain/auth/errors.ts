import { ConflictError, NotFoundError } from "../errors";

export class UserNotFoundError extends NotFoundError {
  readonly code = "user_not_found";
}

/** The directory would be left without a usable administrator, or an administrator would act on their own account. */
export class UserRejectedError extends ConflictError {
  readonly code = "user_invalid";
}

export class ApiKeyNotFoundError extends NotFoundError {
  readonly code = "api_key_not_found";
}

export class McpClientNotFoundError extends NotFoundError {
  readonly code = "mcp_client_not_found";
}
