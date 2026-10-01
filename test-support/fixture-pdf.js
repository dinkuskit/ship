const textLines = [
  "FIXTURE PROOF - NO LIVE PB API",
  "TEST ONLY - DO NOT MAIL",
  "SYNTHETIC USPS PRIORITY MAIL",
  "SHIPMENT: FIXTURE-SHIPMENT",
  "FROM: SYNTHETIC SENDER / SHELTON CT 06484",
  "TO: SYNTHETIC RECIPIENT / BERWICK ME 03901",
  "SERVICE: PM   PRICE: USD 8.60",
];

function pdfString(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export function createFixturePdf() {
  const content = [
    "BT",
    "/F1 18 Tf",
    "50 740 Td",
    `(${pdfString(textLines[0])}) Tj`,
    "/F1 13 Tf",
    "0 -28 Td",
    `(${pdfString(textLines[1])}) Tj`,
    "/F1 11 Tf",
    "0 -42 Td",
    `(${pdfString(textLines[2])}) Tj`,
    "0 -22 Td",
    `(${pdfString(textLines[3])}) Tj`,
    "0 -18 Td",
    `(${pdfString(textLines[4])}) Tj`,
    "0 -18 Td",
    `(${pdfString(textLines[5])}) Tj`,
    "0 -18 Td",
    `(${pdfString(textLines[6])}) Tj`,
    "0 -34 Td",
    "0 0 0 RG",
    "2 w",
    "0 0 m",
    "510 0 l",
    "510 120 l",
    "0 120 l",
    "h",
    "S",
    "ET",
    "",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}endstream`,
  ];
  const chunks = ["%PDF-1.4\n% fixture\n"];
  const offsets = [0];
  let length = Buffer.byteLength(chunks[0], "ascii");
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(length);
    const object = `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
    chunks.push(object);
    length += Buffer.byteLength(object, "ascii");
  }
  const xrefOffset = length;
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n");
  chunks.push(xref);
  return Buffer.from(chunks.join(""), "ascii");
}

export { textLines as fixturePdfTextLines };
