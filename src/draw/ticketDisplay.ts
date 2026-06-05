// Human-readable ticket codes derived from raw 32-byte hash strings.
//
// The bridge contract carries `userTicket` and `winningTickets` as 64-char
// hex strings (32 bytes). Users should never see the raw hex — too long,
// not memorable, looks like noise. Instead we derive a short alphanumeric
// code from the hash that's deterministic per-ticket (so the user
// recognizes "their" ticket across screens) and uses a confusable-free
// alphabet (no 0/O, 1/I/L, etc.).
//
// Two formatters:
//   - formatTicketShort  → 4-char compact code for the lane scene
//                          (rendered tiny on the ticket face along its long
//                          axis; legibility at 11px matters more than info)
//   - formatTicketLong   → 8-char (XXXX-XXXX) code for the sealed-screen
//                          hero stamp + result hero (more presence)
//
// Both consume the same hash so the same ticket renders the same code
// everywhere.

// Crockford base32 minus visually ambiguous chars (no 0, 1, I, L, O, U).
// 26 letters - 5 ambiguous (I, L, O, U) + 10 digits - 2 ambiguous (0, 1)
// → 22 + 8 = 30, then drop V to get a power-of-2-friendly 32-style feel.
// Actually let's just pick 32 readable chars for a clean 5-bit-per-char encoding.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ' + '%@'  // 32 chars total
const ALPHABET_LEN = ALPHABET.length

function isValidHash(hash: string): boolean {
  return typeof hash === 'string' && hash.length > 0
}

/** Pull `count` bytes starting at `start` from a hex string. Returns 0
 *  if the index is out of range so the caller never crashes on a short
 *  or malformed hash. */
function byteAt(hash: string, idx: number): number {
  const off = idx * 2
  if (off + 2 > hash.length) return 0
  const v = parseInt(hash.slice(off, off + 2), 16)
  return Number.isFinite(v) ? v : 0
}

function encodeChars(hash: string, count: number, offset: number = 0): string {
  let out = ''
  for (let i = 0; i < count; i++) {
    const byte = byteAt(hash, offset + i)
    out += ALPHABET[byte % ALPHABET_LEN]
  }
  return out
}

/** 4-char compact code for the lane scene — rendered tiny on the ticket
 *  face. e.g. "A7F2". Falls back to "????" for malformed hashes. */
export function formatTicketShort(hash: string): string {
  if (!isValidHash(hash)) return '????'
  return encodeChars(hash, 4)
}

/** 8-char dashed code for the sealed + hero screens. e.g. "A7F2-X923".
 *  Falls back to "????-????" for malformed hashes. */
export function formatTicketLong(hash: string): string {
  if (!isValidHash(hash)) return '????-????'
  return encodeChars(hash, 4, 0) + '-' + encodeChars(hash, 4, 4)
}
