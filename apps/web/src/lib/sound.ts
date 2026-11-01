/** Short two-tone warning beep for overspeed alerts (Web Audio, no assets). */
export function playAlertSound(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (const [start, freq] of [
      [0, 880],
      [0.18, 660],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.12, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.16);
    }
    window.setTimeout(() => void ctx.close(), 600);
  } catch {
    /* audio unavailable — alerts still arrive as toasts */
  }
}
