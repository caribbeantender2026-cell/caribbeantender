/** shadcn/ui button, with a gold variant for CaribbeanTender's main actions. */
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { classNames } from '../../lib/classNames.ts';

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium no-underline transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out hover:no-underline active:scale-[0.96] outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        gold: 'bg-gold text-gold-foreground shadow-xs hover:bg-gold/85',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/** A button, or with asChild, a link or other element styled as one. */
function Button({ className, variant, size, asChild = false, ...properties }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const ButtonElement = asChild ? Slot : 'button';
  return <ButtonElement data-slot="button" className={classNames(buttonVariants({ variant, size, className }))} {...properties} />;
}

export { Button };
