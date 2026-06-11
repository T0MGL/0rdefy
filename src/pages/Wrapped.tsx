import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

/**
 * Public, no-auth share page for milestone share cards.
 *
 * Layout:
 *   - Mobile: story-format hero (1080x1920) sized to viewport.
 *   - Desktop: landscape hero with centered controls.
 *
 * Share priority order:
 *   1) WhatsApp (highest LATAM affinity)
 *   2) Instagram Stories (deep link with Web Share API fallback)
 *   3) Facebook Stories (deep link with Web Share API fallback)
 *   4) LinkedIn
 *   5) X / Twitter
 *   6) Facebook feed
 *   7) Download PNG (fallback always available)
 *
 * Privacy toggle: shows abstract "logro" by default. Owner clicks to reveal
 * raw figures (private mode).
 */

interface WrappedData {
  token: string;
  milestone_type: string;
  milestone_value: number;
  public_data: {
    milestone_value?: number;
    milestone_type?: string;
    store_handle?: string;
    headline?: string;
  };
  private_data: {
    milestone_value?: number;
    first_order_total?: number;
    product_count?: number;
    carrier_count?: number;
    delivery_rate?: number;
    best_day?: string;
    best_day_count?: number;
    margin_accumulated?: number;
    currency?: string;
  } | null;
  image_urls: {
    square: string;
    story: string;
    landscape: string;
  };
  share_url: string;
  created_at: string;
}

const API_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3001"
    : "https://api.ordefy.io");

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function trackShare(token: string, platform: string) {
  fetch(`${API_URL}/api/public/wrapped/${token}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform }),
  }).catch(() => undefined);
}

export default function Wrapped() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<WrappedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPrivate, setShowPrivate] = useState(false);
  const [loadingPrivate, setLoadingPrivate] = useState(false);

  const isMobile = useMediaQuery("(max-width: 767px)");

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/public/wrapped/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then(setData)
      .catch(() => setError("No encontramos esta tarjeta. El link puede haber expirado."));
  }, [token]);

  const handleReveal = async () => {
    if (!token) return;
    if (showPrivate) {
      setShowPrivate(false);
      return;
    }
    setLoadingPrivate(true);
    try {
      const res = await fetch(`${API_URL}/api/public/wrapped/${token}?reveal=1`);
      if (!res.ok) throw new Error("forbidden");
      const json = (await res.json()) as WrappedData;
      setData(json);
      setShowPrivate(true);
    } catch {
      // Silently keep public mode
    } finally {
      setLoadingPrivate(false);
    }
  };

  const heroImageSrc = useMemo(() => {
    if (!data) return null;
    const base = isMobile ? data.image_urls.story : data.image_urls.landscape;
    return showPrivate ? `${base}&private=1` : base;
  }, [data, isMobile, showPrivate]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#09090b] text-[#f2f2f2] flex flex-col items-center justify-center px-6 text-center">
        <p className="text-base text-[#9ca3af]">{error}</p>
        <a
          href="https://app.ordefy.io"
          className="mt-6 inline-block px-5 py-2.5 rounded-md bg-[#b0e636] text-[#09090b] font-semibold"
        >
          Conocé Ordefy
        </a>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#09090b] text-[#f2f2f2] flex items-center justify-center">
        <p className="text-sm text-[#6b7280]">Cargando...</p>
      </div>
    );
  }

  const milestone = data.milestone_value;
  const headline = (data.public_data.headline ?? "Órdenes procesadas").toUpperCase();

  const shareText = `${milestone} ${headline.toLowerCase()} en mi tienda. Construido con Ordefy.`;
  const shareUrl = data.share_url;
  const fullShareText = `${shareText} ${shareUrl}`;
  const downloadUrl = data.image_urls.story + (showPrivate ? "&private=1" : "");

  const handleNativeShare = async (platform: string) => {
    trackShare(token!, platform);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        // Try image share first
        const imgUrl = data.image_urls.story + (showPrivate ? "&private=1" : "");
        const blob = await fetch(imgUrl).then((r) => r.blob());
        const file = new File([blob], `ordefy-milestone-${milestone}.png`, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: shareText, url: shareUrl });
          return;
        }
        // Fallback: text + url only
        await navigator.share({ text: shareText, url: shareUrl });
      } catch {
        // user cancelled or unsupported, silent
      }
    }
  };

  const openLink = (url: string, platform: string) => {
    trackShare(token!, platform);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-[#f2f2f2]">
      {/* Top bar */}
      <header className="px-5 py-4 flex items-center justify-between border-b border-[#1f1f26]">
        <a href="https://app.ordefy.io" className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#b0e636]" />
          <span className="font-bold tracking-tight">Ordefy</span>
        </a>
        <button
          onClick={handleReveal}
          disabled={loadingPrivate}
          className="text-xs text-[#9ca3af] hover:text-[#f2f2f2] underline-offset-4 underline disabled:opacity-50"
        >
          {showPrivate ? "Mostrar versión pública" : "Mostrar mis números"}
        </button>
      </header>

      {/* Hero */}
      <section className="px-5 py-8 md:py-12 flex flex-col items-center">
        <div className="w-full max-w-md md:max-w-3xl">
          {heroImageSrc ? (
            <img
              src={heroImageSrc}
              alt={`${milestone} ${headline.toLowerCase()}`}
              className="w-full h-auto rounded-xl border border-[#1f1f26] shadow-2xl"
            />
          ) : null}
        </div>

        <div className="mt-6 max-w-md md:max-w-2xl text-center">
          <p className="text-sm text-[#9ca3af]">
            {milestone} {headline.toLowerCase()} procesadas con Ordefy.
          </p>
          {showPrivate && data.private_data ? (
            <div className="mt-4 grid grid-cols-2 gap-3 text-left">
              {typeof data.private_data.product_count === "number" ? (
                <Stat label="Productos" value={String(data.private_data.product_count)} />
              ) : null}
              {typeof data.private_data.carrier_count === "number" ? (
                <Stat label="Carriers" value={String(data.private_data.carrier_count)} />
              ) : null}
              {typeof data.private_data.delivery_rate === "number" ? (
                <Stat label="Delivery rate" value={`${data.private_data.delivery_rate}%`} />
              ) : null}
              {typeof data.private_data.best_day_count === "number" ? (
                <Stat label="Mejor día" value={`${data.private_data.best_day_count} órdenes`} />
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Share buttons */}
      <section className="px-5 pb-12">
        <div className="max-w-md md:max-w-2xl mx-auto">
          <h2 className="text-xs uppercase tracking-widest text-[#6b7280] text-center mb-4">
            Compartilo
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <ShareButton
              label="WhatsApp"
              onClick={() =>
                openLink(
                  `https://wa.me/?text=${encodeURIComponent(fullShareText)}`,
                  "whatsapp",
                )
              }
            />
            <ShareButton
              label="Instagram Stories"
              onClick={() => handleNativeShare("instagram_stories")}
              hint={!isMobile ? "Abrí desde tu celular" : undefined}
            />
            <ShareButton
              label="Facebook Stories"
              onClick={() => handleNativeShare("facebook_stories")}
              hint={!isMobile ? "Abrí desde tu celular" : undefined}
            />
            <ShareButton
              label="LinkedIn"
              onClick={() =>
                openLink(
                  `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
                  "linkedin",
                )
              }
            />
            <ShareButton
              label="X / Twitter"
              onClick={() =>
                openLink(
                  `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
                  "twitter",
                )
              }
            />
            <ShareButton
              label="Facebook"
              onClick={() =>
                openLink(
                  `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
                  "facebook_feed",
                )
              }
            />
            <ShareButton
              label="Descargar PNG"
              onClick={() => {
                trackShare(token!, "download");
                window.open(downloadUrl, "_blank", "noopener,noreferrer");
              }}
              span2
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 pb-16">
        <div className="max-w-md md:max-w-xl mx-auto text-center bg-[#131318] border border-[#1f1f26] rounded-xl p-6">
          <p className="text-base font-semibold">¿Tu e-commerce todavía corre en una planilla?</p>
          <p className="text-sm text-[#9ca3af] mt-2">
            Probá Ordefy gratis. Pedidos, inventario, envíos y facturación en un solo lugar.
          </p>
          <a
            href="https://app.ordefy.io/signup"
            className="inline-block mt-4 px-5 py-2.5 rounded-md bg-[#b0e636] text-[#09090b] font-semibold"
          >
            Empezá ahora
          </a>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#1f1f26] bg-[#131318] p-3">
      <div className="text-[10px] uppercase tracking-widest text-[#6b7280]">{label}</div>
      <div className="text-base font-semibold mt-1">{value}</div>
    </div>
  );
}

function ShareButton({
  label,
  onClick,
  hint,
  span2,
}: {
  label: string;
  onClick: () => void;
  hint?: string;
  span2?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`${span2 ? "col-span-2" : ""} text-sm font-semibold text-[#f2f2f2] bg-[#131318] border border-[#1f1f26] hover:border-[#b0e636] hover:text-[#b0e636] transition-colors rounded-md px-4 py-3 flex flex-col items-center justify-center gap-0.5`}
    >
      <span>{label}</span>
      {hint ? <span className="text-[10px] text-[#6b7280]">{hint}</span> : null}
    </button>
  );
}
