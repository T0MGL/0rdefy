# Ordefy - E-commerce Management Dashboard

**Developed by Bright Idea - All Rights Reserved**

## About Ordefy

Ordefy is a professional e-commerce management platform that helps businesses manage orders, products, inventory, campaigns, and analytics all in one place. With real-time analytics, intelligent business health scoring, and seamless integrations with platforms like Shopify, Ordefy empowers businesses to make data-driven decisions.

## Features

- 📦 **Order Management** - Track and manage orders with multiple status workflows and WhatsApp confirmation
- 🛍️ **Product Catalog** - Manage inventory with profitability calculations
- 📊 **Analytics Dashboard** - Real-time business metrics with period-over-period comparisons
- 💡 **Business Intelligence** - Health scoring, alerts, and actionable recommendations
- 📢 **Campaign Management** - Track ad performance and ROI/ROAS
- 🚚 **Carrier & Courier Management** - Compare and manage shipping providers with COD support
- 👥 **Customer Management** - Track customer data and order history
- 💰 **Financial Tracking** - Monitor expenses, income, and profitability
- 🔄 **Shopify Integration** - Bidirectional sync for products, customers, and orders
- 🌙 **Dark Mode** - Full dark mode support with seamless theme switching
- 🔐 **Multi-tenant Architecture** - Store isolation with role-based access control
- 🔒 **Security** - Rate limiting, JWT authentication, password management

## Tech Stack

- **Frontend**: React 18 with TypeScript
- **Build Tool**: Vite with SWC
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS
- **Routing**: React Router v6
- **State Management**: React hooks + TanStack Query
- **Backend API**: Express.js with Supabase
- **Database**: PostgreSQL (Supabase)
- **Charts**: Recharts
- **Animations**: Framer Motion

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL database (Supabase recommended)

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd ordefy

# Install dependencies
npm install

# Configure environment variables
# Edit .env with your production configuration
# Required: SUPABASE_URL, SUPABASE_ANON_KEY, JWT_SECRET, etc.

# Run database migrations
npm run db:migrate

# Start the development servers
npm run api:dev    # API server (port 3001)
npm run dev        # Frontend (port 8080)
```

### Development Commands

```bash
# Frontend development
npm run dev              # Start dev server
npm run build            # Build for production
npm run build:dev        # Build for development
npm run preview          # Preview production build
npm run lint             # Run linter

# Backend API
npm run api:dev          # Start API with hot reload
npm run api:build        # Build API
npm run api:start        # Start production API

# Database
npm run db:migrate       # Run migrations
npm run db:seed          # Seed database
npm run db:setup         # Run migrations + seed
```

## Project Structure

```
ordefy/
├── api/                 # Backend API (Express + TypeScript)
│   ├── routes/         # API route handlers
│   ├── services/       # Business logic services
│   ├── middleware/     # Auth and security middleware
│   └── db/             # Database connection
├── src/                # Frontend source (React + TypeScript)
│   ├── components/     # React components
│   │   ├── ui/        # shadcn/ui components
│   │   └── forms/     # Form components
│   ├── pages/          # Page components
│   ├── contexts/       # React contexts (Auth, Theme)
│   ├── services/       # API services
│   ├── utils/          # Utility functions (alertEngine, healthCalculator)
│   ├── types/          # TypeScript types
│   └── hooks/          # Custom React hooks
├── db/                 # Database migrations and seeds
│   └── migrations/    # SQL migration files
└── dist/               # Production build
```

## Configuration

The application uses environment variables for configuration. Key variables in `.env`:

**Frontend:**
- `VITE_API_URL` - Backend API URL (https://api.ordefy.io in production)
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key

**Backend:**
- `API_PORT` - API server port (default: 3001)
- `NODE_ENV` - Environment (production/development)
- `CORS_ORIGIN` - Allowed CORS origins (https://app.ordefy.io in production)
- `API_URL` - Public API URL for webhooks
- `JWT_SECRET` - Secret for JWT token signing (min 32 characters)

**Database:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations

**Integrations:**
- `N8N_WEBHOOK_URL_NEWORDER` - N8N webhook for order confirmations
- `SHOPIFY_API_KEY` - Shopify app API key
- `SHOPIFY_API_SECRET` - Shopify app secret
- `SHOPIFY_SCOPES` - OAuth scopes
- `SHOPIFY_REDIRECT_URI` - OAuth callback URL
- `APP_URL` - Frontend URL for OAuth redirects

## Deployment

### Production URLs

- **Frontend**: https://app.ordefy.io
- **Backend API**: https://api.ordefy.io

### Frontend (Vercel)

1. Connect repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Build command: `npm run build`
4. Output directory: `dist`
5. Framework preset: Vite

### Backend API

Build and start the API server:

```bash
npm run api:build
npm run api:start
```

**Environment Setup:**
- Set `NODE_ENV=production`
- Set `CORS_ORIGIN=https://app.ordefy.io`
- Set `API_URL=https://api.ordefy.io`
- Configure all required environment variables

Use a process manager like PM2 or container orchestration for production deployment.

## Domain

Production domain: **ordefy.io**
- App: **app.ordefy.io**
- API: **api.ordefy.io**

## Architecture Highlights

### Intelligence Engines
- **Alert Engine** - Analyzes business metrics and generates critical/warning/info alerts
- **Recommendation Engine** - Provides actionable recommendations with impact projections
- **Health Calculator** - Computes business health score (0-100) based on delivery rate, profit margin, ROI, and stock levels

### Security Features
- JWT authentication with role-based access control
- Multi-tier rate limiting (general API, auth, webhooks, write operations)
- HMAC webhook verification
- Password hashing with bcrypt
- Helmet.js security headers

### Shopify Integration
- One-time import of products, customers, orders
- Bidirectional product sync (create, update, delete)
- Webhook-based real-time order sync
- Production-grade webhook reliability:
  - Idempotency with 24h TTL
  - Automatic retries with exponential backoff
  - Real-time health monitoring

### Performance Optimizations
- Lazy loading for all page components
- Optimized QueryClient configuration
- Memoization with useMemo and useCallback
- DRY refactoring for reusable layouts

## Copyright

© 2025 Bright Idea. All Rights Reserved.

This software and associated documentation files are proprietary and confidential.

---

**Built with ❤️ by Bright Idea**
