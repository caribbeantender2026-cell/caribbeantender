/** shadcn/ui table and its parts. */
import type { ComponentProps } from 'react';
import { classNames } from '../../lib/classNames.ts';

function Table({ className, ...properties }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={classNames('w-full caption-bottom text-sm', className)} {...properties} />
    </div>
  );
}

function TableHeader({ className, ...properties }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={classNames('[&_tr]:border-b', className)} {...properties} />;
}

function TableBody({ className, ...properties }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={classNames('[&_tr:last-child]:border-0', className)} {...properties} />;
}

function TableRow({ className, ...properties }: ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={classNames('border-b transition-colors hover:bg-muted/50', className)} {...properties} />;
}

function TableHead({ className, ...properties }: ComponentProps<'th'>) {
  return <th data-slot="table-head" className={classNames('h-10 px-3 text-left align-middle font-medium whitespace-nowrap text-muted-foreground', className)} {...properties} />;
}

function TableCell({ className, ...properties }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={classNames('p-3 align-middle', className)} {...properties} />;
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
