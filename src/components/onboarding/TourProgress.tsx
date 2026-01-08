import { motion } from 'framer-motion';
import { useOnboardingTour } from '@/contexts/OnboardingTourContext';
import { cn } from '@/lib/utils';

interface TourProgressProps {
  variant?: 'dots' | 'bar' | 'steps';
  position?: 'top' | 'bottom';
  showLabels?: boolean;
}

export function TourProgress({
  variant = 'bar',
  position = 'top',
  showLabels = false,
}: TourProgressProps) {
  const { isActive, currentTour, currentStepIndex } = useOnboardingTour();

  if (!isActive || !currentTour) return null;

  const totalSteps = currentTour.steps.length;
  const progress = ((currentStepIndex + 1) / totalSteps) * 100;

  if (variant === 'bar') {
    return (
      <motion.div
        initial={{ opacity: 0, y: position === 'top' ? -20 : 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: position === 'top' ? -20 : 20 }}
        className={cn(
          'fixed left-0 right-0 z-[10001] px-4',
          position === 'top' ? 'top-4' : 'bottom-4'
        )}
      >
        <div className="max-w-md mx-auto">
          {/* Progress bar background */}
          <div className="h-1.5 bg-white/20 rounded-full overflow-hidden backdrop-blur-sm">
            {/* Progress fill */}
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 30,
              }}
            />
          </div>

          {showLabels && (
            <div className="flex justify-between mt-2 text-xs text-white/70">
              <span>{currentTour.name}</span>
              <span>
                {currentStepIndex + 1} / {totalSteps}
              </span>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  if (variant === 'dots') {
    return (
      <motion.div
        initial={{ opacity: 0, y: position === 'top' ? -20 : 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: position === 'top' ? -20 : 20 }}
        className={cn(
          'fixed left-1/2 -translate-x-1/2 z-[10001]',
          position === 'top' ? 'top-4' : 'bottom-4'
        )}
      >
        <div className="flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-4 py-2">
          {currentTour.steps.map((_, index) => (
            <motion.button
              key={index}
              className={cn(
                'w-2 h-2 rounded-full transition-all duration-300',
                index === currentStepIndex
                  ? 'w-6 bg-primary'
                  : index < currentStepIndex
                  ? 'bg-primary/60'
                  : 'bg-white/30'
              )}
              whileHover={{ scale: 1.2 }}
              whileTap={{ scale: 0.9 }}
            />
          ))}
        </div>
      </motion.div>
    );
  }

  // Steps variant
  return (
    <motion.div
      initial={{ opacity: 0, y: position === 'top' ? -20 : 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: position === 'top' ? -20 : 20 }}
      className={cn(
        'fixed left-1/2 -translate-x-1/2 z-[10001]',
        position === 'top' ? 'top-4' : 'bottom-4'
      )}
    >
      <div className="flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded-full px-3 py-2">
        {currentTour.steps.map((step, index) => (
          <div key={index} className="flex items-center">
            <motion.div
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all',
                index === currentStepIndex
                  ? 'bg-primary text-primary-foreground'
                  : index < currentStepIndex
                  ? 'bg-primary/60 text-white'
                  : 'bg-white/20 text-white/50'
              )}
            >
              {index + 1}
            </motion.div>
            {index < totalSteps - 1 && (
              <div
                className={cn(
                  'w-4 h-0.5 mx-0.5',
                  index < currentStepIndex ? 'bg-primary/60' : 'bg-white/20'
                )}
              />
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// Floating step counter for minimal UI
export function TourStepCounter() {
  const { isActive, currentTour, currentStepIndex } = useOnboardingTour();

  if (!isActive || !currentTour) return null;

  const totalSteps = currentTour.steps.length;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      className="fixed top-4 right-4 z-[10001]"
    >
      <div className="bg-card/90 backdrop-blur-sm border border-border rounded-full px-4 py-2 shadow-lg">
        <span className="text-sm font-medium text-card-foreground">
          {currentStepIndex + 1}
          <span className="text-muted-foreground"> / {totalSteps}</span>
        </span>
      </div>
    </motion.div>
  );
}
