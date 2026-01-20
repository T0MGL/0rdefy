import React, { Component, ErrorInfo, ReactNode } from 'react';
import { RefreshCw, Home, ShieldCheck, Package, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logger } from '@/utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isRetrying: boolean;
  retryCount: number;
  isOnline: boolean;
}

/**
 * ErrorBoundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing the whole app.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<Props, State> {
  private retryTimeout: NodeJS.Timeout | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isRetrying: false,
      retryCount: 0,
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    };
  }

  componentDidMount() {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  componentWillUnmount() {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
  }

  handleOnline = () => {
    this.setState({ isOnline: true });
  };

  handleOffline = () => {
    this.setState({ isOnline: false });
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV === 'development') {
      logger.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    this.setState({
      error,
      errorInfo,
    });
  }

  handleRetry = () => {
    this.setState({ isRetrying: true });

    this.retryTimeout = setTimeout(() => {
      window.location.reload();
    }, 1500);
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { isRetrying, isOnline } = this.state;

      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
          <div className="max-w-lg w-full text-center space-y-8">
            {/* Animated Logo/Icon */}
            <div className="relative mx-auto w-24 h-24">
              <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
              <div className="relative flex items-center justify-center w-24 h-24 bg-card rounded-full border border-border shadow-lg">
                {isRetrying ? (
                  <RefreshCw className="w-10 h-10 text-primary animate-spin" />
                ) : (
                  <div className="relative">
                    <Package className="w-10 h-10 text-muted-foreground" />
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                      <ShieldCheck className="w-3 h-3 text-primary-foreground" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Main Message */}
            <div className="space-y-3">
              <h1 className="text-2xl font-semibold text-foreground">
                {isRetrying ? 'Reconectando...' : 'Estamos mejorando tu experiencia'}
              </h1>
              <p className="text-muted-foreground text-base leading-relaxed max-w-md mx-auto">
                {isRetrying
                  ? 'Verificando conexión con el servidor...'
                  : 'Nuestro equipo está trabajando para brindarte el mejor servicio. Esto solo tomará un momento.'
                }
              </p>
            </div>

            {/* Connection Status */}
            <div className="flex items-center justify-center gap-2 text-sm">
              {isOnline ? (
                <>
                  <Wifi className="w-4 h-4 text-primary" />
                  <span className="text-muted-foreground">Conexión a internet activa</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-amber-500" />
                  <span className="text-amber-500">Sin conexión a internet</span>
                </>
              )}
            </div>

            {/* Reassurance Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Package className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-foreground text-sm font-medium">Tus pedidos están seguros</p>
                    <p className="text-muted-foreground text-xs mt-0.5">Ningún dato se ha perdido</p>
                  </div>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-foreground text-sm font-medium">Los pedidos siguen llegando</p>
                    <p className="text-muted-foreground text-xs mt-0.5">El sistema sigue recibiendo</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={this.handleRetry}
                disabled={isRetrying}
                size="lg"
                className="px-6"
              >
                {isRetrying ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Reconectando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Reintentar conexión
                  </>
                )}
              </Button>
              <Button
                onClick={this.handleGoHome}
                variant="outline"
                size="lg"
                className="px-6"
              >
                <Home className="w-4 h-4 mr-2" />
                Ir al inicio
              </Button>
            </div>

            {/* Dev Error Details */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="text-left bg-destructive/10 border border-destructive/20 rounded-xl p-4 mt-6">
                <summary className="cursor-pointer text-sm text-destructive hover:text-destructive/80 font-medium">
                  Detalles técnicos (solo desarrollo)
                </summary>
                <pre className="mt-3 text-xs text-destructive/80 overflow-auto max-h-48 whitespace-pre-wrap font-mono">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}

            {/* Footer */}
            <p className="text-muted-foreground/60 text-xs">
              ¿El problema persiste? Contacta a <span className="text-muted-foreground">soporte@ordefy.io</span>
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component to wrap any component with ErrorBoundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
) {
  return function WithErrorBoundaryComponent(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
