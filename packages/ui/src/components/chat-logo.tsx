import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@gitinspect/ui/lib/utils";

type ChatLogoProps = ComponentPropsWithoutRef<"div"> & {
  /** Larger wordmark for landing / hero layouts */
  size?: "default" | "hero";
  /** Single-line ellipsis when the container is narrower than the wordmark */
  truncate?: boolean;
};

export function ChatLogo({
  className,
  size = "default",
  truncate = false,
  ...props
}: ChatLogoProps) {
  const wordmark = (
    <>
      <span className="text-muted-foreground">git</span>
      <span className="text-foreground">inspect</span>
    </>
  );

  return (
    <div className={cn("flex w-full min-w-0 items-center justify-center", className)} {...props}>
      {truncate ? (
        <span
          className={cn(
            "font-geist-pixel-square inline-block max-w-full truncate whitespace-nowrap text-center font-semibold leading-none tracking-tight",
            size === "hero"
              ? "text-5xl sm:text-6xl md:text-7xl lg:text-8xl"
              : "text-lg md:text-2xl",
          )}
        >
          {wordmark}
        </span>
      ) : (
        <div
          className={cn(
            "font-geist-pixel-square flex items-baseline gap-0.5 text-center leading-none font-semibold tracking-tight",
            size === "hero"
              ? "gap-1 text-5xl sm:text-6xl md:text-7xl lg:text-8xl"
              : "gap-0.5 text-lg md:text-2xl",
          )}
        >
          {wordmark}
        </div>
      )}
    </div>
  );
}
