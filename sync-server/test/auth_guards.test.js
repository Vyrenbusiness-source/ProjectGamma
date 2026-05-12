const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeClaimDeviceType, isDesktopSession } = require("../auth_guards");

test("claim ignoriert deviceType aus dem body und erzwingt mobile", () => {
  assert.equal(normalizeClaimDeviceType(), "mobile");
});

test("isDesktopSession nur true bei deviceType==='desktop' + pairedWith==='self'", () => {
  assert.equal(isDesktopSession({ deviceType: "desktop", pairedWith: "self" }), true);
  assert.equal(isDesktopSession({ deviceType: "mobile", pairedWith: "self" }), false);
  assert.equal(isDesktopSession({ deviceType: "DESKTOP", pairedWith: "self" }), false);
  assert.equal(isDesktopSession(undefined), false);
  assert.equal(isDesktopSession({}), false);
});

test("isDesktopSession verweigert untrusted state.json: deviceType=desktop ohne self-pairing", () => {
  // ein manipulierter mobile-eintrag mit pairedWith=hostName darf keine desktop-rechte erhalten
  assert.equal(isDesktopSession({ deviceType: "desktop", pairedWith: "host-mobile" }), false);
  assert.equal(isDesktopSession({ deviceType: "desktop" }), false);
});
