// The real clock and id source. Core never imports this; the service and CLI pass it in.

import { randomBytes } from "node:crypto";
import type { Ctx } from "../core/index.js";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o, 1/l: easy to read and type

/** Short ids (6 chars) so they're easy to type in the CLI. ~1e9 combinations per graph. */
function shortId(): string {
  return [...randomBytes(6)].map(b => ALPHABET[b % ALPHABET.length]).join("");
}

export const systemCtx: Ctx = {
  now: () => new Date().toISOString(),
  newId: shortId,
};
