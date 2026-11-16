/** shadcn/ui alert, used for every notice in the app. */
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { classNames } from '../../lib/classNames.ts';

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'border-gold/50 bg-gold/10 text-card-foreground',
        destructive: 'border-destructive/30 bg-destructive/5 text-destructive *:data-[slot=alert-description]:text-destructive/90',
        success: 'border-success/30 bg-success/5 text-success *:data-[slot=alert-description]:text-success/90',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Alert({ className, variant, ...properties }: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" className={classNames(alertVariants({ variant }), className)} {...properties} />;
}

function AlertDescription({ className, ...properties }: ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={classNames('col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed', className)} {...properties} />;
}

export { Alert, AlertDescription };
