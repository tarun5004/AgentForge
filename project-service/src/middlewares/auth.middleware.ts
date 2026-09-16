import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { AppError } from "./error.middleware.js";

type AccessTokenPayload = {
  sub?: string;
  email?: string;
  name?: string;
};

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authorization = req.header("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      throw new AppError(401, "Missing or invalid Authorization header.");
    }

    const token = authorization.slice("Bearer ".length);
    const payload = jwt.verify(token, env.ACCESS_TOKEN_SECRET, {
      algorithms: ["HS256"],
    }) as AccessTokenPayload;

    if (!payload.sub) {
      throw new AppError(401, "Invalid access token.");
    }

    req.user = {
      id: payload.sub,
      ...(payload.email ? { email: payload.email } : {}),
      ...(payload.name ? { name: payload.name } : {}),
    };

    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(401, "Invalid or expired access token."));
  }
}
