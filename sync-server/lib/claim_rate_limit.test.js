const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClaimRateLimiter } = require("./claim_rate_limit");

function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test("erlaubt versuche unterhalb des limits", () => {
  const clock = makeClock();
  const rl = createClaimRateLimiter({ windowMs: 60_000, maxFails: 5, now: clock.now });
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.check("1.2.3.4").allowed, true);
    rl.recordFailure("1.2.3.4");
  }
});

test("blockiert nach maxFails fehlversuchen", () => {
  const clock = makeClock();
  const rl = createClaimRateLimiter({ windowMs: 60_000, maxFails: 5, now: clock.now });
  for (let i = 0; i < 5; i++) rl.recordFailure("1.2.3.4");
  const res = rl.check("1.2.3.4");
  assert.equal(res.allowed, false);
  assert.ok(res.retryAfterSec > 0 && res.retryAfterSec <= 60);
});

test("ip-bucket isolation", () => {
  const clock = makeClock();
  const rl = createClaimRateLimiter({ windowMs: 60_000, maxFails: 5, now: clock.now });
  for (let i = 0; i < 5; i++) rl.recordFailure("1.2.3.4");
  assert.equal(rl.check("1.2.3.4").allowed, false);
  assert.equal(rl.check("9.9.9.9").allowed, true);
});

test("eintrag fällt nach window heraus", () => {
  const clock = makeClock();
  const rl = createClaimRateLimiter({ windowMs: 60_000, maxFails: 5, now: clock.now });
  for (let i = 0; i < 5; i++) rl.recordFailure("1.2.3.4");
  assert.equal(rl.check("1.2.3.4").allowed, false);
  clock.advance(60_001);
  assert.equal(rl.check("1.2.3.4").allowed, true);
});

test("reset einer ip leert den bucket", () => {
  const clock = makeClock();
  const rl = createClaimRateLimiter({ windowMs: 60_000, maxFails: 5, now: clock.now });
  for (let i = 0; i < 5; i++) rl.recordFailure("1.2.3.4");
  rl.reset("1.2.3.4");
  assert.equal(rl.check("1.2.3.4").allowed, true);
});
