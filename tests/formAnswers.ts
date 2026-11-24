/**
 * Valid answers for a form definition's required fields, so tests can fill in any of the client's forms.
 * Shared by the in-memory database tests and the live and browser tests, so it has no dependencies.
 */
export type FormField = { name: string; type: string; required?: boolean; options?: string[]; columns?: FormField[] };

/** A valid answer for any field type the form engine knows. */
function answerFor(field: FormField): unknown {
  switch (field.type) {
    case 'email':
      return 'test@example.com';
    case 'date':
      return '2026-11-16';
    case 'number':
      return 1;
    case 'choice':
      return field.options?.[0];
    case 'checkboxes':
      return [field.options?.[0]];
    case 'table':
      return [Object.fromEntries((field.columns ?? []).map((column) => [column.name, answerFor(column)]))];
    default:
      return 'Test answer';
  }
}

/** Every required field of a form, each with a valid answer. */
export function requiredAnswers(fields: FormField[]): Record<string, unknown> {
  return Object.fromEntries(fields.filter((field) => field.required).map((field) => [field.name, answerFor(field)]));
}
