// The generated PDF matches the data entered (PRD P1-11 AC), and odd input can't break the export.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { formToPdf, pdfSafeText } from '../../src/lib/formPdf.ts';
import type { FormSchema } from '../../src/lib/forms.ts';

/** The text drawn on a pdf-lib PDF: its content streams are deflated, and each Tj shows a hex string. */
function drawnText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const pieces: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      content = match[1] ?? '';
    }
    for (const shown of content.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) {
      pieces.push(Buffer.from(shown[1] ?? '', 'hex').toString('latin1'));
    }
  }
  return pieces.join('\n');
}

const schema: FormSchema = {
  description: 'DRAFT form',
  fields: [
    { name: 'need', label: 'Summary of what you need', type: 'textarea' },
    {
      name: 'costs',
      label: 'Cost breakdown',
      type: 'table',
      columns: [
        { name: 'item', label: 'Item', type: 'text' },
        { name: 'quantity', label: 'Quantity', type: 'number' },
        { name: 'unit_cost', label: 'Unit cost', type: 'number' },
      ],
      lineTotal: { label: 'Line total', multiply: ['quantity', 'unit_cost'] },
      grandTotal: { label: 'Grand total' },
    },
  ],
};

test('Every answer, row and total appears in the PDF', async () => {
  const bytes = await formToPdf('Supplier Proposal Form', schema, { need: '40 office chairs', costs: [{ item: 'Chair', quantity: 40, unit_cost: 2500 }, { item: 'Delivery', quantity: 1, unit_cost: 8000 }] }, ['Attached to bid 123']);
  const text = drawnText(bytes);
  for (const expected of ['Supplier Proposal Form', 'DRAFT form', 'Attached to bid 123', '40 office chairs', 'Item: Chair', 'Quantity: 40', 'Line total: 100,000', 'Item: Delivery', 'Grand total: 108,000']) {
    assert.ok(text.includes(expected), `missing "${expected}" in:\n${text}`);
  }
});

test('Text Helvetica cannot draw becomes "?" instead of breaking the export', async () => {
  assert.equal(pdfSafeText('Café “quoted” – €5 😀 中文\tend'), 'Café “quoted” – €5 ? ??    end');
  const bytes = await formToPdf('Emoji 😀 title', schema, { need: '😀 中文 ✓', costs: [] });
  assert.ok(drawnText(bytes).includes('? ?? ?'));
});

test('A very long answer wraps onto more pages, and a word longer than a line is broken', async () => {
  const longAnswer = `${'word '.repeat(4000)}${'x'.repeat(500)}`;
  const document = await PDFDocument.load(await formToPdf('Long form', schema, { need: longAnswer, costs: [] }));
  assert.ok(document.getPageCount() > 1, `pages: ${document.getPageCount()}`);
});
