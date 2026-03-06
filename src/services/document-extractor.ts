import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

const MAX_CHARS = 12_000;

/**
 * Extracts plain text from a PDF, DOCX, or TXT file.
 * Output is truncated to MAX_CHARS to keep token usage reasonable.
 */
export async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  let text: string;

  if (ext === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    const result = await pdfParse(buffer);
    text = result.text;
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value;
  } else {
    // .txt or any other text-based format
    text = fs.readFileSync(filePath, "utf-8");
  }

  return text.trim().slice(0, MAX_CHARS);
}
