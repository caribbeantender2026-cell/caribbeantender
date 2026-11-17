/**
 * Turns an error from a database call into the server functions' reply. The database's deliberate
 * refusals are written in plain English for the person, so they pass through with a fitting status;
 * anything else may expose internals, so it gets a generic message and the caller logs the details.
 */

/** The parts of a supabase-js error this needs. */
export type DatabaseError = { code?: string | undefined; message: string };

// Postgres error codes the app's functions raise on purpose (raise exception ... using errcode).
const statusForRefusalCode: Record<string, number> = {
  P0002: 404, // no_data_found: "Document not found.", "User not found."
  '42501': 403, // insufficient_privilege: not signed in, deactivated, not an admin, no two-step sign-in
  '23514': 400, // check_violation: a request the rules forbid, such as deactivating yourself
};

// PostgREST's sign-in errors: the token couldn't be read, was missing, or has expired.
const signInErrorCodes = new Set(['PGRST301', 'PGRST302', 'PGRST303']);

/** The HTTP status and message to send for a database error. */
export function refusalReply(error: DatabaseError): { status: number; message: string } {
  const refusalStatus = error.code === undefined ? undefined : statusForRefusalCode[error.code];
  if (refusalStatus !== undefined) {
    return { status: refusalStatus, message: error.message };
  }
  if (error.code !== undefined && signInErrorCodes.has(error.code)) {
    return { status: 401, message: 'Your sign-in has expired. Log in again, then try once more.' };
  }
  return { status: 500, message: 'Something went wrong on our side. Try again in a minute.' };
}
