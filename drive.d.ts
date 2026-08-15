/**
 * Types for `drive.js`.
 *
 * The module itself is plain JavaScript because it runs in the Node server
 * process, which is not part of the Vite/TypeScript build. This declaration
 * exists so the tests — and any future consumer — get real types instead of
 * `any`, rather than the whole file being waved through with a suppression.
 */

/** Thrown for conditions the person who pasted the link should see verbatim. */
export class DriveError extends Error {
  constructor(message: string, status: number);
  readonly status: number;
}

/**
 * Build a direct-download URL from a Google Drive or Docs share link.
 *
 * Returns `null` for anything unrecognised, off-host, or not served over
 * HTTPS. The returned URL is always constructed from a fixed template with an
 * extracted file id — never the caller's string — which is what keeps this
 * from being a server-side request forgery primitive.
 */
export function toDownloadUrl(input: unknown): string | null;

/**
 * Fetch the text of a publicly shared plan file.
 *
 * Throws `DriveError` for an unusable link, an unshared file, an oversized
 * response, or a timeout.
 */
export function fetchDrivePlan(input: unknown): Promise<string>;
