import * as React from "react";

import { cn } from "@gitinspect/ui/lib/utils";

type ProgressiveBlurProps = {
  className?: string;
  backgroundColor?: string;
  position?: "top" | "bottom";
  height?: string;
  blurAmount?: string;
  style?: React.CSSProperties;
};

/** Luminance masks — do not use theme colors here; oklch in masks breaks some WebKit builds. */
function getMask(position: "top" | "bottom") {
  return position === "top"
    ? "linear-gradient(to bottom, rgba(0,0,0,1) 50%, rgba(0,0,0,0))"
    : "linear-gradient(to top, rgba(0,0,0,1) 50%, rgba(0,0,0,0))";
}

function ProgressiveBlur({
  className,
  backgroundColor = "var(--background)",
  position = "top",
  height = "64px",
  blurAmount = "4px",
  style,
}: ProgressiveBlurProps) {
  const isTop = position === "top";
  const mask = getMask(position);

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0 select-none", className)}
      style={{
        [isTop ? "top" : "bottom"]: 0,
        height,
        // Subtle non-transparent background helps some engines composite backdrop-filter.
        background: isTop
          ? `linear-gradient(to top, transparent, ${backgroundColor})`
          : `linear-gradient(to bottom, transparent, ${backgroundColor})`,
        maskImage: mask,
        WebkitMaskImage: mask,
        WebkitBackdropFilter: `blur(${blurAmount})`,
        backdropFilter: `blur(${blurAmount})`,
        WebkitUserSelect: "none",
        userSelect: "none",
        ...style,
      }}
    />
  );
}

export { ProgressiveBlur };
