// Pure auth/role guards für pair-claim und session-administration.
// Trennt domain-regeln (welche rolle darf was) von infra (express handlers).

/**
 * Erzwingt deviceType="mobile" beim claim. Desktop erhält sessions ausschließlich
 * über /api/pair/desktop-init (localhost-only). Daher ist der claim-endpoint
 * fest mobile, unabhängig vom request-body.
 *
 * @returns {"mobile"}
 */
function normalizeClaimDeviceType() {
  return "mobile";
}

/**
 * Prüft ob session desktop-rechte hat (sieht alle tokens, darf fremde geräte trennen).
 *
 * Defense-in-depth: persistente sessions.json gilt als untrusted-input. Ein
 * manipulierter eintrag mit deviceType="desktop" reicht nicht — zusätzlich
 * muss pairedWith==="self" sein (wird ausschließlich von /api/pair/desktop-init
 * gesetzt, das localhost-gated ist).
 *
 * @param {{deviceType?: string, pairedWith?: string}|undefined} session
 * @returns {boolean}
 */
function isDesktopSession(session) {
  return !!session && session.deviceType === "desktop" && session.pairedWith === "self";
}

module.exports = { normalizeClaimDeviceType, isDesktopSession };
