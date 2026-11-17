/**
 * shadcn/ui form fields: label, input, textarea and a native select styled like shadcn's (kept native for
 * phones and tests), plus Field, which puts a label, its control and its error message together.
 */
import { ChevronDownIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { classNames } from '../../lib/classNames.ts';

const fieldClasses =
  'w-full min-w-0 rounded-md border border-input bg-card px-3 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm';

function Label({ className, ...properties }: ComponentProps<'label'>) {
  return <label data-slot="label" className={classNames('flex items-center gap-2 text-sm leading-none font-medium select-none', className)} {...properties} />;
}

/** A text, number, date or file input. */
function Input({ className, ...properties }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={classNames(
        fieldClasses,
        'h-10 py-1 file:mr-3 file:inline-flex file:h-7 file:rounded-md file:border file:bg-muted file:px-3 file:text-sm file:font-medium file:text-foreground',
        className,
      )}
      {...properties}
    />
  );
}

/** A multi-line text box; pass rows to set its starting height. */
function Textarea({ className, ...properties }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={classNames(fieldClasses, 'min-h-24 py-2', className)} {...properties} />;
}

function NativeSelect({ className, ...properties }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select data-slot="native-select" className={classNames(fieldClasses, 'h-10 appearance-none py-1 pr-9', className)} {...properties} />
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
    </div>
  );
}

/** A label, the control it names, an optional hint and an optional error message, spaced as one field. */
function Field({ label, htmlFor, hint, error, className, children }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; error?: string; className?: string; children: ReactNode }) {
  return (
    <div data-slot="field" className={classNames('grid min-w-0 gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}

/** A checkbox or radio button with its label beside it. */
function Choice({ className, children, ...properties }: ComponentProps<'input'> & { children: ReactNode }) {
  return (
    <label className={classNames('flex items-start gap-2 text-sm', className)}>
      <input className="mt-0.5 size-4 shrink-0 accent-primary" {...properties} />
      <span>{children}</span>
    </label>
  );
}

export { Choice, Field, Input, Label, NativeSelect, Textarea };
