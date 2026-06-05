// Tiny Web Audio engine for the pack-reveal SFX library.
//
// Lifecycle:
//   1. On mount, fetch all MP3s into ArrayBuffers (no AudioContext yet —
//      mobile autoplay policy forbids creating one before a user gesture).
//   2. On the first user gesture (silhouette tap / scratch / etc), call
//      initFromGesture(), which creates the AudioContext, decodes every
//      buffer in parallel, and unlocks playback for the rest of the session.
//   3. play() / loop() / stopLoop() are no-ops until init completes; they
//      become live as each buffer finishes decoding.
//
// Every sound has a baseline volume in VOLUME so a single play(name) call
// places it at the right level in the mix. Override via the second arg.

export type SfxName =
  | 'silhouette-tap'
  | 'card-enter'
  | 'tap-open'
  | 'flip-whoosh'
  | 'reveal-burst'
  | 'tap-store'
  | 'badge-fly'
  | 'badge-land'
  | 'card-dissolve'
  | 'legendary-anticipation'
  | 'legendary-flip-whoosh'
  | 'legendary-reveal'
  | 'legendary-followup'
  | 'legendary-shimmer'
  | 'legendary-aura-loop'
  | 'collect-all-appear'
  | 'cascade-start'
  | 'cascade-abort'
  | 'finale'
  // Scratch-card polish — added in the AAA polish pass.
  | 'scratch-loop'
  | 'scratch-tick-1'
  | 'scratch-tick-2'
  | 'scratch-tick-3'
  | 'scratch-tick-4'
  | 'scratch-tick-5'
  | 'scratch-tick-6'
  | 'threshold-riser'
  | 'reveal-win'
  | 'reveal-pity'
  | 'collect-confirm'

// Names whose MP3 file is NOT yet present in /public/assets/sfx/. Skipped
// during preload so the network doesn't 404. Keeping them in `ALL` /
// `SfxName` lets every existing caller stay valid; play()/loop() are
// already no-ops when there's no loaded buffer for a name. When a real
// MP3 lands, remove that name from this set.
const MISSING_SFX: ReadonlySet<string> = new Set([
  'scratch-loop',
  'scratch-tick-1',
  'scratch-tick-2',
  'scratch-tick-3',
  'scratch-tick-4',
  'scratch-tick-5',
  'scratch-tick-6',
  'threshold-riser',
  'reveal-win',
  'reveal-pity',
  'collect-confirm'
])

const ALL: readonly SfxName[] = [
  'silhouette-tap',
  'card-enter',
  'tap-open',
  'flip-whoosh',
  'reveal-burst',
  'tap-store',
  'badge-fly',
  'badge-land',
  'card-dissolve',
  'legendary-anticipation',
  'legendary-flip-whoosh',
  'legendary-reveal',
  'legendary-followup',
  'legendary-shimmer',
  'legendary-aura-loop',
  'collect-all-appear',
  'cascade-start',
  'cascade-abort',
  'finale',
  'scratch-loop',
  'scratch-tick-1',
  'scratch-tick-2',
  'scratch-tick-3',
  'scratch-tick-4',
  'scratch-tick-5',
  'scratch-tick-6',
  'threshold-riser',
  'reveal-win',
  'reveal-pity',
  'collect-confirm'
]

// Per-sound baseline volume — UI cues sit lower than hero moments so the
// mix is dynamic. These are multiplied with the per-call override (default 1).
const VOLUME: Record<SfxName, number> = {
  // Background / passive cues
  'legendary-aura-loop':    0.30,
  'scratch-loop':           0.0,  // driven dynamically by velocity (setLoopGain)

  // Foreground UI taps
  'silhouette-tap':         0.70,
  'tap-open':               0.55,
  'tap-store':              0.65,
  'cascade-abort':          0.55,
  'collect-confirm':        0.55,

  // Per-stroke scratch ticks — granular layer, sit under the loop bed
  'scratch-tick-1':         0.45,
  'scratch-tick-2':         0.45,
  'scratch-tick-3':         0.45,
  'scratch-tick-4':         0.45,
  'scratch-tick-5':         0.45,
  'scratch-tick-6':         0.45,

  // Motion / transitions
  'card-enter':             0.55,
  'flip-whoosh':            0.65,
  'badge-fly':              0.55,
  'card-dissolve':          0.45,
  'collect-all-appear':     0.55,

  // Reveals
  'reveal-burst':           0.80,
  'badge-land':             0.80,
  'cascade-start':          0.70,
  'threshold-riser':        0.65,
  'reveal-win':             0.95,
  'reveal-pity':            0.55,

  // Legendary celebration — louder than regular reveals to reinforce rarity
  'legendary-anticipation': 0.70,
  'legendary-flip-whoosh':  0.75,
  'legendary-reveal':       1.00,
  'legendary-followup':     0.85,
  'legendary-shimmer':      0.70,

  // Finale — the dopamine peak
  'finale':                 1.00
}

interface PendingPlay {
  requestedAt: number
  volumeOverride?: number
  isLoop: boolean
}

// Plays queued before the buffer decoded are dropped if older than this.
// 300 ms is long enough to cover the race between a click handler and the
// AudioContext's decode roundtrip, short enough that a stale request never
// fires audibly out of sync with its visual beat.
const STALE_PLAY_MS = 300

interface LoopEntry {
  source: AudioBufferSourceNode
  gain: GainNode
  filter: BiquadFilterNode | null
}

class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private muted = false
  private reducedMotion = false

  // Stage 1 — raw bytes fetched eagerly on mount; doesn't need the context.
  private rawBytes = new Map<SfxName, ArrayBuffer>()
  // Stage 2 — decoded buffers, populated after initFromGesture().
  private buffers = new Map<SfxName, AudioBuffer>()
  // Active loop sources + their dedicated gain (and optional biquad) nodes.
  // Gain is held so stopLoop() can ramp it down before stopping the source —
  // without the ramp, source.stop() at a fixed time still cuts abruptly at
  // whatever amplitude the buffer's playhead happens to be at.
  private loopSources = new Map<SfxName, LoopEntry>()
  // Plays/loops requested before the buffer was decoded — flushed the
  // moment decode completes (subject to STALE_PLAY_MS).
  private pending = new Map<SfxName, PendingPlay>()

  constructor() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const q = window.matchMedia('(prefers-reduced-motion: reduce)')
      this.reducedMotion = q.matches
      const onChange = (e: MediaQueryListEvent) => { this.reducedMotion = e.matches }
      if (typeof q.addEventListener === 'function') {
        q.addEventListener('change', onChange)
      }
    }
  }

  // Kick off the network fetches as soon as the engine module is imported.
  preload(): void {
    if (this.rawBytes.size > 0) return // already preloading
    for (const name of ALL) {
      // Skip names whose MP3 hasn't been generated yet. Listing them
      // explicitly here (rather than removing from SfxName / ALL)
      // keeps every play() / loop() call site valid — those calls
      // already silently no-op when no buffer is loaded for the name.
      // Removing the names from the type would cascade into 20+ TS
      // errors across ScratchCard / scratchAudio. When a Suno-generated
      // MP3 lands in /public/assets/sfx/, just delete the entry here.
      if (MISSING_SFX.has(name)) continue
      fetch(`./assets/sfx/${name}.mp3`)
        .then((r) => {
          if (!r.ok) throw new Error(`sfx ${name} not found`)
          return r.arrayBuffer()
        })
        .then((bytes) => {
          this.rawBytes.set(name, bytes)
          // If the context is already up (initFromGesture has been called),
          // decode immediately so this sound becomes playable.
          if (this.ctx) this.decode(name, bytes)
        })
        .catch(() => {
          // Network failure on a single SFX shouldn't break the app — the
          // play() call will silently no-op for missing buffers. New
          // scratch-* assets that haven't been generated yet hit this path
          // until the Suno-generated MP3s land in /public/assets/sfx/.
        })
    }
  }

  // Must be called from a user-gesture handler (the first silhouette tap).
  // Creates the AudioContext + master gain, then decodes whatever bytes
  // are already fetched. Subsequent fetches will decode on arrival.
  initFromGesture(): void {
    if (this.ctx) {
      // Existing context may have been suspended by browser power policy
      // (long backgrounded tab, etc) — resume it on every gesture call so
      // we recover from a tab-switch + return cleanly.
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => { /* harmless */ })
      }
      return
    }
    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    } catch {
      return
    }
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = 1
    this.masterGain.connect(this.ctx.destination)
    // Decode everything we've already fetched.
    for (const [name, bytes] of this.rawBytes) {
      this.decode(name, bytes)
    }
  }

  private decode(name: SfxName, bytes: ArrayBuffer): void {
    if (!this.ctx) return
    // Clone the ArrayBuffer because decodeAudioData can detach the source
    // and we may want to re-decode on context-recreate edge cases.
    const slice = bytes.slice(0)
    this.ctx.decodeAudioData(slice)
      .then((decoded) => {
        this.buffers.set(name, decoded)
        // Flush any play() / loop() that came in before decode finished.
        // Critical for the very first silhouette tap and the card-enter
        // that fires ~one frame later — both race the decode pipeline.
        const queued = this.pending.get(name)
        if (queued) {
          this.pending.delete(name)
          if (performance.now() - queued.requestedAt < STALE_PLAY_MS) {
            if (queued.isLoop) this.loop(name, queued.volumeOverride)
            else this.play(name, queued.volumeOverride)
          }
        }
      })
      .catch(() => {
        // Decode failure — drop the queued request so it doesn't replay
        // forever waiting on a buffer that'll never arrive.
        this.pending.delete(name)
      })
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.masterGain) this.masterGain.gain.value = muted ? 0 : 1
    if (muted) {
      // Stop all loops on mute so they don't queue up audio time.
      for (const [name, { source }] of this.loopSources) {
        try { source.stop() } catch { /* already stopped */ }
        this.loopSources.delete(name)
      }
    }
  }

  isMuted(): boolean { return this.muted }

  play(name: SfxName, volumeOverride?: number): void {
    if (this.muted) return
    // Context not yet created (no user gesture yet) — drop silently;
    // the upcoming gesture will rebuild from there.
    if (!this.ctx || !this.masterGain) return
    const buffer = this.buffers.get(name)
    if (!buffer) {
      // Buffer fetched/decoded race — queue and let decode flush.
      this.pending.set(name, { requestedAt: performance.now(), volumeOverride, isLoop: false })
      return
    }
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const gain = this.ctx.createGain()
    gain.gain.value = (VOLUME[name] ?? 1) * (volumeOverride ?? 1)
    source.connect(gain)
    gain.connect(this.masterGain)
    source.start()
  }

  // Like play() but skipped under prefers-reduced-motion. Use for purely
  // celebratory beats (reveal stingers, fanfares). Functional confirms
  // (taps, dismiss) should keep using play() so screen readers / mute
  // toggles still get audible state changes.
  playCelebration(name: SfxName, volumeOverride?: number): void {
    if (this.reducedMotion) return
    this.play(name, volumeOverride)
  }

  // loopOptions.withFilter inserts a lowpass biquad between source and
  // gain. Use for the scratch-loop so velocity can drive cutoff via
  // setLoopFilter().
  loop(
    name: SfxName,
    volumeOverride?: number,
    loopOptions?: { withFilter?: boolean }
  ): void {
    if (this.muted) return
    if (!this.ctx || !this.masterGain) return
    if (this.loopSources.has(name)) return // already looping
    const buffer = this.buffers.get(name)
    if (!buffer) {
      // Same race protection as play(). The legendary aura is the only
      // looped sound and it's preceded by a flip + reveal beat (~1.7 s
      // total) so this almost never fires, but the race is worth covering.
      this.pending.set(name, { requestedAt: performance.now(), volumeOverride, isLoop: true })
      return
    }
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const gain = this.ctx.createGain()
    gain.gain.value = (VOLUME[name] ?? 1) * (volumeOverride ?? 1)

    let filter: BiquadFilterNode | null = null
    if (loopOptions?.withFilter) {
      filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 600
      filter.Q.value = 1.2
      source.connect(filter)
      filter.connect(gain)
    } else {
      source.connect(gain)
    }
    gain.connect(this.masterGain)
    source.start()
    this.loopSources.set(name, { source, gain, filter })
  }

  // Smoothly set the gain of an active loop. setTargetAtTime gives an
  // exponential approach so dynamic loops (scratch-loop driven by stroke
  // velocity) don't click on every change.
  setLoopGain(name: SfxName, value: number, smoothing = 0.04): void {
    if (!this.ctx) return
    const entry = this.loopSources.get(name)
    if (!entry) return
    const baseline = VOLUME[name] ?? 1
    const target = baseline === 0
      ? value                        // sounds like scratch-loop carry their dynamic level here
      : Math.max(0, Math.min(1, value)) * baseline
    try {
      const t = this.ctx.currentTime
      entry.gain.gain.setTargetAtTime(target, t, smoothing)
    } catch { /* harmless */ }
  }

  // Smoothly set the cutoff of the loop's biquad lowpass. No-op if the
  // loop wasn't started with `withFilter: true`.
  setLoopFilter(name: SfxName, freqHz: number, smoothing = 0.05): void {
    if (!this.ctx) return
    const entry = this.loopSources.get(name)
    if (!entry || !entry.filter) return
    try {
      const t = this.ctx.currentTime
      entry.filter.frequency.setTargetAtTime(freqHz, t, smoothing)
    } catch { /* harmless */ }
  }

  isLooping(name: SfxName): boolean {
    return this.loopSources.has(name)
  }

  stopLoop(name: SfxName, fadeOut = 0.20): void {
    // Cancel any pending loop request that hasn't even fired yet —
    // otherwise stopLoop before decode would be ignored and the loop
    // would still start once the buffer arrives.
    const pending = this.pending.get(name)
    if (pending?.isLoop) this.pending.delete(name)

    const entry = this.loopSources.get(name)
    if (!entry) return
    this.loopSources.delete(name)
    const { source, gain } = entry
    if (!this.ctx) {
      try { source.stop() } catch { /* already stopped */ }
      return
    }
    // Ramp the gain down on the loop's dedicated gain node, THEN stop the
    // source. Without the ramp, source.stop() cuts whatever amplitude
    // the playhead happens to be at — clicky on a sustained pad like
    // legendary-aura-loop or scratch-loop.
    const now = this.ctx.currentTime
    const stopAt = now + fadeOut + 0.01
    try {
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0, now + fadeOut)
      source.stop(stopAt)
    } catch {
      // already stopped or scheduling failed
    }
  }
}

export const sfx = new AudioEngine()

// Kick off the eager preload as soon as this module is imported. Browser
// will queue 20 parallel fetches; on a typical mobile connection they
// arrive in <500ms, well before the first user interaction is possible.
sfx.preload()
