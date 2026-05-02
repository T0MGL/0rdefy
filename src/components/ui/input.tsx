import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Map common input types to a sensible mobile inputMode default.
 * Prevents the QWERTY keyboard from appearing for numeric/email/tel/url fields.
 * Caller can still override by passing inputMode explicitly.
 */
function defaultInputMode(
  type: string | undefined,
): React.HTMLAttributes<HTMLInputElement>["inputMode"] | undefined {
  switch (type) {
    case "number":
      return "decimal";
    case "tel":
      return "tel";
    case "email":
      return "email";
    case "url":
      return "url";
    case "search":
      return "search";
    default:
      return undefined;
  }
}

/**
 * Map common input types to enterKeyHint to label the virtual keyboard's
 * Return key with the right action (Search / Go / Next / Done / Send).
 * Caller can override.
 */
function defaultEnterKeyHint(
  type: string | undefined,
): React.HTMLAttributes<HTMLInputElement>["enterKeyHint"] | undefined {
  switch (type) {
    case "search":
      return "search";
    case "url":
      return "go";
    case "email":
      return "next";
    default:
      return undefined;
  }
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, inputMode, enterKeyHint, ...props }, ref) => {
    return (
      <input
        type={type}
        inputMode={inputMode ?? defaultInputMode(type)}
        enterKeyHint={enterKeyHint ?? defaultEnterKeyHint(type)}
        className={cn(
          // 16px base on mobile to prevent iOS Safari zoom-on-focus.
          // md:text-sm scales down on tablet/desktop where there's no zoom risk.
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
