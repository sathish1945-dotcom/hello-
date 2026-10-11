/** An existing credential is not evidence that the current authorisation completed. */
export function hasNewOAuthConnection(
  status: { connected: boolean; updatedAt?: string | null },
  attempt: { previousUpdatedAt?: string | null; createdAt: number } | null,
): boolean {
  if (!attempt || !status.connected || !status.updatedAt) return false;
  if (attempt.previousUpdatedAt !== undefined) {
    return status.updatedAt !== attempt.previousUpdatedAt;
  }
  // Compatibility with attempts started by an older client/server.
  return Date.parse(status.updatedAt) > attempt.createdAt;
}
