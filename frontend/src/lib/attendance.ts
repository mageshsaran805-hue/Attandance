/**
 * Attendance OTP display helpers.
 *
 * The backend never stores or re-serves the raw OTP: it exists only in the
 * response that generated it. sessionStorage keeps it visible across in-tab
 * reloads for the faculty member who generated it (it is shown to the class
 * anyway); regenerating replaces it and closing clears it.
 */

const KEY_PREFIX = 'ca_session_otp:'

export function storeSessionOtp(sessionId: string, otp: string): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + sessionId, otp)
  } catch {
    // Private mode or full storage: the OTP simply is not kept across reloads.
  }
}

export function readSessionOtp(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(KEY_PREFIX + sessionId)
  } catch {
    return null
  }
}

export function clearSessionOtp(sessionId: string): void {
  try {
    sessionStorage.removeItem(KEY_PREFIX + sessionId)
  } catch {
    // Nothing to clear.
  }
}
