import { motion } from 'framer-motion';

interface AuthIllustrationProps {
  title?: string;
  subtitle?: string;
}

export default function AuthIllustration({
  title = "Ordefy",
  subtitle = "Gestiona tu e-commerce con inteligencia"
}: AuthIllustrationProps) {
  return (
    <div className="hidden lg:flex lg:w-1/2 bg-slate-900 relative overflow-hidden items-center justify-center">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800/50 to-slate-900"></div>

      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 bg-primary/20 rounded-full"
            initial={{
              x: Math.random() * 100 + '%',
              y: Math.random() * 100 + '%',
              opacity: 0.3
            }}
            animate={{
              y: [null, '-20%', null],
              opacity: [0.3, 0.6, 0.3]
            }}
            transition={{
              duration: 8 + i * 2,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.5
            }}
            style={{
              left: `${15 + i * 15}%`,
              top: `${20 + (i % 3) * 25}%`
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center px-12 text-center">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-4"
        >
          <h1 className="text-5xl md:text-6xl font-bold text-white tracking-tight">
            <span className="italic font-serif">O</span>rdefy
          </h1>
        </motion.div>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-lg text-slate-400 mb-12 max-w-md"
        >
          {subtitle}
        </motion.p>

        {/* SVG Illustration */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="w-full max-w-lg"
        >
          <svg
            viewBox="0 0 500 400"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-auto"
          >
            {/* Base platform / shadow */}
            <ellipse cx="250" cy="350" rx="180" ry="35" className="fill-slate-800/60" />

            {/* Dashboard/Monitor */}
            <g>
              {/* Monitor stand */}
              <rect x="230" y="290" width="40" height="40" rx="2" className="fill-slate-600" />
              <rect x="210" y="325" width="80" height="8" rx="2" className="fill-slate-500" />

              {/* Monitor body */}
              <rect x="120" y="120" width="260" height="175" rx="8" className="fill-slate-700" />
              <rect x="128" y="128" width="244" height="150" rx="4" className="fill-slate-800" />

              {/* Screen content - Dashboard */}
              <rect x="138" y="138" width="224" height="130" rx="2" className="fill-slate-900" />

              {/* Dashboard header */}
              <rect x="145" y="145" width="60" height="8" rx="1" className="fill-primary/60" />
              <circle cx="230" cy="149" r="3" className="fill-slate-600" />
              <circle cx="242" cy="149" r="3" className="fill-slate-600" />
              <circle cx="254" cy="149" r="3" className="fill-slate-600" />

              {/* Stat cards */}
              <rect x="145" y="160" width="50" height="35" rx="3" className="fill-slate-800" />
              <rect x="150" y="165" width="25" height="4" rx="1" className="fill-slate-600" />
              <rect x="150" y="175" width="35" height="8" rx="1" className="fill-primary/80" />
              <rect x="150" y="187" width="20" height="3" rx="1" className="fill-emerald-500/60" />

              <rect x="200" y="160" width="50" height="35" rx="3" className="fill-slate-800" />
              <rect x="205" y="165" width="25" height="4" rx="1" className="fill-slate-600" />
              <rect x="205" y="175" width="35" height="8" rx="1" className="fill-blue-500/80" />
              <rect x="205" y="187" width="20" height="3" rx="1" className="fill-emerald-500/60" />

              <rect x="255" y="160" width="50" height="35" rx="3" className="fill-slate-800" />
              <rect x="260" y="165" width="25" height="4" rx="1" className="fill-slate-600" />
              <rect x="260" y="175" width="35" height="8" rx="1" className="fill-amber-500/80" />
              <rect x="260" y="187" width="20" height="3" rx="1" className="fill-rose-500/60" />

              <rect x="310" y="160" width="50" height="35" rx="3" className="fill-slate-800" />
              <rect x="315" y="165" width="25" height="4" rx="1" className="fill-slate-600" />
              <rect x="315" y="175" width="35" height="8" rx="1" className="fill-violet-500/80" />
              <rect x="315" y="187" width="20" height="3" rx="1" className="fill-emerald-500/60" />

              {/* Chart area */}
              <rect x="145" y="200" width="105" height="60" rx="3" className="fill-slate-800" />
              <rect x="150" y="205" width="40" height="4" rx="1" className="fill-slate-600" />
              {/* Bar chart */}
              <rect x="155" y="245" width="8" height="10" rx="1" className="fill-primary/60" />
              <rect x="167" y="235" width="8" height="20" rx="1" className="fill-primary/70" />
              <rect x="179" y="225" width="8" height="30" rx="1" className="fill-primary/80" />
              <rect x="191" y="230" width="8" height="25" rx="1" className="fill-primary/70" />
              <rect x="203" y="240" width="8" height="15" rx="1" className="fill-primary/60" />
              <rect x="215" y="220" width="8" height="35" rx="1" className="fill-primary" />
              <rect x="227" y="232" width="8" height="23" rx="1" className="fill-primary/75" />

              {/* Orders list */}
              <rect x="255" y="200" width="105" height="60" rx="3" className="fill-slate-800" />
              <rect x="260" y="205" width="35" height="4" rx="1" className="fill-slate-600" />
              {/* Order items */}
              <rect x="260" y="215" width="95" height="12" rx="2" className="fill-slate-700" />
              <circle cx="268" cy="221" r="3" className="fill-emerald-500" />
              <rect x="275" y="219" width="40" height="4" rx="1" className="fill-slate-500" />
              <rect x="335" y="218" width="15" height="6" rx="1" className="fill-primary/60" />

              <rect x="260" y="230" width="95" height="12" rx="2" className="fill-slate-700" />
              <circle cx="268" cy="236" r="3" className="fill-amber-500" />
              <rect x="275" y="234" width="45" height="4" rx="1" className="fill-slate-500" />
              <rect x="335" y="233" width="15" height="6" rx="1" className="fill-amber-500/60" />

              <rect x="260" y="245" width="95" height="12" rx="2" className="fill-slate-700" />
              <circle cx="268" cy="251" r="3" className="fill-blue-500" />
              <rect x="275" y="249" width="35" height="4" rx="1" className="fill-slate-500" />
              <rect x="335" y="248" width="15" height="6" rx="1" className="fill-blue-500/60" />
            </g>

            {/* Package boxes - left side */}
            <g>
              {/* Box 1 - front */}
              <motion.g
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.4 }}
              >
                <path d="M50 280 L90 260 L90 310 L50 330 Z" className="fill-amber-600" />
                <path d="M90 260 L130 280 L130 330 L90 310 Z" className="fill-amber-700" />
                <path d="M50 280 L90 260 L130 280 L90 300 Z" className="fill-amber-500" />
                {/* Tape */}
                <path d="M85 260 L85 300" stroke="#d97706" strokeWidth="4" strokeLinecap="round" />
                <path d="M95 260 L95 300" stroke="#d97706" strokeWidth="4" strokeLinecap="round" />
              </motion.g>

              {/* Box 2 - behind */}
              <motion.g
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.5 }}
              >
                <path d="M70 240 L100 225 L100 265 L70 280 Z" className="fill-primary" />
                <path d="M100 225 L130 240 L130 280 L100 265 Z" className="fill-primary/80" />
                <path d="M70 240 L100 225 L130 240 L100 255 Z" className="fill-primary/60" />
              </motion.g>
            </g>

            {/* Package boxes - right side */}
            <g>
              {/* Shopping bag */}
              <motion.g
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.6 }}
              >
                <path d="M400 250 L400 320 L440 330 L440 260 Z" className="fill-violet-600" />
                <path d="M440 260 L440 330 L470 315 L470 245 Z" className="fill-violet-700" />
                <path d="M400 250 L440 260 L470 245 L430 235 Z" className="fill-violet-500" />
                {/* Handle */}
                <ellipse cx="425" cy="248" rx="12" ry="6" className="stroke-violet-400 fill-none" strokeWidth="3" />
                {/* % symbol */}
                <text x="420" y="295" className="fill-white text-lg font-bold" style={{ fontSize: '24px' }}>%</text>
              </motion.g>

              {/* Small box */}
              <motion.g
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.7 }}
              >
                <path d="M380 300 L405 290 L405 320 L380 330 Z" className="fill-blue-500" />
                <path d="M405 290 L430 300 L430 330 L405 320 Z" className="fill-blue-600" />
                <path d="M380 300 L405 290 L430 300 L405 310 Z" className="fill-blue-400" />
              </motion.g>
            </g>

            {/* Floating elements */}
            <motion.g
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              {/* Cart icon */}
              <circle cx="420" cy="180" r="20" className="fill-slate-800" />
              <path
                d="M410 175 L413 175 L416 185 L427 185 L430 178 L418 178"
                className="stroke-primary fill-none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="418" cy="189" r="2" className="fill-primary" />
              <circle cx="425" cy="189" r="2" className="fill-primary" />
            </motion.g>

            <motion.g
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
            >
              {/* Checkmark badge */}
              <circle cx="85" cy="200" r="16" className="fill-emerald-500" />
              <path
                d="M78 200 L83 205 L93 195"
                className="stroke-white fill-none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </motion.g>

            <motion.g
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            >
              {/* Analytics chart icon */}
              <circle cx="380" cy="140" r="18" className="fill-slate-800" />
              <path
                d="M370 148 L375 143 L380 146 L385 138 L390 142"
                className="stroke-primary fill-none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </motion.g>

            {/* Cloud decorations */}
            <motion.g
              animate={{ x: [0, 10, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            >
              <ellipse cx="160" cy="90" rx="25" ry="12" className="fill-slate-700/50" />
              <ellipse cx="175" cy="85" rx="20" ry="10" className="fill-slate-700/50" />
              <ellipse cx="145" cy="85" rx="15" ry="8" className="fill-slate-700/50" />
            </motion.g>

            <motion.g
              animate={{ x: [0, -8, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 2 }}
            >
              <ellipse cx="350" cy="70" rx="18" ry="9" className="fill-slate-700/40" />
              <ellipse cx="365" cy="66" rx="14" ry="7" className="fill-slate-700/40" />
            </motion.g>
          </svg>
        </motion.div>

        {/* Feature tags */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="flex flex-wrap justify-center gap-3 mt-8"
        >
          {['Pedidos', 'Inventario', 'Analytics', 'Envíos'].map((tag, i) => (
            <motion.span
              key={tag}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: 0.6 + i * 0.1 }}
              className="px-4 py-2 bg-slate-800 text-slate-300 text-sm rounded-full border border-slate-700"
            >
              {tag}
            </motion.span>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
