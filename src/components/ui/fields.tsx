/** shadcn/ui label, and a native select styled like shadcn's (kept native for phones and tests). */
import { ChevronDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { classNames } from '../../lib/classNames.ts';

const fieldClasses =
  'w-full min-w-0 rounded-md border border-input bg-card px-3 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm';

function Label({ className, ...properties }: ComponentProps<'label'>) {
  return <label data-slot="label" className={classNames('flex items-center gap-2 text-sm leading-none font-medium select-none', className)} {...properties} />;
}

function NativeSelect({ className, ...properties }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select data-slot="native-select" className={classNames(fieldClasses, 'h-9 appearance-none py-1 pr-9', className)} {...properties} />
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-50" aria-hidden="true" />
    </div>
  );
}

export { Label, NativeSelect };
