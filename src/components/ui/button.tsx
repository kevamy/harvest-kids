import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Pill button, at least 56 px tall (design/composant-Button.md).
 * - bleu: the one primary action of a screen
 * - rose: check-out only ("the child leaves")
 * - soleil: call or attention
 * - ghost: secondary or cancel
 * - sombre: opens a tool (scanner) on a light background
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-pill border-0 font-sans text-[17px] leading-none font-bold whitespace-nowrap no-underline transition-[transform,filter] duration-100 select-none active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        bleu: "bg-bleu text-blanc hover:brightness-110",
        rose: "bg-rose-fonce text-blanc hover:brightness-110",
        soleil: "bg-soleil text-nuit hover:brightness-105",
        ghost: "bg-transparent text-nuit shadow-[inset_0_0_0_2px_var(--color-nuit)] hover:bg-blanc",
        sombre: "bg-nuit text-blanc hover:brightness-125",
        alerte: "bg-alerte text-blanc hover:brightness-110",
        lien: "min-h-0 px-0 text-bleu underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-touch px-6",
        xl: "min-h-18 px-8 text-[20px]",
        icon: "size-touch",
      },
    },
    defaultVariants: {
      variant: "bleu",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "bleu"}
      // A plain button never submits a form by accident.
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
