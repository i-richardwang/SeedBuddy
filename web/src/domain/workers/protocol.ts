/**
 * The revision of the protocol worker processes speak with the workbench:
 * the worker routes, the documents they exchange and what both mean. The two
 * sides share it with no mixed-revision support, so every worker request
 * states the revision its process speaks and a request stating another is
 * refused. Raise it with any change a worker process of the previous revision
 * would misread.
 */
export const WORKER_PROTOCOL = 1;

/** The request header a worker process states its protocol revision in. */
export const WORKER_PROTOCOL_HEADER = "SeedBuddy-Worker-Protocol";
