import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Extract plain text from an uploaded .txt or .pdf file. PDF parsing uses
 * pdf-parse and falls back gracefully with a clear message if it cannot read
 * the file (e.g. scanned/image-only PDFs).
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return jsonError("No file was uploaded.", 422);
    }
    if (file.size === 0) {
      return jsonError("The uploaded file is empty.", 422);
    }
    if (file.size > MAX_BYTES) {
      return jsonError("File is too large (max 5MB).", 413);
    }

    const name = file.name.toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    if (name.endsWith(".txt") || file.type === "text/plain") {
      const text = buffer.toString("utf-8").trim();
      if (!text) return jsonError("The text file had no readable content.", 422);
      return jsonOk({ text });
    }

    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      try {
        // Imported lazily so the dependency only loads when a PDF is uploaded.
        const pdfParse = (await import("pdf-parse")).default;
        const result = await pdfParse(buffer);
        const text = (result.text || "").trim();
        if (!text) {
          return jsonError(
            "Could not extract text from this PDF. It may be scanned/image-only — please paste the resume text instead.",
            422
          );
        }
        return jsonOk({ text });
      } catch {
        return jsonError(
          "Failed to parse the PDF. Please paste the resume text instead.",
          422
        );
      }
    }

    return jsonError("Unsupported file type. Upload a .txt or .pdf file.", 415);
  } catch (err) {
    return handleRouteError(err);
  }
}
