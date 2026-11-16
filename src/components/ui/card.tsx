/** shadcn/ui card and its parts. */
import type { ComponentProps } from 'react';
import { classNames } from '../../lib/classNames.ts';

function Card({ className, ...properties }: ComponentProps<'div'>) {
  return <div data-slot="card" className={classNames('flex flex-col gap-6 rounded-xl border border-transparent bg-card py-6 text-card-foreground shadow-surface', className)} {...properties} />;
}

function CardHeader({ className, ...properties }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={classNames('@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6', className)}
      {...properties}
    />
  );
}

function CardTitle({ className, ...properties }: ComponentProps<'div'>) {
  return <div data-slot="card-title" className={classNames('leading-none font-semibold', className)} {...properties} />;
}

function CardDescription({ className, ...properties }: ComponentProps<'div'>) {
  return <div data-slot="card-description" className={classNames('text-sm text-muted-foreground', className)} {...properties} />;
}

function CardAction({ className, ...properties }: ComponentProps<'div'>) {
  return <div data-slot="card-action" className={classNames('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)} {...properties} />;
}

function CardContent({ className, ...properties }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={classNames('px-6', className)} {...properties} />;
}


export { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle };
