import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
    content: string;
    icon?: "info" | "help";
    className?: string;
    side?: "top" | "right" | "bottom" | "left";
}

export function InfoTooltip({
    content,
    icon = "info",
    className,
    side = "top"
}: InfoTooltipProps) {
    const Icon = icon === "info" ? Info : HelpCircle;

    return (
        <TooltipProvider delayDuration={200}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={cn(
                            "cursor-help inline-flex items-center justify-center ml-1 align-middle opacity-60 hover:opacity-100 transition-opacity",
                            className
                        )}
                        role="button"
                        aria-label="Más información"
                    >
                        <Icon size={14} className="stroke-[2.5px]" />
                    </span>
                </TooltipTrigger>
                <TooltipContent
                    side={side}
                    className="max-w-xs bg-popover text-popover-foreground border-border shadow-md"
                >
                    <p className="text-xs font-normal">{content}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
