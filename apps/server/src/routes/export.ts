import { DetectionQuerySchema } from "@smart-speed/shared";
import { Router } from "express";
import PDFDocument from "pdfkit";
import { ah } from "../errors";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Device, Detection, type IDetection } from "../models";
import { escapeRegex, rangeEnd, rangeStart } from "../services/scope";
import type { FilterQuery } from "mongoose";

export const exportRouter = Router();
exportRouter.use(requireAuth, requireRole("admin", "authority"));

const EXPORT_LIMIT = 50_000;

const CSV_COLUMNS = [
  "id",
  "detectedAt",
  "device",
  "measuredKmh",
  "scaledKmh",
  "limitKmh",
  "overspeed",
  "severity",
  "direction",
  "plate",
  "review",
  "fine",
  "source",
] as const;

async function buildFilter(q: Record<string, unknown>): Promise<FilterQuery<IDetection>> {
  const filter: FilterQuery<IDetection> = { source: "arduino" };
  const from = rangeStart(q.from as string | undefined);
  const to = rangeEnd(q.to as string | undefined);
  if (from || to) {
    filter.detectedAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  }
  if (q.deviceId) filter.deviceId = q.deviceId as string;
  if (q.overspeed !== undefined) filter.overspeed = q.overspeed as boolean;
  if (q.severity) filter.severity = q.severity as string;
  if (q.review) filter["review.status"] = q.review as string;
  if (q.plate) filter.plate = (q.plate as string).trim().toUpperCase();
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q as string), "i");
    filter.$or = [{ plate: rx }, { vehicleUid: rx }];
  }
  return filter;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toRow(d: IDetection, deviceName: string): (string | number)[] {
  return [
    d.id,
    d.detectedAt.toISOString(),
    deviceName,
    d.measuredSpeedKmh,
    d.scaledSpeedKmh,
    d.limitKmh,
    d.overspeed ? "yes" : "no",
    d.severity,
    d.direction,
    d.plate ?? "",
    d.review.status,
    d.fine ? `${d.fine.amount} ${d.fine.status}` : "",
    d.source,
  ];
}

async function deviceNames(ids: string[]): Promise<Map<string, string>> {
  const devices = await Device.find({ _id: { $in: ids } }).select("name");
  return new Map(devices.map((d) => [d.id, d.name]));
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

exportRouter.get(
  "/detections.csv",
  validate({ query: DetectionQuerySchema }),
  ah(async (req, res) => {
    const filter = await buildFilter(req.query as unknown as Record<string, unknown>);
    const rows = await Detection.find(filter).sort({ detectedAt: -1 }).limit(EXPORT_LIMIT);
    const names = await deviceNames([...new Set(rows.map((r) => r.deviceId.toString()))]);

    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="detections-${stamp()}.csv"`);
    res.write(`${CSV_COLUMNS.join(",")}\n`);
    for (const doc of rows) {
      const name = names.get(doc.deviceId.toString()) ?? "unknown";
      res.write(`${toRow(doc, name).map(csvCell).join(",")}\n`);
    }
    res.end();
  })
);

exportRouter.get(
  "/detections.pdf",
  validate({ query: DetectionQuerySchema }),
  ah(async (req, res) => {
    const filter = await buildFilter(req.query as unknown as Record<string, unknown>);
    const rows = await Detection.find(filter).sort({ detectedAt: -1 }).limit(EXPORT_LIMIT);
    const names = await deviceNames([...new Set(rows.map((r) => r.deviceId.toString()))]);

    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `attachment; filename="detections-${stamp()}.pdf"`);

    const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
    doc.pipe(res);
    doc.fontSize(16).text("Smart Speed Detection — violations export", { align: "left" });
    doc.moveDown(0.4);
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(`${rows.length} rows · generated ${new Date().toISOString()}`);
    doc.moveDown(0.8);

    const cols: { label: string; width: number }[] = [
      { label: "Time (UTC)", width: 130 },
      { label: "Station", width: 130 },
      { label: "Speed", width: 60 },
      { label: "Limit", width: 50 },
      { label: "Severity", width: 60 },
      { label: "Dir", width: 40 },
      { label: "Plate", width: 90 },
      { label: "Review", width: 70 },
      { label: "Fine", width: 80 },
    ];
    const startY = doc.y;
    let y = startY;
    const x0 = doc.page.margins.left;
    const rowHeight = 14;

    const drawHeader = (): void => {
      let x = x0;
      doc.fontSize(8).fillColor("#000");
      for (const col of cols) {
        doc.font("Helvetica-Bold").text(col.label, x, y, { width: col.width });
        x += col.width;
      }
      y += rowHeight;
    };
    drawHeader();

    for (const docRow of rows) {
      if (y > doc.page.height - 50) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
      }
      const deviceName = names.get(docRow.deviceId.toString()) ?? "unknown";
      const cells = [
        docRow.detectedAt.toISOString().replace("T", " ").slice(0, 19),
        deviceName,
        String(docRow.scaledSpeedKmh),
        String(docRow.limitKmh),
        docRow.severity,
        docRow.direction,
        docRow.plate ?? "—",
        docRow.review.status,
        docRow.fine ? `${docRow.fine.amount} (${docRow.fine.status})` : "—",
      ];
      let x = x0;
      doc.font("Helvetica").fontSize(8).fillColor("#222");
      cells.forEach((cell, i) => {
        doc.text(cell, x, y, { width: cols[i]!.width - 4, ellipsis: true, height: rowHeight });
        x += cols[i]!.width;
      });
      y += rowHeight;
    }

    doc.end();
  })
);
