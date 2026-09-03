import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // DA chips (§4.5) : caption 12px 500 uppercase ls, rayon 5px (plus de pill),
  // pas d'ombre. Accent = green-tint ; neutre = bordure line ; alerte = warning.
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded border border-transparent px-2 py-0.5 text-xs font-medium uppercase tracking-[0.0625rem] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-green-tint text-green",
        secondary: "bg-green-tint text-green",
        destructive: "border-danger/40 text-danger",
        outline: "border-line text-ink",
        ghost: "text-ink",
        link: "text-green underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
