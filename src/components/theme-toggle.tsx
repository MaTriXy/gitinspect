"use client"

import { useTheme } from "next-themes"

import { Icons } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function ThemeToggle() {
  const { setTheme, theme } = useTheme()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Toggle Theme"
          className="relative"
          variant="ghost"
          size="icon"
          onClick={() =>
            theme === "light" ? setTheme("dark") : setTheme("light")
          }
        >
          <Icons.sun className="rotate-0 scale-100 text-foreground transition-all dark:-rotate-90 dark:scale-0" />
          <Icons.moon className="absolute rotate-90 scale-0 text-foreground transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle Theme</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>Toggle Theme</TooltipContent>
    </Tooltip>
  )
}
