/** Rules for uploaded documents, matching the storage buckets' size limit and allowed file types. */

const bytesPerMegabyte = 1024 * 1024;
const maximumDocumentSizeMegabytes = 10;
export const maximumDocumentSizeBytes = maximumDocumentSizeMegabytes * bytesPerMegabyte;
const maximumStoredFileNameLength = 100;

// The same types the buckets accept. Legacy .xls is left out on purpose: old binary Office files can carry macros.
const contentTypesByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** The file chooser's accept list, for example ".pdf,.doc,.docx,.xlsx". */
export const acceptedDocumentExtensions = Object.keys(contentTypesByExtension)
  .map((extension) => `.${extension}`)
  .join(',');

/** A human description of the accepted documents, for help text and error messages. */
export const acceptedDocumentDescription = `PDF, Word (.doc, .docx) or Excel (.xlsx), up to ${maximumDocumentSizeMegabytes} MB`;

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

/**
 * Builds the storage path for an upload: the owner's own folder (which the storage policies require),
 * a random id so names never collide, and the file name reduced to safe characters.
 */
export function documentStoragePath(ownerId: string, fileName: string): string {
  const safeFileName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .slice(-maximumStoredFileNameLength);
  return `${ownerId}/${crypto.randomUUID()}-${safeFileName || 'document'}`;
}
