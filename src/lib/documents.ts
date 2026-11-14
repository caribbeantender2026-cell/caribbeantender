/** Rules for uploaded documents, matching the storage buckets' size limit and allowed file types. */

const bytesPerMegabyte = 1024 * 1024;
const maximumDocumentSizeMegabytes = 10;
export const maximumDocumentSizeBytes = maximumDocumentSizeMegabytes * bytesPerMegabyte;
const maximumStoredFileNameLength = 100;

// The same types the buckets accept (PRD P1-06; AUDIT.md A5 includes .xls).
const contentTypesByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** The file chooser's accept list, for example ".pdf,.doc,.docx,.xls,.xlsx". */
export const acceptedDocumentExtensions = Object.keys(contentTypesByExtension)
  .map((extension) => `.${extension}`)
  .join(',');

/** A human description of the accepted documents, for help text and error messages. */
export const acceptedDocumentDescription = `PDF, Word (.doc, .docx) or Excel (.xls, .xlsx), up to ${maximumDocumentSizeMegabytes} MB`;

/**
 * Checks a chosen file and returns the content type to upload it with, or a plain-English problem.
 * The content type comes from the extension because browsers leave File.type empty for some files.
 */
export function checkDocument(file: { name: string; size: number }): { contentType: string } | { problem: string } {
  const extension = file.name.includes('.') ? (file.name.split('.').pop() ?? '').toLowerCase() : '';
  const contentType = contentTypesByExtension[extension];
  if (!contentType) {
    return { problem: `"${file.name}" is not an accepted document. Upload ${acceptedDocumentDescription}.` };
  }
  if (file.size === 0) {
    return { problem: `"${file.name}" is empty. Choose the document again.` };
  }
  if (file.size > maximumDocumentSizeBytes) {
    return { problem: `"${file.name}" is larger than ${maximumDocumentSizeMegabytes} MB. Upload a smaller file.` };
  }
  return { contentType };
}

/** A file name reduced to safe characters; it becomes the document's name once the tender or bid is recorded. */
function safeFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .slice(-maximumStoredFileNameLength);
  return cleaned || 'document';
}

/**
 * Where a tender's file goes: tender-documents/{tender id}/..., with an uploaded requirements form in
 * requirements-form/ (the storage policies and publish_tender expect exactly this).
 */
export function tenderDocumentPath(tenderId: string, fileName: string, isRequirementsForm: boolean): string {
  return `${tenderId}/${isRequirementsForm ? 'requirements-form/' : ''}${safeFileName(fileName)}`;
}

/** Where a bid's file goes: bid-documents/{tender id}/{bid id}/..., with an uploaded proposal in proposal/ (submit_bid expects this). */
export function bidDocumentPath(tenderId: string, bidId: string, fileName: string, isProposal: boolean): string {
  return `${tenderId}/${bidId}/${isProposal ? 'proposal/' : ''}${safeFileName(fileName)}`;
}
