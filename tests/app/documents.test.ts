import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDocument, documentStoragePath, maximumDocumentSizeBytes } from '../../src/lib/documents.ts';

const ownerId = '11111111-1111-1111-1111-111111111111';

test('Accepted documents get the content type the bucket expects, whatever the browser says', () => {
  assert.deepEqual(checkDocument({ name: 'Proposal.PDF', size: 2048 }), { contentType: 'application/pdf' });
  assert.deepEqual(checkDocument({ name: 'pricing.xlsx', size: 2048 }), {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
});

test('Unaccepted, disguised, empty and oversized files are refused with a reason', () => {
  const refused = [
    { name: 'macros.xls', size: 10 },
    { name: 'proposal.pdf.exe', size: 10 },
    { name: 'no-extension', size: 10 },
    { name: 'empty.pdf', size: 0 },
    { name: 'huge.pdf', size: maximumDocumentSizeBytes + 1 },
  ];
  for (const file of refused) {
    const outcome = checkDocument(file);
    assert.ok('problem' in outcome, `should refuse ${file.name}`);
  }
});

test("A storage path always sits in the owner's folder and cannot climb out of it", () => {
  const path = documentStoragePath(ownerId, '../../other-user/secret.pdf');
  assert.ok(path.startsWith(`${ownerId}/`));
  assert.equal(path.split('/').length, 2, 'no extra folder levels');
  assert.ok(!path.includes('..'));
});

test('Unsafe characters are replaced and very long names are shortened', () => {
  const path = documentStoragePath(ownerId, `<script>${'a'.repeat(500)}.pdf`);
  const storedName = path.split('/')[1] ?? '';
  assert.ok(!/[<>]/.test(storedName));
  assert.ok(storedName.endsWith('.pdf'));
  assert.ok(storedName.length < 200);
});
