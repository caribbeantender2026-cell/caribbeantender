import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bidDocumentPath, bidUploadRule, checkDocument, draftUploadRule, maximumDocumentSizeBytes, sameStoredName, tenderDocumentPath, uploadProblem } from '../../src/lib/documents.ts';

const tenderId = '11111111-1111-1111-1111-111111111111';
const bidId = '22222222-2222-2222-2222-222222222222';

test('Accepted documents get the content type the bucket expects, whatever the browser says', () => {
  assert.deepEqual(checkDocument({ name: 'Proposal.PDF', size: 2048 }), { contentType: 'application/pdf' });
  assert.deepEqual(checkDocument({ name: 'pricing.xlsx', size: 2048 }), {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  assert.deepEqual(checkDocument({ name: 'old-pricing.XLS', size: 2048 }), { contentType: 'application/vnd.ms-excel' });
});

test('Unaccepted, disguised, empty and oversized files are refused with a reason', () => {
  const refused = [
    { name: 'page.html', size: 10 },
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

test('Paths follow the folders the storage policies require and cannot climb out of them', () => {
  assert.equal(tenderDocumentPath(tenderId, 'Specification.pdf', false), `${tenderId}/Specification.pdf`);
  assert.equal(tenderDocumentPath(tenderId, 'Form.pdf', true), `${tenderId}/requirements-form/Form.pdf`);
  assert.equal(bidDocumentPath(tenderId, bidId, 'Offer.pdf', true), `${tenderId}/${bidId}/proposal/Offer.pdf`);
  assert.equal(bidDocumentPath(tenderId, bidId, 'Prices.xlsx', false), `${tenderId}/${bidId}/Prices.xlsx`);
  for (const path of [tenderDocumentPath(tenderId, '../../other/secret.pdf', false), bidDocumentPath(tenderId, bidId, '../../../x/y.pdf', false)]) {
    assert.ok(!path.includes('..'), path);
    assert.equal(path.split('/').length, path.startsWith(`${tenderId}/${bidId}`) ? 3 : 2, `no extra folder levels: ${path}`);
  }
  assert.equal(tenderDocumentPath(tenderId, '...', false), `${tenderId}/document`, 'a name of only dots');
});

test('Unsafe characters are replaced and very long names are shortened', () => {
  const path = tenderDocumentPath(tenderId, `<script>${'a'.repeat(500)}.pdf`, false);
  const storedName = path.split('/')[1] ?? '';
  assert.ok(!/[<>]/.test(storedName));
  assert.ok(storedName.endsWith('.pdf'));
  assert.ok(storedName.length < 200);
});

test('A storage refusal reads as the rule that was broken, not the security-policy text', () => {
  const refusal = { message: 'new row violates row-level security policy' };
  assert.equal(uploadProblem('Quote.pdf', refusal, draftUploadRule), `"Quote.pdf" was not uploaded. ${draftUploadRule}`);
  assert.equal(uploadProblem('Quote.pdf', refusal, bidUploadRule), `"Quote.pdf" was not uploaded. ${bidUploadRule}`);
  // Any other problem keeps its own message.
  assert.equal(uploadProblem('Quote.pdf', { message: 'Failed to fetch' }, draftUploadRule), '"Quote.pdf" was not uploaded: Failed to fetch');
});

test('Two chosen files that would be stored under the same name are found before anything uploads', () => {
  assert.equal(sameStoredName(['Quote (A).pdf', 'Quote [A].pdf', 'Other.pdf']), 'Quote [A].pdf');
  assert.equal(sameStoredName(['One.pdf', 'Two.pdf']), null);
});
