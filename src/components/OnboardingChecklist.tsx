/**
 * Onboarding Checklist Component
 * Visual guide showing setup progress for new users
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  X,
  Sparkles,
  Store,
  Package,
  ShoppingCart,
  Truck,
  Link2,
  ArrowRight,
  PartyPopper,
  Rocket,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { onboardingService, OnboardingProgress, OnboardingStep } from '@/services/onboarding.service';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth, Role } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';

interface OnboardingChecklistProps {
  className?: string;
  onDismiss?: () => void;
}

// Icon mapping for steps
const stepIcons: Record<string, React.ReactNode> = {
  'connect-shopify': <Link2 className="w-5 h-5" />,
  'create-carrier': <Truck className="w-5 h-5" />,
  'add-product': <Package className="w-5 h-5" />,
  'first-order': <ShoppingCart className="w-5 h-5" />,
  'configure-store': <Store className="w-5 h-5" />,
};

export function OnboardingChecklist({ className, onDismiss }: OnboardingChecklistProps) {
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const { hasFeature, loading: subscriptionLoading } = useSubscription();
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);

  // Only show for owners - collaborators don't need to see setup checklist
  const isOwner = permissions.currentRole === Role.OWNER;

  // Check if user has Shopify feature in their plan
  const hasShopifyAccess = hasFeature('shopify_import');

  useEffect(() => {
    // Skip loading if not owner
    if (!isOwner) {
      setIsLoading(false);
      return;
    }
    loadProgress();
  }, [isOwner]);

  async function loadProgress() {
    try {
      const data = await onboardingService.getProgress();
      setProgress(data);
      setIsDismissed(data.hasDismissed);
    } catch (error) {
      console.error('Error loading onboarding progress:', error);
    } finally {
      setIsLoading(false);
    }
  }

  // Filter steps based on subscription plan
  const filteredSteps = progress?.steps.filter(step => {
    // Hide Shopify step if user doesn't have access
    if (step.id === 'connect-shopify' && !hasShopifyAccess) {
      return false;
    }
    return true;
  }) || [];

  // Recalculate progress with filtered steps
  const filteredProgress = progress ? {
    ...progress,
    steps: filteredSteps,
    totalCount: filteredSteps.length,
    completedCount: filteredSteps.filter(s => s.completed).length,
    percentage: filteredSteps.length > 0
      ? Math.round((filteredSteps.filter(s => s.completed).length / filteredSteps.length) * 100)
      : 0,
    isComplete: filteredSteps.length > 0 && filteredSteps.every(s => s.completed),
  } : null;

  function handleStepClick(step: OnboardingStep) {
    if (step.route && !step.completed) {
      navigate(step.route);
    }
  }

  async function handleDismiss() {
    setIsDismissed(true);
    onDismiss?.();
    await onboardingService.dismiss();
  }

  // Don't render if not owner, dismissed, complete, or loading
  if (!isOwner || isLoading || subscriptionLoading || isDismissed || !filteredProgress || filteredProgress.isComplete) {
    return null;
  }

  // Show celebration when almost complete (only one step left)
  const isAlmostComplete = filteredProgress.completedCount === filteredProgress.totalCount - 1;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        <Card className={cn(
          'relative overflow-hidden',
          'border-2 border-primary/20 dark:border-primary/30',
          'bg-gradient-to-br from-primary/5 via-background to-primary/5',
          className
        )}>
          {/* Decorative background - hidden on mobile for performance */}
          <div className="hidden sm:block absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl" />
          </div>

          {/* Content */}
          <div className="relative p-4 sm:p-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <div className="p-1.5 sm:p-2 bg-primary/10 rounded-lg flex-shrink-0">
                  <Rocket className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-sm sm:text-lg flex items-center gap-2 flex-wrap">
                    <span className="truncate">Configura tu tienda</span>
                    {isAlmostComplete && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs">
                        <Sparkles className="w-3 h-3 mr-1" />
                        <span className="hidden sm:inline">¡Casi listo!</span>
                        <span className="sm:hidden">¡Casi!</span>
                      </Badge>
                    )}
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    {filteredProgress.completedCount}/{filteredProgress.totalCount} pasos
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground"
                  onClick={handleDismiss}
                  title="Ocultar checklist"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-3 sm:mb-4">
              <Progress
                value={filteredProgress.percentage}
                className="h-1.5 sm:h-2 bg-primary/20"
              />
              <p className="text-xs text-muted-foreground mt-1 text-right">
                {filteredProgress.percentage}%
              </p>
            </div>

            {/* Steps list */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1.5 sm:space-y-2">
                    {filteredProgress.steps.map((step, index) => (
                      <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className={cn(
                          'flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg transition-all',
                          'active:scale-[0.99]', // Touch feedback
                          step.completed
                            ? 'bg-green-50 dark:bg-green-950/20'
                            : 'bg-white/50 dark:bg-gray-900/50 hover:bg-white dark:hover:bg-gray-900 cursor-pointer',
                          !step.completed && 'border border-border/50'
                        )}
                        onClick={() => handleStepClick(step)}
                      >
                        {/* Status icon */}
                        <div className={cn(
                          'flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center',
                          step.completed
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-muted-foreground'
                        )}>
                          {step.completed ? (
                            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                          ) : (
                            stepIcons[step.id] || <Circle className="w-4 h-4 sm:w-5 sm:h-5" />
                          )}
                        </div>

                        {/* Step content */}
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            'font-medium text-xs sm:text-sm truncate',
                            step.completed && 'text-green-700 dark:text-green-400'
                          )}>
                            {step.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate hidden sm:block">
                            {step.description}
                          </p>
                        </div>

                        {/* Action indicator */}
                        {!step.completed && step.route && (
                          <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        )}
                      </motion.div>
                    ))}
                  </div>

                  {/* Completion message */}
                  {isAlmostComplete && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="mt-4 p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800"
                    >
                      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                        <PartyPopper className="w-5 h-5" />
                        <p className="font-medium text-sm">
                          ¡Un paso más y tu tienda estará lista para operar!
                        </p>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}

export default OnboardingChecklist;
