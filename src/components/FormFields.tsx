/** Fills in, shows and downloads a form defined as data (PRD P1-11); no form needs its own interface code. */
import { Fragment, useState, type ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { classNames } from '../lib/classNames.ts';
import { displayValue, grandTotal, isShown, lineTotal, numberFieldText, readNumber, readSchema, showsLineTotal, tableRows, type FormData, type FormField, type FormRow, type FormSchema } from '../lib/forms.ts';
import { errorMessage, supabase } from '../lib/supabase.ts';
import { ErrorNotice, Notice } from './Notices.tsx';
import { Button } from './ui/button.tsx';
import { Choice, Field, Input, Textarea } from './ui/fields.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.tsx';

/**
 * One version of a form (the newest active one when no version is given), with its schema read
 * defensively. A saved form must be shown and edited with the version it was saved under.
 */
export function useFormDefinition(formKey: string, version?: number) {
  return useQuery({
    queryKey: ['form-definition', formKey, version ?? 'newest'],
    queryFn: async () => {
      // Only active versions are readable.
      const request = supabase.from('form_definitions').select('*').eq('key', formKey).eq('is_active', true);
      const { data, error } = await (version === undefined ? request.order('version', { ascending: false }).limit(1) : request.eq('version', version)).maybeSingle();
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

/** A number box that keeps what was typed on screen ("12.", "1,500") while storing the number it reads as. */
function NumberInput({ value, onChange, ...properties }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & { value: unknown; onChange: (value: number | null) => void }) {
  const [typed, setTyped] = useState('');
  return (
    <Input
      inputMode="decimal"
      {...properties}
      value={numberFieldText(typed, typeof value === 'number' ? value : null)}
      onChange={(event) => {
        setTyped(event.target.value);
        onChange(readNumber(event.target.value));
      }}
    />
  );
}

function TableField({ field, rows, onChange, idPrefix }: { field: FormField; rows: FormRow[]; onChange: (rows: FormRow[]) => void; idPrefix: string }) {
  const columns = field.columns ?? [];
  const setCell = (rowIndex: number, column: string, value: string | number | null) =>
    onChange(rows.map((row, index) => (index === rowIndex ? { ...row, [column]: value } : row)));
  return (
    <div className="grid min-w-0 gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => <TableHead key={column.name} scope="col">{column.label}</TableHead>)}
            {field.lineTotal && showsLineTotal(field.lineTotal) && <TableHead scope="col">{field.lineTotal.label}</TableHead>}
            <TableHead scope="col"><span className="sr-only">Remove</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
              {columns.map((column) => {
                const cellLabel = `${column.label}, row ${rowIndex + 1}`;
                const cellId = `${idPrefix}-${rowIndex}-${column.name}`;
                return (
                  <TableCell key={column.name}>
                    {column.type === 'number' ? (
                      <NumberInput aria-label={cellLabel} id={cellId} value={row[column.name]} onChange={(value) => setCell(rowIndex, column.name, value)} />
                    ) : (
                      <Input aria-label={cellLabel} id={cellId} type={inputTypes[column.type]} maxLength={column.maxLength} value={row[column.name] ?? ''} onChange={(event) => setCell(rowIndex, column.name, event.target.value)} />
                    )}
                  </TableCell>
                );
              })}
              {field.lineTotal && showsLineTotal(field.lineTotal) && <TableCell>{displayValue(lineTotal(row, field.lineTotal))}</TableCell>}
              <TableCell>
                <button
                  type="button"
                  className="cursor-pointer font-medium text-primary underline underline-offset-4 disabled:cursor-wait disabled:text-muted-foreground"
                  onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}
                >
                  Remove
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button variant="outline" type="button" className="justify-self-start" onClick={() => onChange([...rows, {}])}>Add a row</Button>
      {field.lineTotal && field.grandTotal && <p><strong>{field.grandTotal.label}: {displayValue(grandTotal(rows, field.lineTotal))}</strong></p>}
    </div>
  );
}

/** Inputs for every field of a form. */
export function FormFields({ schema, data, onChange, idPrefix = 'form' }: { schema: FormSchema; data: FormData; onChange: (data: FormData) => void; idPrefix?: string }) {
  return (
    // min-w-0 here and on the table wrappers lets a wide table scroll inside its card instead of stretching the grids around it.
    <div className="grid min-w-0 gap-4">
      {schema.description && <Notice>{schema.description}</Notice>}
      {schema.fields.map((field, index) => {
        if (!isShown(field, data)) return null;
        const id = `${idPrefix}-${field.name}`;
        const value = data[field.name];
        const set = (next: FormData[string]) => onChange({ ...data, [field.name]: next });
        const label = `${field.label}${field.required ? '' : ' (optional)'}`;
        const startsSection = field.section && field.section !== schema.fields[index - 1]?.section;
        // A section that opens the form needs no gap above it; later ones are set apart from the fields before.
        const heading = startsSection ? <h3 className={classNames('border-b pb-2 text-base font-semibold text-navy-dark', index > 0 && 'mt-6')}>{field.section}</h3> : null;
        if (field.type === 'choice' || field.type === 'checkboxes') {
          const isChoice = field.type === 'choice';
          const chosen = isChoice ? (typeof value === 'string' ? [value] : []) : Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
          return (
            <Fragment key={field.name}>
              {heading}
              <fieldset className="rounded-md border px-4 pt-1 pb-3">
                <legend className="px-1 text-sm font-medium">{label}</legend>
                {(field.options ?? []).map((option, optionIndex) => (
                  <Choice
                    key={option}
                    className="mt-3"
                    id={`${id}-${optionIndex}`}
                    type={isChoice ? 'radio' : 'checkbox'}
                    name={id}
                    checked={chosen.includes(option)}
                    onChange={(event) => set(isChoice ? option : event.target.checked ? [...chosen, option] : chosen.filter((item) => item !== option))}
                  >
                    {option}
                  </Choice>
                ))}
              </fieldset>
            </Fragment>
          );
        }
        return (
          <Fragment key={field.name}>
            {heading}
            <Field label={label} htmlFor={id}>
              {field.type === 'table' ? (
                <TableField field={field} rows={tableRows(value)} onChange={set} idPrefix={id} />
              ) : field.type === 'textarea' ? (
                <Textarea id={id} rows={5} maxLength={field.maxLength} value={typeof value === 'string' ? value : ''} onChange={(event) => set(event.target.value)} />
              ) : field.type === 'number' ? (
                <NumberInput id={id} value={value} onChange={set} />
              ) : (
                <Input id={id} type={inputTypes[field.type] ?? 'text'} maxLength={field.maxLength} value={typeof value === 'string' ? value : ''} onChange={(event) => set(event.target.value)} />
              )}
            </Field>
          </Fragment>
        );
      })}
    </div>
  );
}

/** A filled-in form, read-only. Fields the schema doesn't know (an older version) are listed as they were saved. */
export function FormAnswers({ schema, data }: { schema: FormSchema; data: FormData }) {
  const known = new Set(schema.fields.map((field) => field.name));
  const unknownKeys = Object.keys(data).filter((key) => !known.has(key));
  return (
    // Labels stack above answers on phones and wrap at a set width on wider screens; the client's labels run to 100 characters.
    <dl className="my-3 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-y-2 [&>dt]:text-muted-foreground">
      {schema.fields.filter((field) => isShown(field, data)).map((field) => {
        const value = data[field.name];
        if (field.type !== 'table') {
          return [<dt key={`${field.name}-label`}>{field.label}</dt>, <dd key={field.name} className="whitespace-pre-line">{displayValue(value) || '—'}</dd>];
        }
        const rows = tableRows(value);
        return [
          <dt key={`${field.name}-label`}>{field.label}</dt>,
          <dd key={field.name} className="min-w-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {(field.columns ?? []).map((column) => <TableHead key={column.name} scope="col">{column.label}</TableHead>)}
                  {field.lineTotal && showsLineTotal(field.lineTotal) && <TableHead scope="col">{field.lineTotal.label}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={index}>
                    {(field.columns ?? []).map((column) => <TableCell key={column.name}>{displayValue(row[column.name])}</TableCell>)}
                    {field.lineTotal && showsLineTotal(field.lineTotal) && <TableCell>{displayValue(lineTotal(row, field.lineTotal))}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
      <Button variant="outline" type="button" onClick={() => void download()}>Download as PDF</Button>
      {problem && <Notice tone="error">{problem}</Notice>}
    </>
  );
}

/** A saved form attached to a tender or bid: the answers under the exact version it was filled in with, and its PDF. */
export function AttachedForm({ formKey, formVersion, data, notes = [] }: { formKey: string; formVersion: number; data: FormData; notes?: string[] }) {
  const definitionQuery = useFormDefinition(formKey, formVersion);
  if (definitionQuery.isError) return <ErrorNotice error={definitionQuery.error} />;
  if (definitionQuery.isPending) return null;
  // An answer saved under a retired version shows its fields as saved.
  const title = definitionQuery.data?.title ?? formKey;
  const schema = definitionQuery.data?.parsedSchema ?? { fields: [] };
  return (
    <div className="mt-4 rounded-lg border p-4">
      <h4 className="mb-2 font-semibold">{title}</h4>
      <FormAnswers schema={schema} data={data} />
      <PdfButton title={title} schema={schema} data={data} fileName={`${formKey}.pdf`} notes={notes} />
    </div>
  );
}
