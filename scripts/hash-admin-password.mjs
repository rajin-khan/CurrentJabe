#!/usr/bin/env node
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const ITERATIONS = 310_000;
const KEY_LENGTH = 32;

function readPassword() {
  if (process.env.ADMIN_PASSWORD_INPUT) return process.env.ADMIN_PASSWORD_INPUT;
  if (process.argv[2]) {
    console.error("Warning: command-line passwords may be retained in shell history. Prefer piping over stdin.");
    return process.argv[2];
  }
  if (!process.stdin.isTTY) return readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
  console.error("Pipe a password over stdin, or set ADMIN_PASSWORD_INPUT for this one command.");
  console.error("Example: printf '%s' 'your password' | node scripts/hash-admin-password.mjs");
  process.exit(1);
}

const password = readPassword();
if (password.length < 14) {
  console.error("Use an administrator password with at least 14 characters.");
  process.exit(1);
}
if (password.length > 1_024) {
  console.error("Password is too long.");
  process.exit(1);
}

const salt = randomBytes(16);
const derived = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256");
process.stdout.write(`pbkdf2_sha256$${ITERATIONS}$${salt.toString("base64url")}$${derived.toString("base64url")}\n`);

