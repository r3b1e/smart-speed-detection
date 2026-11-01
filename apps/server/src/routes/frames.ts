import { Router, type NextFunction, type Request, type Response } from "express";
import { AppError, ah } from "../errors";
import { verifyAccessToken } from "../services/token";
import { findFile, downloadStream } from "../services/frames";
import { Detection, User, Vehicle } from "../models";

export const framesRouter = Router();

/**
 * Frame images are rendered in <img> tags, which cannot send Authorization
 * headers — so we also accept a short-lived `?access_token=`.
 */
async function frameAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    const queryToken =
      typeof req.query.access_token === "string" ? req.query.access_token : undefined;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;
    if (!token) throw new AppError("UNAUTHORIZED", "authentication required");
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) throw new AppError("UNAUTHORIZED", "invalid access token");
    req.user = user;
    next();
  } catch (err) {
    next(err instanceof AppError ? err : new AppError("UNAUTHORIZED", "invalid access token"));
  }
}

framesRouter.get(
  "/:fileId",
  frameAuth,
  ah(async (req, res) => {
    const fileId = req.params.fileId ?? "";
    const file = await findFile(fileId);
    if (!file) throw new AppError("NOT_FOUND", "frame not found");

    const detectionId = file.metadata?.detectionId as string | undefined;
    if (detectionId) {
      const detection = await Detection.findOne({ _id: detectionId, source: "arduino" }).select(
        "plate"
      );
      if (!detection) throw new AppError("NOT_FOUND", "frame not found");
      if (req.user!.role === "user") {
        const owned = detection.plate
          ? await Vehicle.exists({ ownerUserId: req.user!._id, plate: detection.plate })
          : null;
        if (!owned) throw new AppError("NOT_FOUND", "frame not found");
      }
    }

    res.setHeader("content-type", file.contentType ?? "image/jpeg");
    if (file.length !== undefined) res.setHeader("content-length", String(file.length));
    res.setHeader("cache-control", "private, max-age=300");
    const stream = downloadStream(fileId);
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  })
);
