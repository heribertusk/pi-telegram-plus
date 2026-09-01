import { randomInt } from "node:crypto";
import type { TelegramConfig } from "./types.ts";

export type TelegramAuthorizationDecision = {
  authorized: boolean;
  paired: boolean;
  config: TelegramConfig;
};

// ponytail: policy constants, not config — promote to env vars if a deployment ever needs different knobs.
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;

function freshPairingFields(now: number): { pairingCode: string; pairingCodeExpiresAt: number } {
  return { pairingCode: randomInt(0, 1_000_000).toString().padStart(6, "0"), pairingCodeExpiresAt: now + PAIRING_CODE_TTL_MS };
}

function stripPairingFields(config: TelegramConfig): TelegramConfig {
  const { pairingCode: _pairingCode, pairingCodeExpiresAt: _pairingCodeExpiresAt, pairingAttempts: _pairingAttempts, ...rest } = config;
  return rest;
}

export function isPairingCodeExpired(config: TelegramConfig, now = Date.now()): boolean {
  if (config.pairingCode === undefined) return true;
  if (config.pairingCodeExpiresAt === undefined) return true; // codes without expiry are pre-fork artifacts; force regeneration
  return config.pairingCodeExpiresAt <= now;
}

export function createTelegramPairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function ensureTelegramPairingCode(config: TelegramConfig, now = Date.now()): TelegramConfig {
  if (config.allowedUserId !== undefined) return stripPairingFields(config);
  if (config.pairingCode && !isPairingCodeExpired(config, now) && (config.pairingAttempts ?? 0) < MAX_PAIRING_ATTEMPTS) return config;
  return { ...stripPairingFields(config), ...freshPairingFields(now) };
}

export function extractTelegramPairingCode(text: string | undefined, botUsername?: string): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^\/pair(?:@([A-Za-z0-9_]+))?\s+([A-Za-z0-9_-]+)$/i);
  if (!match) return undefined;
  const addressedBot = match[1];
  if (addressedBot && botUsername && addressedBot.toLowerCase() !== botUsername.toLowerCase()) return undefined;
  return match[2];
}

export function authorizeTelegramUser(
  config: TelegramConfig,
  userId: number | undefined,
  text?: string,
  botUsername?: string,
  now = Date.now(),
): TelegramAuthorizationDecision {
  if (userId === undefined) return { authorized: false, paired: false, config };
  if (config.allowedUserId !== undefined) {
    return { authorized: config.allowedUserId === userId, paired: false, config };
  }
  const pairingCode = extractTelegramPairingCode(text, botUsername);
  if (config.pairingCode && pairingCode === config.pairingCode && !isPairingCodeExpired(config, now) && (config.pairingAttempts ?? 0) < MAX_PAIRING_ATTEMPTS) {
    return { authorized: true, paired: true, config: { ...stripPairingFields(config), allowedUserId: userId } };
  }
  // Count only mismatched /pair guesses — random chatter must not burn the budget.
  // Exhausted or expired codes rotate immediately so brute force never converges;
  // the legit user reads the fresh code from the local TUI on next startup.
  if (pairingCode !== undefined) {
    const attempts = (config.pairingAttempts ?? 0) + 1;
    if (attempts >= MAX_PAIRING_ATTEMPTS || isPairingCodeExpired(config, now)) {
      return { authorized: false, paired: false, config: { ...stripPairingFields(config), ...freshPairingFields(now) } };
    }
    return { authorized: false, paired: false, config: { ...config, pairingAttempts: attempts } };
  }
  return { authorized: false, paired: false, config };
}

export function formatPairingInstructions(config: TelegramConfig, now = Date.now()): string {
  if (config.allowedUserId !== undefined) return "Telegram user is already paired.";
  if (!config.pairingCode) return "Telegram pairing is required, but no pairing code is available.";
  const minutes = config.pairingCodeExpiresAt ? Math.max(1, Math.ceil((config.pairingCodeExpiresAt - now) / 60_000)) : 0;
  const expiry = minutes ? ` (expires in ~${minutes} min; restart pi to regenerate)` : " (expired; restart pi to regenerate)";
  return `Telegram pairing required. Send this message to the bot from your Telegram account:\n/pair ${config.pairingCode}${expiry}`;
}
