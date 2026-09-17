import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

import { env } from "../config/env.js";

function tokensMatch(receivedToken: string, expectedToken: string): boolean {
  const received = Buffer.from(receivedToken);
  const expected = Buffer.from(expectedToken);

  return received.length === expected.length && timingSafeEqual(received, expected);
}

export const requireInternalToken: RequestHandler = (req, res, next) => {
  const token = req.header("x-internal-service-token") ?? "";

  if (!tokensMatch(token, env.INTERNAL_SERVICE_TOKEN)) {
    res.status(401).json({ message: "Invalid internal service token." });
    return;
  }

  next();
};
