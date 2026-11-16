/** Fills in, shows and downloads a form defined as data (PRD P1-11); no form needs its own interface code. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { displayValue, grandTotal, lineTotal, readSchema, type FormData, type FormField, type FormRow, type FormSchema } from '../lib/forms.ts';
import { errorMessage, supabase } from '../lib/supabase.ts';
import { Notice } from './Notices.tsx';

/** The newest active version of a form, with its schema read defensively. */
export function useFormDefinition(formKey: string) {
  return useQuery({
    queryKey: ['form-definition', formKey],
    queryFn: async () => {
      const { data, error } = await supabase.from('form_definitions').select('*').eq('key', formKey).eq('is_active', true).order('version', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data ? { ...data, parsedSchema: readSchema(data.schema) } : null;
    },
  });
}

const inputTypes: Partial<Record<FormField['type'], string>> = { text: 'text', email: 'email', date: 'date' };
const downloadLinkLifetimeMilliseconds = 60_000;

/** Starts a browser download of PDF bytes made in the page. */
function savePdf(bytes: Uint8Array, fileName: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  link.download = fileName;
  link.click();
  // The click has started the download; the in-memory copy can go once the browser has it.
  setTimeout(() => URL.revokeObjectURL(link.href), downloadLinkLifetimeMilliseconds);
}

/** Reads a typed number, or null for an empty or unreadable entry. */
function numberOrNull(text: string): number | null {
  const parsed = Number(text);
  return text.trim() === '' || !Number.isFinite(parsed) ? null : parsed;
}

function TableField({ field, rows, onChange, idPrefix }: { field: FormField; rows: FormRow[]; onChange: (rows: FormRow[]) => void; idPrefix: string }) {
  const columns = field.columns ?? [];
  const setCell = (rowIndex: number, column: string, value: string | number | null) =>
    onChange(rows.map((row, index) => (index === rowIndex ? { ...row, [column]: value } : row)));
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column.name} scope="col">{column.label}</th>)}
            {field.lineTotal && <th scope="col">{field.lineTotal.label}</th>}
            <th scope="col"><span className="visually-hidden">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column.name}>
                  <input
                    aria-label={`${column.label}, row ${rowIndex + 1}`}
                    id={`${idPrefix}-${rowIndex}-${column.name}`}
                    inputMode={column.type === 'number' ? 'decimal' : undefined}
                    maxLength={column.maxLength}
                    value={row[column.name] ?? ''}
                    onChange={(event) => setCell(rowIndex, column.name, column.type === 'number' ? numberOrNull(event.target.value) : event.target.value)}
                  />
                </td>
              ))}
              {field.lineTotal && <td>{displayValue(lineTotal(row, field.lineTotal))}</td>}
              <td><button type="button" className="link-button" onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-outline" onClick={() => onChange([...rows, {}])}>Add a row</button>
      {field.lineTotal && field.grandTotal && <p><strong>{field.grandTotal.label}: {displayValue(grandTotal(rows, field.lineTotal))}</strong></p>}
    </div>
  );
}

/** Inputs for every field of a form. */
export function FormFields({ schema, data, onChange, idPrefix = 'form' }: { schema: FormSchema; data: FormData; onChange: (data: FormData) => void; idPrefix?: string }) {
  return (
    <>
      {schema.description && <Notice>{schema.description}</Notice>}
      {schema.fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const value = data[field.name];
        const set = (next: FormData[string]) => onChange({ ...data, [field.name]: next });
        return (
          <div key={field.name}>
            <label htmlFor={id}>{field.label}{field.required ? '' : ' (optional)'}</label>
            {field.type === 'table' ? (
              <TableField field={field} rows={Array.isArray(value) ? value : []} onChange={set} idPrefix={id} />
            ) : field.type === 'textarea' ? (
              <textarea id={id} rows={5} maxLength={field.maxLength} value={typeof value === 'string' ? value : ''} onChange={(event) => set(event.target.value)} />
            ) : field.type === 'number' ? (
              <input id={id} inputMode="decimal" value={value === null || value === undefined ? '' : String(value)} onChange={(event) => set(numberOrNull(event.target.value))} />
            ) : (
              <input id={id} type={inputTypes[field.type] ?? 'text'} maxLength={field.maxLength} value={typeof value === 'string' ? value : ''} onChange={(event) => set(event.target.value)} />
            )}
          </div>
        );
      })}
    </>
  );
}

/** A filled-in form, read-only. Fields the schema doesn't know (an older version) are listed as they were saved. */
export function FormAnswers({ schema, data }: { schema: FormSchema; data: FormData }) {
  const known = new Set(schema.fields.map((field) => field.name));
  const unknownKeys = Object.keys(data).filter((key) => !known.has(key));
  return (
    <dl className="details">
      {schema.fields.map((field) => {
        const value = data[field.name];
        if (field.type !== 'table') {
          return [<dt key={`${field.name}-label`}>{field.label}</dt>, <dd key={field.name} className="preserve-lines">{displayValue(value) || '—'}</dd>];
        }
        const rows: FormRow[] = Array.isArray(value) ? value : [];
        return [
          <dt key={`${field.name}-label`}>{field.label}</dt>,
          <dd key={field.name}>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    {(field.columns ?? []).map((column) => <th key={column.name} scope="col">{column.label}</th>)}
                    {field.lineTotal && <th scope="col">{field.lineTotal.label}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>
                      {(field.columns ?? []).map((column) => <td key={column.name}>{displayValue(row[column.name])}</td>)}
                      {field.lineTotal && <td>{displayValue(lineTotal(row, field.lineTotal))}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {field.lineTotal && field.grandTotal && <strong>{field.grandTotal.label}: {displayValue(grandTotal(rows, field.lineTotal))}</strong>}
          </dd>,
        ];
      })}
      {unknownKeys.map((key) => [<dt key={`${key}-label`}>{key}</dt>, <dd key={key}>{typeof data[key] === 'object' ? JSON.stringify(data[key]) : displayValue(data[key])}</dd>])}
    </dl>
  );
}

/** Generates the PDF from the saved data when clicked; the PDF code loads only then. */
export function PdfButton({ title, schema, data, fileName, notes = [] }: { title: string; schema: FormSchema; data: FormData; fileName: string; notes?: string[] }) {
  const [problem, setProblem] = useState<string | null>(null);
  async function download() {
    setProblem(null);
    try {
      const { formToPdf } = await import('../lib/formPdf.ts');
      savePdf(await formToPdf(title, schema, data, notes), fileName);
    } catch (error) {
      setProblem(errorMessage(error));
    }
  }
  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => void download()}>Download as PDF</button>
      {problem && <Notice tone="error">{problem}</Notice>}
    </>
  );
}

/** A saved form attached to a tender or bid: the answers under the exact version it was filled in with, and its PDF. */
export function AttachedForm({ formKey, formVersion, data, notes = [] }: { formKey: string; formVersion: number; data: FormData; notes?: string[] }) {
  const definitionQuery = useQuery({
    queryKey: ['form-definition', formKey, formVersion],
    queryFn: async () => {
      // Only active versions are readable; an answer saved under a retired one shows its fields as saved.
      const { data: definition, error } = await supabase.from('form_definitions').select('title, schema').eq('key', formKey).eq('version', formVersion).maybeSingle();
      if (error) throw error;
      return { title: definition?.title ?? formKey, schema: readSchema(definition?.schema) };
    },
  });
  if (!definitionQuery.data) return null;
  const { title, schema } = definitionQuery.data;
  return (
    <div className="card">
      <h4>{title}</h4>
      <FormAnswers schema={schema} data={data} />
      <PdfButton title={title} schema={schema} data={data} fileName={`${formKey}.pdf`} notes={notes} />
    </div>
  );
}
