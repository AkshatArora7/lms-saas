import { EMBED_DIM } from "./store.js";

/**
 * Produces one embedding vector per input text. The interface is the seam that
 * keeps the service key-free and offline-testable: production wires the default
 * deterministic {@link HashingEmbedder}, and a real hosted provider (e.g. Cohere
 * embed-v3 / bge-large-en, both 1024-dim) can drop in later behind env with no
 * caller changes. Every vector has length {@link EMBED_DIM} and is L2-normalized.
 */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** FNV-1a hash of a token → unsigned 32-bit integer. */
function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic, dependency-free embedder: hashes each lowercased word token
 * into one of {@link EMBED_DIM} buckets (bag-of-words), then L2-normalizes so
 * cosine similarity is meaningful. No network, no API key, fully reproducible —
 * which is exactly what lets tests and CI run offline.
 */
export class HashingEmbedder implements Embedder {
  constructor(private readonly dim: number = EMBED_DIM) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const counts = new Map<number, number>();
    for (const token of tokens) {
      const idx = hashToken(token) % this.dim;
      counts.set(idx, (counts.get(idx) ?? 0) + 1);
    }
    let norm = 0;
    for (const c of counts.values()) norm += c * c;
    norm = Math.sqrt(norm);
    const scale = norm === 0 ? 0 : 1 / norm;
    const out = new Array<number>(this.dim).fill(0);
    for (const [idx, c] of counts) out[idx] = c * scale;
    return out;
  }
}

/** Default production embedder (deterministic, key-free). */
export function makeEmbedder(): Embedder {
  return new HashingEmbedder();
}
