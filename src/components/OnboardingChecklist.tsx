/**
 * OnboardingChecklist
 *
 * Two render targets:
 *   - inline:  rendered as a Card in page content (legacy, kept for back-compat)
 *   - drawer:  rendered inside the Header Sheet without its own Card chrome
 *
 * The dashboard no longer renders the inline variant. New mounts should use
 * `variant="drawer"` from the Header. Existing inline call sites keep working.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { logger } from '@/utils/logger';
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  X,
  Store,
  Package,
  ShoppingCart,
  Truck,
  Link2,
  ArrowRight,
  PartyPopper,
  Rocket,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { onboardingService, OnboardingProgress, OnboardingStep } from '@/services/onboarding.service';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth, Role } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';

type ChecklistVariant = 'inline' | 'drawer';

interface OnboardingChecklistProps {
  className?: string;
  onDismiss?: () => void;
  variant?: ChecklistVariant;
}

const stepIcons: Record<string, React.ReactNode> = {
  'connect-shopify': <Link2 className="w-5 h-5" />,
  'create-carrier': <Truck className="w-5 h-5" />,
  'add-product': <Package className="w-5 h-5" />,
  'add-customer': <Users className="w-5 h-5" />,
  'first-order': <ShoppingCart className="w-5 h-5" />,
  'configure-store': <Store className="w-5 h-5" />,
};

/**
 * Read-only hook for surfaces that need progress without rendering the full
 * checklist (e.g., Header badge). Returns null while loading or when the user
 * is not an owner so callers can early-return.
 */
export function useOnboardingProgress(): OnboardingProgress | null {
  const { permissions } = useAuth();
  const { hasFeature, loading: subscriptionLoading } = useSubscription();
  const isOwner = permissions.currentRole === Role.OWNER;
  const hasShopifyAccess = hasFeature('shopify_import');

  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOwner || subscriptionLoading) return;

    let cancelled = false;
    onboardingService
      .getProgress()
      .then((data) => {
        if (cancelled || !isMountedRef.current) return;
        const filteredSteps = data.steps.filter((step) =>
          step.id === 'connect-shopify' ? hasShopifyAccess : true
        );
        const completedCount = filteredSteps.filter((s) => s.completed).length;
        const totalCount = filteredSteps.length;
        setProgress({
          ...data,
          steps: filteredSteps,
          completedCount,
          totalCount,
          percentage: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
          isComplete: totalCount > 0 && completedCount === totalCount,
        });
      })
      .catch((error) => {
        if (cancelled || !isMountedRef.current) return;
        logger.error('Error loading onboarding progress (hook):', error);
      });

    return () => {
      cancelled = true;
    };
  }, [isOwner, subscriptionLoading, hasShopifyAccess]);

  if (!isOwner || subscriptionLoading) return null;
  return progress;
}

export function OnboardingChecklist({
  className,
  onDismiss,
  variant = 'inline',
}: OnboardingChecklistProps) {
  const navigate = useNavigate();
  const { permissions } = useAuth();
  const { hasFeature, loading: subscriptionLoading } = useSubscription();
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);

  const isOwner = permissions.currentRole === Role.OWNER;
  const hasShopifyAccess = hasFeature('shopify_import');

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const loadProgress = useCallback(async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const data = await onboardingService.getProgress();
      if (!isMountedRef.current || controller.signal.aborted) return;
      setProgress(data);
      setIsDismissed(data.hasDismissed);
    } catch (error) {
      if (!isMountedRef.current) return;
      logger.error('Error loading onboarding progress:', error);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOwner) {
      setIsLoading(false);
      return;
    }
    void loadProgress();
  }, [isOwner, loadProgress]);

  const filteredSteps = progress?.steps.filter((step) =>
    step.id === 'connect-shopify' ? hasShopifyAccess : true
  ) ?? [];

  const filteredProgress = progress
    ? {
        ...progress,
        steps: filteredSteps,
        totalCount: filteredSteps.length,
        completedCount: filteredSteps.filter((s) => s.completed).length,
        percentage:
          filteredSteps.length > 0
            ? Math.round(
                (filteredSteps.filter((s) => s.completed).length / filteredSteps.length) * 100
              )
            : 0,
        isComplete: filteredSteps.length > 0 && filteredSteps.every((s) => s.completed),
      }
    : null;

  const handleStepClick = (step: OnboardingStep) => {
    if (step.route && !step.completed) {
      navigate(step.route);
      onDismiss?.();
    }
  };

  const handleDismiss = async () => {
    setIsDismissed(true);
    onDismiss?.();
    await onboardingService.dismiss();
  };

  if (!isOwner || isLoading || subscriptionLoading || isDismissed || !filteredProgress || filteredProgress.isComplete) {
    return null;
  }

  const isAlmostComplete = filteredProgress.completedCount === filteredProgress.totalCount - 1;
  const isDrawer = variant === 'drawer';

  const stepsList = (
    <div className="space-y-1.5 sm:space-y-2">
      {filteredProgress.steps.map((step, index) => (
        <motion.div
          key={step.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.05 }}
          className={cn(
            'flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-lg transition-all active:scale-[0.99]',
            step.completed
              ? 'bg-green-50 dark:bg-green-950/20'
              : 'bg-white/50 dark:bg-gray-900/50 hover:bg-white dark:hover:bg-gray-900 cursor-pointer',
            !step.completed && 'border border-border/50'
          )}
          onClick={() => handleStepClick(step)}
        >
          <div
            className={cn(
              'flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center',
              step.completed
                ? 'bg-green-500 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-muted-foreground'
            )}
          >
            {step.completed ? (
              <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
            ) : (
              stepIcons[step.id] || <Circle className="w-4 h-4 sm:w-5 sm:h-5" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p
              className={cn(
                'font-medium text-xs sm:text-sm truncate',
                step.completed && 'text-green-700 dark:text-green-400'
              )}
            >
              {step.title}
            </p>
            <p className="text-xs text-muted-foreground truncate hidden sm:block">
              {step.description}
            </p>
          </div>

          {!step.completed && step.route && (
            <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
        </motion.div>
      ))}
    </div>
  );

  const completionMessage = isAlmostComplete && (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mt-4 p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800"
    >
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
        <PartyPopper className="w-5 h-5" />
        <p className="font-medium text-sm">
          Un paso más y tu tienda estará lista para operar.
        </p>
      </div>
    </motion.div>
  );

  if (isDrawer) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Rocket className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base text-foreground">Configura tu tienda</h3>
            <p className="text-xs text-muted-foreground">
              {filteredProgress.completedCount}/{filteredProgress.totalCount} pasos completados
            </p>
          </div>
          {isAlmostComplete && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs">
              Casi listo
            </Badge>
          )}
        </div>

        <div>
          <Progress value={filteredProgress.percentage} className="h-2 bg-primary/15" />
          <p className="text-xs text-muted-foreground mt-1 text-right tabular-nums">
            {filteredProgress.percentage}%
          </p>
        </div>

        {stepsList}
        {completionMessage}

        <div className="pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
          >
            Ocultar checklist
          </Button>
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        <Card
          className={cn(
            'relative overflow-hidden',
            'border-2 border-primary/20 dark:border-primary/30',
            'bg-gradient-to-br from-primary/5 via-background to-primary/5',
            className
          )}
        >
          <div className="hidden sm:block absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/10 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl" />
          </div>

          <div className="relative p-4 sm:p-6">
            <div className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <div className="p-1.5 sm:p-2 bg-primary/10 rounded-lg flex-shrink-0">
                  <Rocket className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-sm sm:text-lg flex items-center gap-2 flex-wrap">
                    <span className="truncate">Configura tu tienda</span>
                    {isAlmostComplete && (
                      <Badge
                        variant="secondary"
                        className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs"
                      >
                        Casi listo
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
                  aria-label={isExpanded ? 'Contraer checklist' : 'Expandir checklist'}
                >
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground hover:text-foreground"
                  onClick={handleDismiss}
                  title="Ocultar checklist"
                  aria-label="Ocultar checklist"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="mb-3 sm:mb-4">
              <Progress value={filteredProgress.percentage} className="h-1.5 sm:h-2 bg-primary/20" />
              <p className="text-xs text-muted-foreground mt-1 text-right tabular-nums">
                {filteredProgress.percentage}%
              </p>
            </div>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  {stepsList}
                  {completionMessage}
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
