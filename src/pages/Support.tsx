import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Search, PlayCircle, FileText, MessageCircle, Printer, Monitor, CheckCircle, AlertTriangle } from 'lucide-react';

const faqs = [
  {
    category: 'Primeros Pasos',
    question: '¿Qué es Ordefy y cómo me ayuda?',
    answer:
      'Ordefy es una plataforma completa de gestión para ecommerce que te ayuda a gestionar pedidos, inventarios, campañas publicitarias y analizar la rentabilidad de tu negocio en tiempo real. Te ayuda a ahorrar tiempo, reducir errores y tomar decisiones basadas en datos. Desarrollado por Bright Idea.',
  },
  {
    category: 'Primeros Pasos',
    question: '¿Cómo empiezo a usar Ordefy?',
    answer:
      '1) Crea tu cuenta y completa tu perfil de negocio. 2) Conecta tus integraciones (tienda online, WhatsApp Business). 3) Configura tus productos y precios. 4) Activa la confirmación automática de pedidos. 5) Comienza a registrar tus pedidos y campañas publicitarias.',
  },
  {
    category: 'Pedidos',
    question: '¿Cómo registro un nuevo pedido?',
    answer:
      'Ve a la sección Pedidos y haz clic en "Crear Pedido". Completa los datos del cliente (nombre, teléfono, dirección), selecciona los productos y cantidades, elige la transportadora y método de pago. El sistema calculará automáticamente los costos totales y márgenes de ganancia.',
  },
  {
    category: 'Pedidos',
    question: '¿Qué estados puede tener un pedido?',
    answer:
      'Los estados son: Pendiente (recién creado), Confirmado (cliente confirmó por WhatsApp), En Tránsito (despachado con transportadora), Entregado (cliente recibió), Cancelado (pedido no procede). Puedes ver y filtrar pedidos por estado en el calendario o la tabla.',
  },
  {
    category: 'Productos',
    question: '¿Cómo gestiono mi inventario?',
    answer:
      'En la sección Productos puedes agregar, editar y eliminar productos. Para cada producto registra: nombre, precio de costo, precio de venta, stock disponible, y proveedor. El sistema alertará cuando el stock esté bajo y calculará automáticamente tu margen de ganancia por producto.',
  },
  {
    category: 'Productos',
    question: '¿Cómo calculo la rentabilidad de mis productos?',
    answer:
      'Usa la Calculadora de Rentabilidad en la sección Productos. Ingresa tu costo, precio de venta, CPA (Costo por Adquisición) y costo de envío. El sistema te mostrará: ganancia neta, margen de beneficio (%) y un precio sugerido para alcanzar tu margen objetivo.',
  },
  {
    category: 'Anuncios',
    question: '¿Cómo registro y gestiono mis campañas publicitarias?',
    answer:
      'En la sección Anuncios registra cada campaña con: plataforma (Facebook, Instagram, TikTok, Google), nombre de campaña, inversión, ventas generadas y alcance. El sistema calcula automáticamente ROI (retorno de inversión) y ROAS (retorno de gasto publicitario) para ayudarte a optimizar tu presupuesto.',
  },
  {
    category: 'Anuncios',
    question: '¿Qué significan ROI y ROAS?',
    answer:
      'ROI (Return on Investment) muestra cuántas veces recuperaste tu inversión. Ejemplo: ROI de 3.5x significa que por cada Gs. 1 invertido, ganaste Gs. 3.5. ROAS (Return on Ad Spend) mide las ventas generadas por cada Gs. gastado en publicidad. Un buen ROAS suele ser mayor a 4:1.',
  },
  {
    category: 'Transportadoras',
    question: '¿Cómo comparo transportadoras?',
    answer:
      'Ve a Transportadoras → Comparar. El sistema te muestra para cada transportadora: tasa de entrega exitosa, tiempo promedio de entrega, costo por envío, y calificación de clientes. Usa estos datos para elegir la mejor opción según tu prioridad (precio, velocidad o confiabilidad).',
  },
  {
    category: 'Transportadoras',
    question: '¿Puedo rastrear mis envíos?',
    answer:
      'Sí, en la sección Transportadoras puedes ver todos tus envíos activos. Cada transportadora tiene su panel con métricas de rendimiento. Para rastreo en tiempo real, accede a los detalles del pedido y usa el link de seguimiento de la transportadora.',
  },
  {
    category: 'Integraciones',
    question: '¿Qué integraciones están disponibles?',
    answer:
      'Ordefy se integra con: 1) Tiendas online: Shopify, WooCommerce, Mercado Libre, 2) Pagos: Mercado Pago, PayPal, Stripe, 3) Transportadoras: APIs de principales couriers. Ve a Integraciones para conectar cada servicio.',
  },
  {
    category: 'Integraciones',
    question: '¿Cómo integro mi tienda Shopify/WooCommerce?',
    answer:
      'En Integraciones, selecciona tu plataforma. Para Shopify: ingresa tu URL de tienda y genera una API key. Para WooCommerce: instala nuestro plugin e ingresa las credenciales. La sincronización de productos y pedidos será automática.',
  },
  {
    category: 'Análisis y Reportes',
    question: '¿Cómo interpreto el Estado del Negocio?',
    answer:
      'El score de salud (0-100) evalúa: rentabilidad, tasa de entrega, eficiencia de marketing y crecimiento. Excelente (80-100): negocio muy saludable. Bueno (60-79): funcionamiento correcto. Atención (40-59): áreas que necesitan mejora. Crítico (<40): requiere acción inmediata.',
  },
  {
    category: 'Análisis y Reportes',
    question: '¿Qué métricas debo monitorear diariamente?',
    answer:
      'Métricas clave: 1) Total de pedidos y estado (confirmados vs pendientes), 2) Ingresos y costos del día, 3) Margen de beneficio neto, 4) ROI de campañas activas, 5) Tasa de entrega de transportadoras, 6) Stock de productos más vendidos. Todas visibles en el Dashboard.',
  },
  {
    category: 'Proveedores',
    question: '¿Cómo gestiono mis proveedores?',
    answer:
      'En la sección Proveedores puedes agregar y gestionar todos tus proveedores. Registra: nombre, contacto, email, teléfono, productos que suministra y su calificación. Esto te ayuda a mantener organizada tu cadena de suministro.',
  },
  {
    category: 'Valores Adicionales',
    question: '¿Qué son los valores adicionales?',
    answer:
      'Los valores adicionales son costos o cargos extra que puedes agregar a tus pedidos, como: empaques especiales, seguros, costos de manejo, tarifas de contra entrega, etc. Configúralos una vez y aplícalos fácilmente a los pedidos que los requieran.',
  },
  {
    category: 'Facturación',
    question: '¿Cómo funciona la facturación en Ordefy?',
    answer:
      'Ordefy opera con un modelo de suscripción mensual. Puedes ver tu plan actual, historial de pagos y métodos de pago en la sección Facturación. Ofrecemos diferentes planes según el volumen de pedidos y funciones que necesites.',
  },
  {
    category: 'Soporte Técnico',
    question: '¿Qué hago si tengo un problema técnico?',
    answer:
      'Contacta a nuestro equipo de soporte haciendo clic en "Contactar Soporte". También puedes: 1) Revisar estos FAQs, 2) Ver los tutoriales en video, 3) Enviarnos un mensaje por WhatsApp al número de soporte, 4) Escribirnos a soporte@ordefy.io',
  },
  {
    category: 'Seguridad',
    question: '¿Mis datos están seguros?',
    answer:
      'Sí. Utilizamos encriptación SSL/TLS para todas las conexiones, encriptación de datos en reposo, backups automáticos diarios y cumplimos con estándares internacionales de protección de datos. Tus datos de clientes y transacciones están completamente protegidos.',
  },
];

const tutorials = [
  { title: 'Primeros pasos con Ordefy', duration: '5 min', level: 'Principiante' },
  { title: 'Gestionar pedidos y estados eficientemente', duration: '6 min', level: 'Principiante' },
  { title: 'Crear y optimizar campañas publicitarias', duration: '12 min', level: 'Intermedio' },
  { title: 'Usar la calculadora de rentabilidad', duration: '7 min', level: 'Principiante' },
  { title: 'Comparar y elegir transportadoras', duration: '9 min', level: 'Intermedio' },
  { title: 'Integrar tu tienda Shopify o WooCommerce', duration: '15 min', level: 'Intermedio' },
  { title: 'Análisis de métricas y reportes avanzados', duration: '18 min', level: 'Avanzado' },
  { title: 'Gestionar inventario y proveedores', duration: '10 min', level: 'Intermedio' },
  { title: 'Automatizar flujos de trabajo', duration: '14 min', level: 'Avanzado' },
];

export default function Support() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const { toast } = useToast();

  const categories = ['all', ...Array.from(new Set(faqs.map(faq => faq.category)))];

  const filteredFaqs = faqs.filter(faq => {
    const matchesSearch = search === '' ||
      faq.question.toLowerCase().includes(search.toLowerCase()) ||
      faq.answer.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || faq.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleTutorialClick = (tutorial: any) => {
    toast({
      title: `Reproduciendo: ${tutorial.title}`,
      description: "Los tutoriales en video estarán disponibles próximamente.",
    });
  };

  const handleContactSupport = () => {
    toast({
      title: "Abriendo chat de soporte",
      description: "Serás redirigido a nuestro canal de soporte.",
    });
    // Simular abrir WhatsApp o chat
    setTimeout(() => {
      window.open('https://wa.me/595981234567', '_blank');
    }, 1000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Centro de Soporte</h2>
        <p className="text-muted-foreground">Encuentra respuestas y aprende a usar Ordefy</p>
      </div>

      {/* Label Configuration Guide */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Printer className="text-primary" size={20} />
          Configurar Etiquetas de Envío 4x6
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Sigue estos pasos para configurar correctamente tu impresora térmica para etiquetas de envío 4x6 pulgadas.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Windows Instructions */}
          <div className="border rounded-lg p-4 dark:border-gray-700">
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <Monitor size={18} />
              Windows
            </h4>
            <ol className="list-decimal list-inside space-y-3 text-sm">
              <li>
                <strong>Abrir Configuración:</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Ve a <code className="bg-muted px-2 py-1 rounded text-xs">Inicio → Configuración → Dispositivos → Impresoras y escáneres</code>
                </p>
              </li>
              <li>
                <strong>Seleccionar Impresora:</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Haz clic en tu impresora térmica y luego en <code className="bg-muted px-2 py-1 rounded text-xs">Administrar</code>
                </p>
              </li>
              <li>
                <strong>Preferencias de Impresión:</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Haz clic en <code className="bg-muted px-2 py-1 rounded text-xs">Preferencias de impresión</code>
                </p>
              </li>
              <li>
                <strong>Crear Tamaño Personalizado:</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Busca la opción <code className="bg-muted px-2 py-1 rounded text-xs">Tamaño personalizado</code> o <code className="bg-muted px-2 py-1 rounded text-xs">Custom Size</code>
                </p>
              </li>
              <li>
                <strong>Configurar Dimensiones:</strong>
                <div className="ml-6 mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3 dark:bg-blue-950/20 dark:border-blue-900">
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
                    Medidas exactas:
                  </p>
                  <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-400">
                    <li>• <strong>Ancho:</strong> 101.6 mm (4 pulgadas)</li>
                    <li>• <strong>Alto:</strong> 152.4 mm (6 pulgadas)</li>
                    <li>• <strong>Orientación:</strong> Horizontal/Landscape</li>
                  </ul>
                </div>
              </li>
              <li>
                <strong>Guardar:</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Guarda como "Etiqueta 4x6" y establécelo como predeterminado
                </p>
              </li>
            </ol>
          </div>

          {/* macOS Instructions */}
          <div className="border rounded-lg p-4 dark:border-gray-700">
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <Monitor size={18} />
              macOS
            </h4>
            <ol className="list-decimal list-inside space-y-3 text-sm">
              <li>
                <strong>Abrir Preferencias del Sistema:</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Ve a <code className="bg-muted px-2 py-1 rounded text-xs">Preferencias del Sistema → Impresoras y Escáneres</code>
                </p>
              </li>
              <li>
                <strong>Seleccionar Impresora:</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Selecciona tu impresora térmica de la lista
                </p>
              </li>
              <li>
                <strong>Opciones y Suministros:</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Haz clic en <code className="bg-muted px-2 py-1 rounded text-xs">Opciones y Suministros</code>
                </p>
              </li>
              <li>
                <strong>Gestionar Tamaños:</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Busca <code className="bg-muted px-2 py-1 rounded text-xs">Gestionar tamaños personalizados...</code>
                </p>
              </li>
              <li>
                <strong>Configurar Dimensiones:</strong>
                <div className="ml-6 mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3 dark:bg-blue-950/20 dark:border-blue-900">
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">
                    Medidas exactas:
                  </p>
                  <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-400">
                    <li>• <strong>Ancho:</strong> 101.6 mm (4 pulgadas)</li>
                    <li>• <strong>Alto:</strong> 152.4 mm (6 pulgadas)</li>
                    <li>• <strong>Márgenes:</strong> 0 mm (todos los lados)</li>
                  </ul>
                </div>
              </li>
              <li>
                <strong>Guardar:</strong>
                <p className="ml-6 mt-1 text-muted-foreground">
                  Haz clic en <strong>+</strong>, nombra "Etiqueta 4x6" y guarda
                </p>
              </li>
            </ol>
          </div>
        </div>

        {/* Tips & Troubleshooting Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          {/* Print Tips */}
          <div className="border rounded-lg p-4 bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900">
            <h4 className="font-semibold mb-3 flex items-center gap-2 text-green-800 dark:text-green-300">
              <CheckCircle size={18} />
              Consejos de Impresión
            </h4>
            <ul className="space-y-2 text-sm text-green-700 dark:text-green-400">
              <li className="flex items-start gap-2">
                <span className="mt-1">•</span>
                <span>Usa etiquetas de 4x6 pulgadas (101.6 x 152.4 mm)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1">•</span>
                <span>Orientación horizontal (landscape)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1">•</span>
                <span>Verifica vista previa antes de imprimir</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1">•</span>
                <span>Compatible: Dymo, Zebra, Brother</span>
              </li>
            </ul>
          </div>

          {/* Troubleshooting */}
          <div className="border rounded-lg p-4 bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
            <h4 className="font-semibold mb-3 flex items-center gap-2 text-amber-800 dark:text-amber-300">
              <AlertTriangle size={18} />
              Solución de Problemas
            </h4>
            <ul className="space-y-2 text-sm text-amber-700 dark:text-amber-400">
              <li className="flex items-start gap-2">
                <span className="mt-1">•</span>
                <span><strong>Etiqueta cortada:</strong> Verificar dimensiones (101.6 x 152.4 mm)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1">•</span>
                <span><strong>Texto pequeño:</strong> Revisar orientación horizontal</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1">•</span>
                <span><strong>QR no escanea:</strong> Aumentar calidad de impresión</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1">•</span>
                <span><strong>Márgenes mal:</strong> Establecer todos en 0 mm</span>
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {/* Search & Filter */}
      <Card className="p-4">
        <div className="space-y-4">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={18}
            />
            <Input
              placeholder="Buscar en la base de conocimientos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Button
                key={category}
                variant={selectedCategory === category ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(category)}
              >
                {category === 'all' ? 'Todas' : category}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* FAQ */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FileText className="text-primary" size={20} />
              Preguntas Frecuentes
              <Badge variant="secondary" className="ml-auto">{filteredFaqs.length}</Badge>
            </h3>
            {filteredFaqs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No se encontraron resultados para tu búsqueda.
              </p>
            ) : (
              <Accordion type="single" collapsible className="w-full">
                {filteredFaqs.map((faq, index) => (
                  <AccordionItem key={index} value={`item-${index}`}>
                    <AccordionTrigger className="text-left">
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant="outline" className="text-xs mb-1">{faq.category}</Badge>
                        <span>{faq.question}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </Card>
        </div>

        {/* Tutorials & Contact */}
        <div className="space-y-6">
          {/* Tutorials */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <PlayCircle className="text-primary" size={20} />
              Tutoriales
            </h3>
            <div className="space-y-3">
              {tutorials.map((tutorial, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className="w-full justify-start gap-3 h-auto py-3"
                  onClick={() => handleTutorialClick(tutorial)}
                >
                  <PlayCircle size={16} className="shrink-0" />
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium">{tutorial.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">{tutorial.level}</Badge>
                      <span className="text-xs text-muted-foreground">{tutorial.duration}</span>
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          </Card>

          {/* Contact Support */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <MessageCircle className="text-primary" size={20} />
              ¿Necesitas ayuda?
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Nuestro equipo está disponible para ayudarte
            </p>
            <Button
              className="w-full gap-2 bg-primary hover:bg-primary/90"
              onClick={handleContactSupport}
            >
              <MessageCircle size={18} />
              Contactar Soporte
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
