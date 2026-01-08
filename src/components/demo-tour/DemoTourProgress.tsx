import { motion, AnimatePresence } from 'framer-motion';
import { useDemoTour } from './DemoTourProvider';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function DemoTourProgress() {
  const { isActive, currentStepIndex, totalSteps, progress, skipTour, steps } = useDemoTour();

  if (!isActive) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="fixed top-0 left-0 right-0 z-[10001] bg-card/95 backdrop-blur-sm border-b border-border shadow-lg"
      >
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Step info */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-full">
                  Tour Guiado
                </span>
                <span className="text-sm text-muted-foreground">
                  Paso {currentStepIndex + 1} de {totalSteps}
                </span>
              </div>
            </div>

            {/* Center: Progress bar */}
            <div className="flex-1 max-w-md">
              <div className="flex items-center gap-1">
                {steps.map((step, index) => (
                  <motion.div
                    key={step.id}
                    className={cn(
                      'h-1.5 flex-1 rounded-full transition-colors duration-300',
                      index < currentStepIndex
                        ? 'bg-primary'
                        : index === currentStepIndex
                        ? 'bg-primary/70'
                        : 'bg-muted'
                    )}
                    initial={false}
                    animate={{
                      scale: index === currentStepIndex ? 1.1 : 1,
                    }}
                    transition={{ duration: 0.2 }}
                  />
                ))}
              </div>
            </div>

            {/* Right: Skip button */}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground gap-1"
              onClick={skipTour}
            >
              <span className="hidden sm:inline">Salir del tour</span>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
