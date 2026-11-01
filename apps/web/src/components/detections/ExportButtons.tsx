import { Download, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { apiDownload, qs, saveBlob, type QueryValue } from "../../lib/api";

/** CSV / PDF export — authenticated fetch + blob download (Bearer cannot be set on <a href>). */
export function ExportButtons({ filters }: { filters: Record<string, QueryValue> }) {
  const [busy, setBusy] = useState<"csv" | "pdf" | null>(null);

  const download = async (kind: "csv" | "pdf"): Promise<void> => {
    setBusy(kind);
    try {
      const { blob, filename } = await apiDownload(`/export/detections.${kind}${qs(filters)}`);
      saveBlob(blob, filename);
      toast.success(`Exported ${filename}`);
    } catch {
      toast.error("Export failed");
    } finally {
      setBusy(null);
    }
  };

  const canExport = busy !== null; // keep buttons disabled while any export runs
  return (
    <>
      <Button variant="outline" size="sm" disabled={canExport} onClick={() => void download("csv")}>
        {busy === "csv" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        CSV
      </Button>
      <Button variant="outline" size="sm" disabled={canExport} onClick={() => void download("pdf")}>
        {busy === "pdf" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FileText className="h-3.5 w-3.5" />
        )}
        PDF
      </Button>
    </>
  );
}
