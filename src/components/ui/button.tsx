import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Wayfare buttons (design.md §10.4).
 * Variants: primary (brand fill), secondary (surface + border), ghost,
 * pine (route/optimize actions), premium (ochre-soft + crown), danger-ghost.
 * Heights: sm 32 / md 40 / lg 48. Radius md(12); CTAs use `pill: true`.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all duration-fast ease-expo disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-0 active:scale-[0.97]",
  {
    variants: {
      variant: {
        /* r23: primary actions adopt the dark pill language */
        primary:
          "bg-wayfare-dark text-[#fafafa] font-semibold shadow-sm hover:bg-[#333] hover:shadow-md",
        default:
          "bg-wayfare-dark text-[#fafafa] font-semibold shadow-sm hover:bg-[#333] hover:shadow-md",
        secondary:
          "border border-border-strong bg-surface text-ink shadow-sm hover:-translate-y-px hover:bg-surface-2 hover:shadow-md",
        outline:
          "border border-border-strong bg-surface text-ink shadow-sm hover:-translate-y-px hover:bg-surface-2 hover:shadow-md",
        ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
        pine: "bg-pine text-white font-semibold shadow-sm hover:-translate-y-px hover:shadow-md hover:brightness-110",
        premium: "bg-ochre-soft text-ochre font-semibold hover:-translate-y-px hover:shadow-md",
        "danger-ghost": "text-danger hover:bg-danger/10",
        destructive: "bg-danger text-white shadow-sm hover:-translate-y-px hover:shadow-md hover:brightness-110",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 rounded-full gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5",
        default: "h-10 rounded-full px-5 has-[>svg]:px-4",
        md: "h-10 rounded-full px-5 has-[>svg]:px-4",
        lg: "h-12 rounded-full px-6 text-[15px] has-[>svg]:px-5",
        icon: "size-9 rounded-md",
        "icon-sm": "size-8 rounded-md",
        "icon-lg": "size-10 rounded-md",
      },
      pill: {
        true: "rounded-pill",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  pill,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, pill, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
