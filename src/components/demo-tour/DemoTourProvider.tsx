import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, Role } from '@/contexts/AuthContext';
import type { Carrier } from '@/services/carriers.service';
import type { Product, Order, Customer } from '@/types';
import { logger } from '@/utils/logger';
import { TOUR_TARGETS } from './tourTargets';

// Demo data types
export interface DemoData {
  carrier?: Carrier;
  product?: Product;
  order?: Order;
  customer?: Customer;
  pickingSessionId?: string;
  dispatchSessionId?: string;
  inboundShipmentId?: string;
}

// Tour step definition
export interface DemoTourStep {
  id: string;
  title: string;
  description: string;
  route?: string;
  target?: string; // CSS selector for spotlight
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  action?: 'navigate' | 'create' | 'click' | 'observe';
  requiredData?: keyof DemoData;
  completionCheck?: (data: DemoData) => boolean;
}

// Tour path types
// 'collaborator' is auto-set for non-owner roles to skip path selection
export type TourPath = 'shopify' | 'manual' | 'collaborator';

// Tour state
interface DemoTourState {
  isActive: boolean;
  currentStepIndex: number;
  path: TourPath | null;
  demoData: DemoData;
  isTransitioning: boolean;
  hasCompletedTour: boolean;
  tourId: string | null;
  isAutoStarted: boolean; // true if started automatically after registration
}

// Tour actions
interface DemoTourActions {
  startTour: (tourId: string, autoStarted?: boolean) => void;
  setPath: (path: TourPath) => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (index: number) => void;
  skipTour: () => void;
  pauseTour: () => void; // Pause without marking as completed (for external flows like OAuth)
  completeTour: () => void;
  updateDemoData: (data: Partial<DemoData>) => void;
  cleanupDemoData: () => Promise<void>;
  resetTour: () => void;
}

type DemoTourContextType = DemoTourState & DemoTourActions & {
  currentStep: DemoTourStep | null;
  totalSteps: number;
  progress: number;
  steps: DemoTourStep[];
};

const DemoTourContext = createContext<DemoTourContextType | null>(null);

// Storage keys
const STORAGE_KEYS = {
  COMPLETED: 'ordefy_demo_tour_completed',
  STEP: 'ordefy_demo_tour_step',
  PATH: 'ordefy_demo_tour_path',
  DATA: 'ordefy_demo_tour_data',
  TOUR_ID: 'ordefy_demo_tour_id',
};

// Owner tour steps (manual path - full 12 steps)
const ownerManualSteps: DemoTourStep[] = [
  {
    id: 'welcome',
    title: '¡Bienvenido a Ordefy!',
    description: 'Te guiaremos paso a paso para configurar tu tienda y procesar tu primer pedido.',
    placement: 'center',
    action: 'observe',
  },
  {
    id: 'create-carrier',
    title: 'Crear Transportadora',
    description: 'Primero necesitas una transportadora para enviar tus pedidos. Vamos a crear una con zonas de cobertura.',
    route: '/carriers',
    action: 'create',
  },
  {
    id: 'create-product',
    title: 'Agregar Producto',
    description: 'Ahora vamos a agregar un producto a tu catálogo con precio, costo e inventario.',
    route: '/products',
    action: 'create',
    requiredData: 'carrier',
  },
  {
    id: 'create-order',
    title: 'Crear Pedido',
    description: 'Con el producto listo, creemos un pedido de prueba para ver el flujo completo.',
    route: '/orders',
    action: 'create',
    requiredData: 'product',
  },
  {
    id: 'confirm-order',
    title: 'Confirmar Pedido',
    description: 'El pedido está pendiente. Confírmalo para que pase a preparación.',
    route: '/orders',
    target: '[data-demo-order]',
    action: 'click',
    requiredData: 'order',
  },
  {
    id: 'whatsapp-preview',
    title: 'Confirmación por WhatsApp',
    description: 'Puedes enviar una confirmación automática al cliente por WhatsApp.',
    route: '/orders',
    action: 'observe',
    requiredData: 'order',
  },
  {
    id: 'picking',
    title: 'Preparación (Picking)',
    description: 'Vamos al almacén para crear una sesión de picking y recolectar los productos.',
    route: '/warehouse',
    action: 'create',
    requiredData: 'order',
  },
  {
    id: 'packing',
    title: 'Empaque (Packing)',
    description: 'Ahora empacamos los productos. Al completar, el pedido estará listo para enviar.',
    route: '/warehouse',
    action: 'click',
    requiredData: 'pickingSessionId',
  },
  {
    id: 'print-label',
    title: 'Imprimir Etiqueta',
    description: 'Genera la etiqueta de envío con código QR para el courier.',
    route: '/orders',
    target: '[data-demo-order]',
    action: 'click',
    requiredData: 'order',
  },
  {
    id: 'dispatch',
    title: 'Despachar Pedido',
    description: 'Crea una sesión de despacho y exporta el CSV para el courier.',
    route: '/settlements',
    action: 'create',
    requiredData: 'order',
  },
  {
    id: 'merchandise',
    title: 'Recibir Mercadería',
    description: 'Por último, veamos cómo recibir mercadería de proveedores para reabastecer stock.',
    route: '/merchandise',
    action: 'create',
  },
  {
    id: 'completion',
    title: '¡Tour Completado!',
    description: 'Ya conoces el flujo completo. Tu tienda está lista para operar.',
    placement: 'center',
    action: 'observe',
  },
];

// Owner tour steps (shopify path - faster)
const ownerShopifySteps: DemoTourStep[] = [
  {
    id: 'welcome',
    title: '¡Bienvenido a Ordefy!',
    description: 'Conecta tu tienda Shopify para importar productos, clientes y pedidos automáticamente.',
    placement: 'center',
    action: 'observe',
  },
  {
    id: 'connect-shopify',
    title: 'Conectar Shopify',
    description: 'Ingresa tu dominio de Shopify para iniciar la conexión OAuth.',
    route: '/integrations',
    action: 'click',
  },
  {
    id: 'shopify-import',
    title: 'Importar Datos',
    description: 'Selecciona qué quieres importar: productos, clientes, pedidos.',
    route: '/integrations',
    action: 'observe',
  },
  {
    id: 'create-carrier',
    title: 'Crear Transportadora',
    description: 'Aunque tengas Shopify, necesitas configurar transportadoras locales.',
    route: '/carriers',
    action: 'create',
  },
  {
    id: 'view-orders',
    title: 'Ver Pedidos Importados',
    description: 'Tus pedidos de Shopify aparecerán aquí. Veamos el flujo de preparación.',
    route: '/orders',
    action: 'observe',
  },
  {
    id: 'warehouse-overview',
    title: 'Almacén',
    description: 'Desde aquí gestionas picking y packing de pedidos.',
    route: '/warehouse',
    action: 'observe',
  },
  {
    id: 'completion',
    title: '¡Listo para Operar!',
    description: 'Tu tienda Shopify está conectada. Los pedidos se sincronizarán automáticamente.',
    placement: 'center',
    action: 'observe',
  },
];

// Collaborator tour steps (logistics)
const logisticsTourSteps: DemoTourStep[] = [
  {
    id: 'welcome',
    title: '¡Bienvenido al Equipo!',
    description: 'Como logístico, tu rol es preparar y despachar pedidos. Te mostraremos las herramientas principales.',
    placement: 'center',
    action: 'observe',
  },
  {
    id: 'warehouse',
    title: 'Tu Centro de Operaciones',
    description: 'Desde el Almacén crearás sesiones de picking para recolectar productos de múltiples pedidos.',
    route: '/warehouse',
    target: TOUR_TARGETS.SIDEBAR_WAREHOUSE,
    placement: 'right',
    action: 'observe',
  },
  {
    id: 'picking-flow',
    title: 'Flujo de Picking',
    description: 'Selecciona pedidos confirmados, crea una sesión, y recolecta los productos según la lista generada.',
    route: '/warehouse',
    target: '[data-tour-target="warehouse-sessions"]',
    placement: 'bottom',
    action: 'observe',
  },
  {
    id: 'packing-flow',
    title: 'Flujo de Packing',
    description: 'Empaca los productos en cajas individuales por pedido. Al completar, el stock se descuenta automáticamente.',
    route: '/warehouse',
    target: '[data-tour-target="create-session-button"]',
    placement: 'bottom',
    action: 'observe',
  },
  {
    id: 'returns',
    title: 'Devoluciones',
    description: 'Aquí procesas devoluciones de clientes y restauras el inventario cuando corresponde.',
    route: '/returns',
    target: TOUR_TARGETS.SIDEBAR_RETURNS,
    placement: 'right',
    action: 'observe',
  },
  {
    id: 'completion',
    title: '¡Estás Listo!',
    description: 'Ya conoces tus herramientas de logística. ¡Éxitos!',
    placement: 'center',
    action: 'observe',
  },
];

// Collaborator tour steps (confirmador)
// Note: Confirmadores ONLY confirm orders - they do NOT assign carriers
// The store has "Separar confirmación de asignación de transportadora" enabled
const confirmadorTourSteps: DemoTourStep[] = [
  {
    id: 'welcome',
    title: '¡Bienvenido al Equipo!',
    description: 'Como confirmador, tu rol es validar datos del cliente y confirmar pedidos. La asignación de transportadora la hace un administrador.',
    placement: 'center',
    action: 'observe',
  },
  {
    id: 'orders',
    title: 'Panel de Pedidos',
    description: 'Aquí verás todos los pedidos. Filtra por "Pendiente" para ver los que necesitan tu confirmación.',
    route: '/orders',
    target: TOUR_TARGETS.SIDEBAR_ORDERS,
    placement: 'right',
    action: 'observe',
  },
  {
    id: 'confirm-flow',
    title: 'Tu Rol: Validar y Confirmar',
    description: 'Haz clic en el ojo (👁) para ver detalles del pedido. Verifica nombre, teléfono y dirección del cliente. Luego usa el botón "Confirmar". No necesitas asignar transportadora.',
    placement: 'center',
    action: 'observe',
  },
  {
    id: 'whatsapp',
    title: 'Notificar al Cliente',
    description: 'Después de confirmar, usa el botón de WhatsApp para notificar al cliente que su pedido fue recibido y está siendo procesado.',
    placement: 'center',
    action: 'observe',
  },
  {
    id: 'customers',
    title: 'Base de Clientes',
    description: 'Consulta el historial de compras y datos de contacto de cada cliente si necesitas verificar información.',
    route: '/customers',
    target: TOUR_TARGETS.SIDEBAR_CUSTOMERS,
    placement: 'right',
    action: 'observe',
  },
  {
    id: 'completion',
    title: '¡Estás Listo!',
    description: 'Recuerda: tu trabajo es validar datos y confirmar. Un administrador asignará la transportadora después. ¡Éxitos!',
    placement: 'center',
    action: 'observe',
  },
];

// Collaborator tour steps (inventario)
const inventarioTourSteps: DemoTourStep[] = [
  {
    id: 'welcome',
    title: '¡Bienvenido al Equipo!',
    description: 'Como encargado de inventario, gestionas productos y mercadería. Te mostraremos las herramientas.',
    placement: 'center',
    action: 'observe',
  },
  {
    id: 'products',
    title: 'Catálogo de Productos',
    description: 'Aquí creas y editas productos con precios, costos, SKU e inventario.',
    route: '/products',
    target: TOUR_TARGETS.SIDEBAR_PRODUCTS,
    placement: 'right',
    action: 'observe',
  },
  {
    id: 'merchandise',
    title: 'Recepción de Mercadería',
    description: 'Registra envíos de proveedores. Al recibir, el stock se actualiza automáticamente.',
    route: '/merchandise',
    target: TOUR_TARGETS.SIDEBAR_MERCHANDISE,
    placement: 'right',
    action: 'observe',
  },
  {
    id: 'suppliers',
    title: 'Proveedores',
    description: 'Gestiona tus proveedores con datos de contacto y condiciones comerciales.',
    route: '/suppliers',
    target: TOUR_TARGETS.SIDEBAR_SUPPLIERS,
    placement: 'right',
    action: 'observe',
  },
  {
    id: 'completion',
    title: '¡Estás Listo!',
    description: 'Ya conoces tus herramientas de inventario. ¡Éxitos!',
    placement: 'center',
    action: 'observe',
  },
];

// Collaborator tour steps (contador)
const contadorTourSteps: DemoTourStep[] = [
  {
    id: 'welcome',
    title: '¡Bienvenido al Equipo!',
    description: 'Como contador, tienes acceso a métricas y reportes financieros. Te mostraremos las herramientas.',
    placement: 'center',
    action: 'observe',
  },
  {
    id: 'dashboard',
    title: 'Dashboard de Métricas',
    description: 'Resumen de ventas, márgenes de ganancia, ROI y otros indicadores clave.',
    route: '/',
    target: TOUR_TARGETS.SIDEBAR_DASHBOARD,
    placement: 'right',
    action: 'observe',
  },
  {
    id: 'orders-view',
    title: 'Pedidos (Solo Lectura)',
    description: 'Consulta pedidos para conciliación financiera. No tienes permisos de edición.',
    route: '/orders',
    target: TOUR_TARGETS.SIDEBAR_ORDERS,
    placement: 'right',
    action: 'observe',
  },
  {
    id: 'campaigns',
    title: 'Campañas Publicitarias',
    description: 'Revisa la inversión publicitaria, rendimiento por campaña y cálculo de ROI.',
    route: '/ads',
    target: TOUR_TARGETS.SIDEBAR_ADS,
    placement: 'right',
    action: 'observe',
  },
  {
    id: 'completion',
    title: '¡Estás Listo!',
    description: 'Ya conoces las herramientas de análisis financiero. ¡Éxitos!',
    placement: 'center',
    action: 'observe',
  },
];

// Get tour steps based on role and path
function getTourSteps(role: Role, path: TourPath | null): DemoTourStep[] {
  if (role === Role.OWNER || role === Role.ADMIN) {
    return path === 'shopify' ? ownerShopifySteps : ownerManualSteps;
  }

  switch (role) {
    case Role.LOGISTICS:
      return logisticsTourSteps;
    case Role.CONFIRMADOR:
      return confirmadorTourSteps;
    case Role.INVENTARIO:
      return inventarioTourSteps;
    case Role.CONTADOR:
      return contadorTourSteps;
    default:
      return ownerManualSteps;
  }
}

interface DemoTourProviderProps {
  children: ReactNode;
}

export function DemoTourProvider({ children }: DemoTourProviderProps) {
  const navigate = useNavigate();
  const { permissions } = useAuth();

  // Track transition timeouts for cleanup
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<DemoTourState>({
    isActive: false,
    currentStepIndex: 0,
    path: null,
    demoData: {},
    isTransitioning: false,
    hasCompletedTour: false,
    tourId: null,
    isAutoStarted: false,
  });

  // Get steps based on current role and path
  const steps = getTourSteps(permissions.currentRole, state.path);
  const currentStep = state.isActive ? steps[state.currentStepIndex] : null;
  const totalSteps = steps.length;
  const progress = totalSteps > 0 ? ((state.currentStepIndex + 1) / totalSteps) * 100 : 0;

  // Cleanup transition timeout on unmount
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  // Load persisted state on mount
  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEYS.COMPLETED);
    if (completed === 'true') {
      setState(prev => ({ ...prev, hasCompletedTour: true }));
      return;
    }

    // Restore in-progress tour
    const savedStep = localStorage.getItem(STORAGE_KEYS.STEP);
    const savedPath = localStorage.getItem(STORAGE_KEYS.PATH) as TourPath | null;
    const savedData = localStorage.getItem(STORAGE_KEYS.DATA);
    const savedTourId = localStorage.getItem(STORAGE_KEYS.TOUR_ID);

    if (savedTourId && savedStep) {
      setState(prev => ({
        ...prev,
        isActive: true,
        currentStepIndex: parseInt(savedStep, 10),
        path: savedPath,
        demoData: savedData ? JSON.parse(savedData) : {},
        tourId: savedTourId,
      }));
    }
  }, []);

  // Persist state changes
  useEffect(() => {
    if (state.isActive) {
      localStorage.setItem(STORAGE_KEYS.STEP, state.currentStepIndex.toString());
      if (state.path) {
        localStorage.setItem(STORAGE_KEYS.PATH, state.path);
      }
      localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(state.demoData));
      if (state.tourId) {
        localStorage.setItem(STORAGE_KEYS.TOUR_ID, state.tourId);
      }
    }
  }, [state.isActive, state.currentStepIndex, state.path, state.demoData, state.tourId]);

  // Navigate to step route when step changes
  useEffect(() => {
    if (state.isActive && currentStep?.route && !state.isTransitioning) {
      const currentPath = window.location.pathname;
      if (currentPath !== currentStep.route) {
        navigate(currentStep.route);
      }
    }
  }, [state.isActive, state.currentStepIndex, currentStep, navigate, state.isTransitioning]);

  const startTour = useCallback((tourId: string, autoStarted: boolean = false) => {
    // Collaborators (non-owner/admin) skip path selection - auto-set to 'collaborator'
    const isCollaborator = permissions.currentRole !== Role.OWNER && permissions.currentRole !== Role.ADMIN;
    const initialPath: TourPath | null = isCollaborator ? 'collaborator' : null;

    setState(prev => ({
      ...prev,
      isActive: true,
      currentStepIndex: 0,
      path: initialPath,
      demoData: {},
      isTransitioning: false,
      tourId,
      isAutoStarted: autoStarted,
    }));
  }, [permissions.currentRole]);

  const setPath = useCallback((path: TourPath) => {
    setState(prev => ({
      ...prev,
      path,
      currentStepIndex: 0, // Reset to first step of chosen path
    }));
  }, []);

  const nextStep = useCallback(() => {
    setState(prev => {
      const nextIndex = prev.currentStepIndex + 1;
      const currentSteps = getTourSteps(permissions.currentRole, prev.path);

      if (nextIndex >= currentSteps.length) {
        // Tour completed
        return prev; // Let completeTour handle this
      }

      return {
        ...prev,
        currentStepIndex: nextIndex,
        isTransitioning: true,
      };
    });

    // Reset transitioning after animation (with cleanup)
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }
    transitionTimeoutRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, isTransitioning: false }));
    }, 300);
  }, [permissions.currentRole]);

  const prevStep = useCallback(() => {
    setState(prev => {
      if (prev.currentStepIndex === 0) return prev;

      return {
        ...prev,
        currentStepIndex: prev.currentStepIndex - 1,
        isTransitioning: true,
      };
    });

    // Reset transitioning after animation (with cleanup)
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }
    transitionTimeoutRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, isTransitioning: false }));
    }, 300);
  }, []);

  const goToStep = useCallback((index: number) => {
    const currentSteps = getTourSteps(permissions.currentRole, state.path);
    if (index < 0 || index >= currentSteps.length) return;

    setState(prev => ({
      ...prev,
      currentStepIndex: index,
      isTransitioning: true,
    }));

    // Reset transitioning after animation (with cleanup)
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }
    transitionTimeoutRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, isTransitioning: false }));
    }, 300);
  }, [permissions.currentRole, state.path]);

  const skipTour = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.COMPLETED, 'true');
    // Clear progress data
    localStorage.removeItem(STORAGE_KEYS.STEP);
    localStorage.removeItem(STORAGE_KEYS.PATH);
    localStorage.removeItem(STORAGE_KEYS.DATA);
    localStorage.removeItem(STORAGE_KEYS.TOUR_ID);

    setState(prev => ({
      ...prev,
      isActive: false,
      currentStepIndex: 0,
      hasCompletedTour: true,
    }));
  }, []);

  // Pause tour temporarily without marking as completed
  // Use this when user needs to interact with external flows (like Shopify OAuth)
  const pauseTour = useCallback(() => {
    // Don't mark as completed, just deactivate - user can resume later
    setState(prev => ({
      ...prev,
      isActive: false,
    }));
    // Note: Progress is preserved in localStorage, user can restart from Settings
  }, []);

  const cleanupDemoData = useCallback(async () => {
    const { order, pickingSessionId, dispatchSessionId } = state.demoData;
    const token = localStorage.getItem('auth_token');
    const storeId = localStorage.getItem('current_store_id');

    if (!token || !storeId) return;

    const headers = {
      'Authorization': `Bearer ${token}`,
      'X-Store-ID': storeId,
      'Content-Type': 'application/json',
    };

    try {
      // Delete demo order (this will cascade to line items)
      if (order?.id) {
        await fetch(`/api/orders/${order.id}/hard-delete`, {
          method: 'DELETE',
          headers,
        });
      }

      // Delete picking session if exists
      if (pickingSessionId) {
        await fetch(`/api/warehouse/sessions/${pickingSessionId}`, {
          method: 'DELETE',
          headers,
        });
      }

      // Delete dispatch session if exists
      if (dispatchSessionId) {
        await fetch(`/api/settlements/dispatch-sessions/${dispatchSessionId}`, {
          method: 'DELETE',
          headers,
        });
      }

      logger.log('[DemoTour] Demo data cleaned up successfully');
    } catch (error) {
      logger.error('[DemoTour] Error cleaning up demo data:', error);
    }
  }, [state.demoData]);

  const completeTour = useCallback(async () => {
    // Clean up demo data first
    await cleanupDemoData();

    localStorage.setItem(STORAGE_KEYS.COMPLETED, 'true');
    localStorage.removeItem(STORAGE_KEYS.STEP);
    localStorage.removeItem(STORAGE_KEYS.PATH);
    localStorage.removeItem(STORAGE_KEYS.DATA);
    localStorage.removeItem(STORAGE_KEYS.TOUR_ID);

    setState(prev => ({
      ...prev,
      isActive: false,
      currentStepIndex: 0,
      demoData: {},
      hasCompletedTour: true,
    }));
  }, [cleanupDemoData]);

  const updateDemoData = useCallback((data: Partial<DemoData>) => {
    setState(prev => ({
      ...prev,
      demoData: { ...prev.demoData, ...data },
    }));
  }, []);

  const resetTour = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.COMPLETED);
    localStorage.removeItem(STORAGE_KEYS.STEP);
    localStorage.removeItem(STORAGE_KEYS.PATH);
    localStorage.removeItem(STORAGE_KEYS.DATA);
    localStorage.removeItem(STORAGE_KEYS.TOUR_ID);

    setState({
      isActive: false,
      currentStepIndex: 0,
      path: null,
      demoData: {},
      isTransitioning: false,
      hasCompletedTour: false,
      tourId: null,
    });
  }, []);

  const value: DemoTourContextType = {
    ...state,
    currentStep,
    totalSteps,
    progress,
    steps,
    startTour,
    setPath,
    nextStep,
    prevStep,
    goToStep,
    skipTour,
    pauseTour,
    completeTour,
    updateDemoData,
    cleanupDemoData,
    resetTour,
  };

  return (
    <DemoTourContext.Provider value={value}>
      {children}
    </DemoTourContext.Provider>
  );
}

export function useDemoTour() {
  const context = useContext(DemoTourContext);
  if (!context) {
    throw new Error('useDemoTour must be used within a DemoTourProvider');
  }
  return context;
}

// Helper hook to check if current step matches
export function useIsDemoStep(stepId: string) {
  const { isActive, currentStep } = useDemoTour();
  return isActive && currentStep?.id === stepId;
}
