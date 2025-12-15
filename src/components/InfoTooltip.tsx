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
                    className="max-w-xs bg-slate-900 border-slate-800 text-slate-100 dark:bg-slate-50 dark:border-slate-200 dark:text-slate-900 shadow-xl"
                >
                    <p className="text-xs leading-5 font-normal">{content}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
