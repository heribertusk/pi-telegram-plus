import { describe, expect, it } from "vitest";
import { authorizeTelegramUser, ensureTelegramPairingCode, extractTelegramPairingCode } from "../pairing.ts";

describe("Telegram pairing", () => {
  it("does not auto-authorize the first user when no allowedUserId is configured", () => {
    const config = { botToken: "token", pairingCode: "123456" };

    const decision = authorizeTelegramUser(config, 42, "hello", "mybot");

    expect(decision.authorized).toBe(false);
    expect(decision.paired).toBe(false);
    expect(decision.config).toBe(config);
    expect(decision.config).not.toHaveProperty("allowedUserId");
  });

  it("authorizes a user with the one-time pairing code and removes the code", () => {
    const now = 5_000_000;
    const decision = authorizeTelegramUser({ botToken: "token", pairingCode: "123456", pairingCodeExpiresAt: now + 60_000, pairingAttempts: 2 }, 42, "/pair 123456", "mybot", now);

    expect(decision.authorized).toBe(true);
    expect(decision.paired).toBe(true);
    expect(decision.config.allowedUserId).toBe(42);
    expect(decision.config.pairingCode).toBeUndefined();
    expect(decision.config.pairingAttempts).toBeUndefined();
  });

  it("keeps rejecting other users after pairing", () => {
    const config = { botToken: "token", allowedUserId: 42 };

    expect(authorizeTelegramUser(config, 42, "hello", "mybot").authorized).toBe(true);
    expect(authorizeTelegramUser(config, 99, "/pair 123456", "mybot").authorized).toBe(false);
  });

  it("supports bot-addressed pair commands but ignores other bot usernames", () => {
    expect(extractTelegramPairingCode("/pair@MyBot 123456", "mybot")).toBe("123456");
    expect(extractTelegramPairingCode("/pair@OtherBot 123456", "mybot")).toBeUndefined();
  });

  it("generates a pairing code only when no user is paired", () => {
    const now = 1_000_000;
    const withCode = ensureTelegramPairingCode({ botToken: "token" }, now);
    expect(withCode.pairingCode).toMatch(/^\d{6}$/);
    expect(withCode.pairingCodeExpiresAt).toBe(now + 10 * 60 * 1000);

    const paired = ensureTelegramPairingCode({ botToken: "token", allowedUserId: 42, pairingCode: "123456", pairingAttempts: 2 }, now);
    expect(paired).toEqual({ botToken: "token", allowedUserId: 42 });
  });

  it("regenerates an expired pairing code", () => {
    const now = 5_000_000;
    const config = { botToken: "token", pairingCode: "123456", pairingCodeExpiresAt: now - 1 };

    const refreshed = ensureTelegramPairingCode(config, now);

    expect(refreshed.pairingCode).toMatch(/^\d{6}$/);
    expect(refreshed.pairingCodeExpiresAt).toBe(now + 10 * 60 * 1000);
  });

  it("rejects a pairing attempt on an expired code and rotates the code", () => {
    const now = 5_000_000;
    const decision = authorizeTelegramUser({ botToken: "token", pairingCode: "123456", pairingCodeExpiresAt: now - 1 }, 42, "/pair 123456", "mybot", now);

    expect(decision.authorized).toBe(false);
    expect(decision.paired).toBe(false);
    expect(decision.config.pairingCode).toMatch(/^\d{6}$/);
    expect(decision.config.pairingCode).not.toBe("123456");
    expect(decision.config.pairingCodeExpiresAt).toBe(now + 10 * 60 * 1000);
  });

  it("counts mismatched pair guesses and rotates after the attempt cap", () => {
    const now = 5_000_000;
    const config = { botToken: "token", pairingCode: "123456", pairingCodeExpiresAt: now + 60_000 };

    let decision = authorizeTelegramUser(config, 42, "/pair 000000", "mybot", now);
    expect(decision.authorized).toBe(false);
    expect(decision.config.pairingAttempts).toBe(1);

    decision = authorizeTelegramUser({ ...config, pairingAttempts: 4 }, 42, "/pair 000000", "mybot", now);
    expect(decision.authorized).toBe(false);
    expect(decision.config.pairingCode).not.toBe("123456");
    expect(decision.config.pairingAttempts).toBeUndefined();
  });

  it("non-pair chatter does not burn the attempt budget", () => {
    const now = 5_000_000;
    const config = { botToken: "token", pairingCode: "123456", pairingCodeExpiresAt: now + 60_000 };

    const decision = authorizeTelegramUser(config, 99, "hello", "mybot", now);

    expect(decision.authorized).toBe(false);
    expect(decision.config).toBe(config);
  });
});
