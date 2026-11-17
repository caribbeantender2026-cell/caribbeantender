/**
 * Renders a filled-in form as a PDF at download time, from the saved data, so no PDF is ever stored
 * (PRD P1-11; OPEN_QUESTIONS.md, item 14). Loaded only when someone downloads a form.
 */
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { displayValue, grandTotal, lineTotal, showsLineTotal, tableRows, type FormData, type FormSchema } from './forms.ts';

// A4 in PDF points.
const pageWidth = 595.28;
const pageHeight = 841.89;
const marginPoints = 50;
const lineGapPoints = 4;
const titleSizePoints = 16;
const noteSizePoints = 9;
const bodySizePoints = 10;
const fieldGapPoints = 8;
const winAnsiExtras = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

/** Helvetica can only draw WinAnsi characters; anything else (emoji, most non-Latin scripts) becomes "?". */
export function pdfSafeText(text: string): string {
  // NFC first: "e" plus a combining accent becomes the single "é" Helvetica can draw.
  return Array.from(text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    '))
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      const isWinAnsi = (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || winAnsiExtras.includes(character);
      return character === '\n' || isWinAnsi ? character : '?';
    })
    .join('');
}

/** Splits text into lines that fit the page width, breaking words that are longer than a line. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafeText(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        if (font.widthOfTextAtSize(line + character, size) > width) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The form as a PDF: title, notes, then every field's label and answer; table rows with their totals. */
export async function formToPdf(title: string, schema: FormSchema, data: FormData, notes: string[] = []): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(pdfSafeText(title));
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = document.addPage([pageWidth, pageHeight]);
  let cursor = pageHeight - marginPoints;

  const write = (text: string, font: PDFFont, size: number) => {
    for (const line of wrap(text, font, size, pageWidth - 2 * marginPoints)) {
      if (cursor - size < marginPoints) {
        page = document.addPage([pageWidth, pageHeight]);
        cursor = pageHeight - marginPoints;
      }
      page.drawText(line, { x: marginPoints, y: cursor - size, size, font });
      cursor -= size + lineGapPoints;
    }
  };

  write(title, bold, titleSizePoints);
  for (const note of [schema.description ?? '', ...notes].filter(Boolean)) write(note, regular, noteSizePoints);
  for (const [index, field] of schema.fields.entries()) {
    if (field.section && field.section !== schema.fields[index - 1]?.section) {
      cursor -= fieldGapPoints;
      write(field.section.toUpperCase(), bold, noteSizePoints);
    }
    cursor -= fieldGapPoints;
    write(field.label, bold, bodySizePoints);
    const value = data[field.name];
    if (field.type !== 'table') {
      write(displayValue(value) || '—', regular, bodySizePoints);
      continue;
    }
    const rows = tableRows(value);
    if (rows.length === 0) write('—', regular, bodySizePoints);
    rows.forEach((row, index) => {
      const cells = (field.columns ?? []).map((column) => `${column.label}: ${displayValue(row[column.name]) || '—'}`);
      if (field.lineTotal && showsLineTotal(field.lineTotal)) cells.push(`${field.lineTotal.label}: ${displayValue(lineTotal(row, field.lineTotal))}`);
      write(`${index + 1}. ${cells.join(' · ')}`, regular, bodySizePoints);
    });
    if (field.lineTotal && field.grandTotal) {
      write(`${field.grandTotal.label}: ${displayValue(grandTotal(rows, field.lineTotal))}`, bold, bodySizePoints);
    }
  }
  return document.save();
}
