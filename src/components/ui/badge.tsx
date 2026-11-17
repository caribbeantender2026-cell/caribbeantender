/** shadcn/ui badge, with a variant for each tender phase and bid status. */
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { classNames } from '../../lib/classNames.ts';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        // Tender phases (rules.ts tenderPhaseDisplay) and bid statuses share these names.
        draft: 'border-transparent bg-muted text-muted-foreground',
        open: 'border-transparent bg-success/10 text-success',
        waiting: 'border-transparent bg-gold/15 text-gold-foreground',
        closed: 'border-transparent bg-accent text-accent-foreground',
        awarded: 'border-transparent bg-gold text-gold-foreground',
        cancelled: 'border-transparent bg-destructive/10 text-destructive',
        submitted: 'border-transparent bg-accent text-accent-foreground',
        unsuccessful: 'border-transparent bg-muted text-muted-foreground',
        tender_cancelled: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({ className, variant, asChild = false, ...properties }: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const BadgeElement = asChild ? Slot : 'span';
  return <BadgeElement data-slot="badge" className={classNames(badgeVariants({ variant }), className)} {...properties} />;
}

export { Badge };
