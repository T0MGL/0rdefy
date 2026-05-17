/**
 * LISTEN/NOTIFY wrapper sobre node-postgres.
 *
 * Supabase JS no soporta LISTEN/NOTIFY (es un cliente REST). El worker
 * necesita conexion directa a Postgres para que pg_notify desde los
 * triggers de migration 189 despierte el dispatcher / poller sin polling
 * sobre la tabla `invoices`.
 *
 * Reconexion: si la conexion se rompe (Supabase mata sockets idle, deploy
 * de un nuevo pgbouncer, etc), el wrapper hace backoff exponencial y
 * vuelve a suscribirse a todos los canales registrados.
 *
 * Cliente exclusivo: NO usar este socket para queries normales. LISTEN
 * deja el socket en modo idle reading; mezclar queries arbitrarias rompe
 * el protocolo. El worker usa supabaseAdmin (REST + pooler) para todo lo
 * demas.
 */

import { Client, type Notification } from 'pg';
import { logger } from '../../utils/logger';

export type PgChannel = string;
export type PgListener = (notification: Notification) => void | Promise<void>;

interface ChannelHandler {
  channel: PgChannel;
  handler: PgListener;
}

const RECONNECT_INITIAL_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;

export class SifenPgListener {
  private client: Client | null = null;
  private channels: ChannelHandler[] = [];
  private reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
  private stopped = false;
  private connecting = false;

  constructor(private readonly connectionString: string) {
    if (!connectionString) {
      throw new Error('SifenPgListener requires a Postgres connection string');
    }
  }

  /**
   * Registra un handler para un canal. Si el listener ya esta conectado,
   * se suscribe inmediatamente; si no, queda almacenado y se suscribe en
   * el proximo connect().
   */
  on(channel: PgChannel, handler: PgListener): void {
    this.channels.push({ channel, handler });
    if (this.client) {
      void this.subscribe(channel);
    }
  }

  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error('SifenPgListener was stopped; create a new instance');
    }
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.end();
      } catch (err) {
        logger.warn(
          `[SifenPgListener] error closing client: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting) return;
    this.connecting = true;

    try {
      const client = new Client({
        connectionString: this.connectionString,
        // Supabase enforces TLS. node-postgres needs ssl: { rejectUnauthorized: false }
        // only because Supabase historically rotates intermediates that
        // node's bundled CA list doesn't always carry. Same posture used
        // by every Supabase community Postgres listener.
        ssl: { rejectUnauthorized: false },
        // Keep the socket alive across NAT timeouts.
        keepAlive: true,
        application_name: 'sifen-worker-listener',
      });

      client.on('notification', (msg) => {
        const matched = this.channels.filter((c) => c.channel === msg.channel);
        for (const { handler } of matched) {
          try {
            const result = handler(msg);
            if (result instanceof Promise) {
              result.catch((err) => {
                logger.error(
                  `[SifenPgListener] handler for ${msg.channel} threw: ${err instanceof Error ? err.message : String(err)}`,
                );
              });
            }
          } catch (err) {
            logger.error(
              `[SifenPgListener] sync handler for ${msg.channel} threw: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      });

      client.on('error', (err) => {
        logger.warn(`[SifenPgListener] client error: ${err.message}`);
        this.handleDisconnect();
      });

      client.on('end', () => {
        if (!this.stopped) {
          logger.warn('[SifenPgListener] connection ended unexpectedly');
          this.handleDisconnect();
        }
      });

      await client.connect();
      this.client = client;
      this.reconnectDelay = RECONNECT_INITIAL_DELAY_MS;

      for (const { channel } of this.channels) {
        await this.subscribe(channel);
      }

      logger.info(
        `[SifenPgListener] connected, listening on ${this.channels.map((c) => c.channel).join(', ') || 'no channels yet'}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[SifenPgListener] connect failed: ${message}`);
      this.handleDisconnect();
    } finally {
      this.connecting = false;
    }
  }

  private async subscribe(channel: PgChannel): Promise<void> {
    if (!this.client) return;
    try {
      // pg's parameterized queries don't support LISTEN, so build the
      // identifier manually. Channel names come from our own trigger
      // definitions (constants in code), never user input, so this is
      // safe — but we still defend against accidental whitespace.
      if (!/^[a-z_][a-z0-9_]*$/i.test(channel)) {
        throw new Error(`Invalid channel name: ${channel}`);
      }
      await this.client.query(`LISTEN ${channel}`);
    } catch (err) {
      logger.error(
        `[SifenPgListener] LISTEN ${channel} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.handleDisconnect();
    }
  }

  private handleDisconnect(): void {
    if (this.stopped) return;

    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      client.end().catch(() => {
        /* best effort */
      });
    }

    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);

    logger.info(`[SifenPgListener] reconnecting in ${delay}ms`);
    setTimeout(() => {
      void this.connect();
    }, delay).unref();
  }
}

/**
 * Resuelve la connection string para el listener. Permite override
 * explicito via `SIFEN_WORKER_PG_URL`; sino usa `DATABASE_URL`. Si
 * ninguna esta seteada, intenta construirla del par
 * `SUPABASE_URL` + `SUPABASE_DB_PASSWORD`.
 *
 * Lanza si no puede armar nada coherente: prefiero falla temprana al
 * arrancar el worker que reconectes silenciosos en runtime.
 */
export function resolveListenerConnectionString(): string {
  const explicit = process.env.SIFEN_WORKER_PG_URL || process.env.DATABASE_URL;
  if (explicit) return explicit;

  const supabaseUrl = process.env.SUPABASE_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (supabaseUrl && password) {
    // SUPABASE_URL: https://<ref>.supabase.co  ->  db.<ref>.supabase.co
    const ref = new URL(supabaseUrl).hostname.split('.')[0];
    if (!ref) throw new Error('Could not derive project ref from SUPABASE_URL');
    return `postgres://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
  }

  throw new Error(
    'No Postgres connection available. Set SIFEN_WORKER_PG_URL (preferred), DATABASE_URL, or SUPABASE_URL + SUPABASE_DB_PASSWORD.',
  );
}
