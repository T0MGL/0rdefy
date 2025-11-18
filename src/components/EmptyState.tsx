import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <Card className="p-12">
      <div className="flex flex-col items-center justify-center text-center space-y-6">
        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center">
          <Icon className="text-muted-foreground" size={48} />
        </div>
        <div className="space-y-2">
          <h3 className="text-2xl font-semibold">{title}</h3>
          <p className="text-muted-foreground max-w-md">{description}</p>
        </div>
        {action && (
          <Button
            onClick={action.onClick}
            className="gap-2 cursor-pointer hover:scale-105 hover:bg-primary/90 active:scale-95 transition-all duration-200 z-50 relative"
          >
            {action.label}
          </Button>
        )}
      </div>
    </Card>
  );
}
