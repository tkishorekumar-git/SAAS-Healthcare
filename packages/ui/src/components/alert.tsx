import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../lib/utils';

const alertVariants = cva('relative w-full rounded-lg border px-4 py-3 text-sm', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      destructive: 'border-destructive/40 bg-destructive/5 text-destructive',
      success: 'border-primary/40 bg-primary/5 text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export type AlertProps = React.ComponentProps<'div'> & VariantProps<typeof alertVariants>;

/** Announced by screen readers: errors immediately, other messages politely. */
function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Alert, alertVariants };
