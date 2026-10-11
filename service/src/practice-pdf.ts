/** Keeps PDF text to printable ASCII so the hand-built document stays valid. */
function pdfText(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "?").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

/**
 * A one-page letter-size PDF for a TEST order's practice label. It is clearly
 * not postage: Pitney Bowes is never called and nothing can be mailed with it.
 */
export function practiceLabelPdf(lines: string[]): Uint8Array {
  const body = ["TEST - NOT POSTAGE", "PRACTICE LABEL - DO NOT MAIL", ...lines];
  const content = ["BT", "/F1 20 Tf", "50 730 Td", `(${pdfText(body[0]!)}) Tj`, "/F1 14 Tf", "0 -30 Td", `(${pdfText(body[1]!)}) Tj`, "/F1 11 Tf"];
  for (const line of body.slice(2)) content.push("0 -20 Td", `(${pdfText(line)}) Tj`);
  content.push("ET", "0 0 0 RG", "3 w", "40 380 532 380 re", "S", "");
  const stream = content.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
