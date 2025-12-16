import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Globe } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface GlobalViewToggleProps {
    enabled: boolean;
    onToggle: (enabled: boolean) => void;
}

export function GlobalViewToggle({ enabled, onToggle }: GlobalViewToggleProps) {
    const { user } = useAuth();

    // Only show if user has more than 1 store
    const hasMultipleStores = (user?.stores?.length || 0) > 1;

    if (!hasMultipleStores) return null;

    return (
        <div className="flex items-center space-x-2 bg-muted/50 p-2 rounded-lg border border-border/50">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="global-view-mode"
                                checked={enabled}
                                onCheckedChange={onToggle}
                                className="data-[state=checked]:bg-blue-600"
                            />
                            <Label
                                htmlFor="global-view-mode"
                                className={`flex items-center gap-1.5 cursor-pointer font-medium text-sm ${enabled ? 'text-blue-600' : 'text-muted-foreground'}`}
                            >
                                <Globe size={14} className={enabled ? "text-blue-600" : ""} />
                                Vista Global
                            </Label>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[200px]">
                        <p>Activa para ver pedidos de <strong>todas tus tiendas</strong> en una sola lista.</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
    );
}
