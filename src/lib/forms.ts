/**
 * The forms engine's rules (PRD P1-11). A form is data: a form_definitions row whose schema lists its
 * fields, so the client's forms can be added without interface code. These mirror
 * private.form_data_problems, so the screen shows the same problems the database would refuse with.
 */

/** A column of a table field. */
export type FormColumn = { name: string; label: string; type: 'text' | 'number'; required?: boolean; maxLength?: number; minimum?: number };

/**
 * One field of a form. A table has rows of columns, an optional per-row total and an optional grand total.
 * A choice is one of its options; checkboxes are any of them, stored as a list. A section only groups
 * fields under a heading.
 */
export type FormField = {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'email' | 'date' | 'number' | 'table' | 'choice' | 'checkboxes';
  section?: string;
  options?: string[];
  required?: boolean;
  maxLength?: number;
  minimum?: number;
  columns?: FormColumn[];
  lineTotal?: { label: string; multiply?: string[]; add?: string[] };
  grandTotal?: { label: string };
};

export type FormSchema = { description?: string; fields: FormField[] };
export type FormRow = Record<string, string | number | null>;
export type FormData = Record<string, string | number | string[] | FormRow[] | null>;

const maximumTableRows = 200;
const defaultMaximumLength: Record<string, number> = { textarea: 10_000, text: 500, email: 500, date: 500 };
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

/** Reads a stored schema defensively: anything that isn't a list of named fields becomes an empty form. */
export function readSchema(stored: unknown): FormSchema {
  if (!stored || typeof stored !== 'object' || !Array.isArray((stored as FormSchema).fields)) {
    return { fields: [] };
  }
  const schema = stored as FormSchema;
  return { ...schema, fields: schema.fields.filter((field) => typeof field?.name === 'string' && typeof field.label === 'string') };
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
}

/** A real calendar date written as YYYY-MM-DD. Round-trips it, because JavaScript quietly turns 30 February into 2 March. */
function isRealDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function valueProblem(field: FormColumn | FormField, value: unknown): string | null {
  if (field.type === 'choice' || field.type === 'checkboxes') {
    const options = 'options' in field ? (field.options ?? []) : [];
    if (field.type === 'choice') {
      return typeof value === 'string' && options.includes(value) ? null : `${field.label} must be one of the listed options.`;
    }
    if (!Array.isArray(value)) return `${field.label} must be a list of the listed options.`;
    return value.every((chosen) => typeof chosen === 'string' && options.includes(chosen)) ? null : `${field.label} must only contain the listed options.`;
  }
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${field.label} must be a number.`;
    if (field.minimum !== undefined && value < field.minimum) return `${field.label} must be at least ${field.minimum}.`;
    return null;
  }
  if (typeof value !== 'string') return `${field.label} must be text.`;
  const maximumLength = field.maxLength ?? defaultMaximumLength[field.type] ?? 500;
  if (value.length > maximumLength) return `${field.label} must be at most ${maximumLength} characters.`;
  if (field.type === 'email' && !emailPattern.test(value)) return `${field.label} must be an email address.`;
  if (field.type === 'date' && !isRealDate(value)) {
    return `${field.label} must be a date like 2026-11-30.`;
  }
  return null;
}

/**
 * Every problem with a form's data, in plain English. requireComplete also checks required fields,
 * as the database does when a form is attached to a published tender or a submitted bid.
 */
export function formProblems(schema: FormSchema, data: FormData, requireComplete: boolean): string[] {
  const problems: string[] = [];
  for (const field of schema.fields) {
    const value = data[field.name];
    if (isEmpty(value)) {
      if (requireComplete && field.required) problems.push(`${field.label} is required.`);
      continue;
    }
    if (field.type !== 'table') {
      const problem = valueProblem(field, value);
      if (problem) problems.push(problem);
      continue;
    }
    if (!Array.isArray(value)) {
      problems.push(`${field.label} must be a list of rows.`);
      continue;
    }
    if (value.length > maximumTableRows) problems.push(`${field.label} can have at most ${maximumTableRows} rows.`);
    value.forEach((row, index) => {
      if (!isRow(row)) {
        problems.push(`Row ${index + 1} of ${field.label} is not in the expected format.`);
        return;
      }
      for (const column of field.columns ?? []) {
        const cell = row[column.name];
        if (isEmpty(cell)) {
          if (requireComplete && column.required) problems.push(`Row ${index + 1} of ${field.label}: ${column.label} is required.`);
          continue;
        }
        const problem = valueProblem(column, cell);
        if (problem) problems.push(`Row ${index + 1} of ${field.label}: ${problem}`);
      }
    });
  }
  return problems;
}

function isRow(row: unknown): row is FormRow {
  return typeof row === 'object' && row !== null && !Array.isArray(row);
}

/** A table field's rows; a value that isn't a list of rows reads as no rows. */
export function tableRows(value: FormData[string] | undefined): FormRow[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

/** A row's total: the product of the "multiply" columns plus the "add" columns (empty cells count as zero). */
export function lineTotal(row: FormRow, rule: NonNullable<FormField['lineTotal']>): number {
  const numberIn = (column: string): number => (typeof row[column] === 'number' ? (row[column] as number) : 0);
  const product = (rule.multiply ?? []).reduce((total, column) => total * numberIn(column), (rule.multiply ?? []).length > 0 ? 1 : 0);
  return (rule.add ?? []).reduce((total, column) => total + numberIn(column), product);
}

/** Whether a table shows a per-row total column. A total that only repeats one column is shown as the grand total alone. */
export function showsLineTotal(rule: FormField['lineTotal']): boolean {
  if (!rule) return false;
  return !((rule.add ?? []).length === 1 && (rule.multiply ?? []).length === 0);
}

/** The sum of every row's total. */
export function grandTotal(rows: FormRow[], rule: NonNullable<FormField['lineTotal']>): number {
  return rows.reduce((total, row) => total + lineTotal(row, rule), 0);
}

/** Reads a typed number, allowing thousands commas ("1,500,000"); null for an empty or unreadable entry. */
export function readNumber(text: string): number | null {
  const withoutCommas = text.replaceAll(',', '').trim();
  const parsed = Number(withoutCommas);
  return withoutCommas === '' || !Number.isFinite(parsed) ? null : parsed;
}

/**
 * What a number box shows: what the person typed while it still reads as the stored value (so "12." stays
 * on screen and the decimal point can be typed), otherwise the stored value, such as a loaded draft's.
 */
export function numberFieldText(typed: string, value: number | null): string {
  if (readNumber(typed) === value) return typed;
  return value === null ? '' : String(value);
}

/** A value as it reads on screen and in the PDF. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return new Intl.NumberFormat('en-JM', { maximumFractionDigits: 2 }).format(value);
  return String(value);
}
