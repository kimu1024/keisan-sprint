export type VoiceResult = { transcript: string; value: number | null; error?: string };
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null; onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type Constructor = new () => Recognition;

export function recognitionConstructor(): Constructor | undefined {
  const scope = window as typeof window & { SpeechRecognition?: Constructor; webkitSpeechRecognition?: Constructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export function parseSpokenNumber(raw: string): number | null {
  let text = raw.normalize('NFKC').trim();
  const kana: Record<string, string> = { れい: '零', ゼロ: '零', ぜろ: '零', いち: '一', に: '二', さん: '三', よん: '四', し: '四', ご: '五', ろく: '六', なな: '七', しち: '七', はち: '八', きゅう: '九', く: '九', じゅう: '十' };
  text = text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
  text = text.replace(/まいなす/g, '-');
  text = text.replace(/じゅう|きゅう|いち|さん|よん|ろく|なな|しち|はち|ぜろ|れい|に|し|ご|く/g, (part) => kana[part]);
  const tokens = text.match(/-?\d+(?:\.\d+)?|-?[零一二三四五六七八九十百千万億]+/g);
  text = tokens?.at(-1) ?? '';
  if (/^\d{1,3}$/.test(text)) return Number(text);
  const digits = '零一二三四五六七八九';
  if (/^[零一二三四五六七八九]$/.test(text)) return digits.indexOf(text);
  if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(text)) {
    const [tens, ones] = text.split('十');
    return (tens ? digits.indexOf(tens) : 1) * 10 + (ones ? digits.indexOf(ones) : 0);
  }
  return null;
}

export type VoiceTicket = { finish(): Promise<VoiceResult>; cancel(): void };
type TicketState = {
  update: (status: string) => void; segments: Map<number, string>; finalSegments: Set<number>;
  sealed: boolean; settled: boolean; error?: string; timeout?: ReturnType<typeof setTimeout>;
  promise: Promise<VoiceResult>; resolve: (result: VoiceResult) => void;
};

// A single recognizer stays open for the sprint. Each result index is permanently
// assigned to its original question, including interim-to-final updates.
export class VoiceCapture {
  private recognition?: Recognition;
  private enabled = false;
  private listening = false;
  private connecting = false;
  private restarting = false;
  private active?: TicketState;
  private pending: TicketState[] = [];
  private owners = new Map<number, TicketState>();
  private all = new Set<TicketState>();

  begin(update: (status: string) => void): VoiceTicket {
    this.enabled = true;
    let resolve!: (result: VoiceResult) => void;
    const promise = new Promise<VoiceResult>((done) => { resolve = done; });
    const state: TicketState = { update, segments: new Map(), finalSegments: new Set(), sealed: false, settled: false, promise, resolve };
    this.active = state;
    this.all.add(state);
    if (this.listening) update('聞き取り中 · 答えを言って「次へ」');
    else { update('マイク接続中 · つながると自動で聞き取りを始めます'); this.ensureRecognition(); }

    return {
      finish: () => {
        if (state.sealed) return state.promise;
        state.sealed = true;
        if (this.active === state) this.active = undefined;
        if (state.finalSegments.size || state.error) this.settle(state);
        else {
          this.pending.push(state);
          state.timeout = setTimeout(() => { state.error = '認識がタイムアウトしました'; this.settle(state); }, 8000);
        }
        return state.promise;
      },
      cancel: () => {
        if (state.settled) return;
        state.sealed = true; state.error = '音声入力を取り消しました';
        if (this.active === state) this.active = undefined;
        this.settle(state);
      },
    };
  }

  cancelAll() {
    this.enabled = false;
    for (const state of [...this.all]) { state.error = '音声入力を取り消しました'; this.settle(state); }
    this.active = undefined; this.pending = []; this.owners.clear();
    try { this.recognition?.abort(); } catch { /* Already stopped. */ }
    this.recognition = undefined; this.listening = false; this.connecting = false;
  }

  private transcript(state: TicketState) {
    return [...state.segments.entries()].sort(([a], [b]) => a - b).map(([, value]) => value).filter(Boolean).join(' / ');
  }

  private settle(state: TicketState) {
    if (state.settled) return;
    state.settled = true; clearTimeout(state.timeout);
    this.pending = this.pending.filter((item) => item !== state);
    const transcript = this.transcript(state);
    const value = parseSpokenNumber(transcript);
    state.resolve({ transcript, value, error: value === null ? state.error : undefined });
    this.all.delete(state);
  }

  private ensureRecognition() {
    if (!this.enabled || this.listening || this.connecting || this.restarting) return;
    const Constructor = recognitionConstructor();
    if (!Constructor) { this.failOpenTickets('音声認識に対応していません'); return; }
    try {
      this.connecting = true;
      const recognition = new Constructor();
      this.recognition = recognition;
      // SpeechRecognition result indexes restart from zero with a new instance.
      this.owners.clear();
      recognition.lang = 'ja-JP'; recognition.continuous = true; recognition.interimResults = true;
      recognition.onstart = () => { this.connecting = false; this.listening = true; this.active?.update('聞き取り中 · 答えを言って「次へ」'); };
      recognition.onresult = (event) => this.handleResult(event);
      recognition.onerror = (event) => {
        const fatal = event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture';
        if (fatal) { this.enabled = false; this.connecting = false; this.failOpenTickets(event.error === 'audio-capture' ? 'マイクを使用できません' : 'マイクを許可してください'); }
        else this.active?.update('聞き取りを再接続中 · テンキーは使えます');
      };
      recognition.onend = () => {
        this.listening = false; this.connecting = false; this.recognition = undefined;
        if (!this.enabled) return;
        this.active?.update('マイク再接続中 · そのまま待ってね');
        this.restarting = true;
        setTimeout(() => { this.restarting = false; this.ensureRecognition(); }, 80);
      };
      recognition.start();
    } catch {
      this.connecting = false;
      this.restarting = true;
      setTimeout(() => { this.restarting = false; this.ensureRecognition(); }, 150);
    }
  }

  private handleResult(event: RecognitionEvent) {
    const results = Array.from(event.results);
    const waiting = this.pending.filter((state) => !state.settled);
    let waitingIndex = 0;
    let fallbackOwner = this.owners.get(event.resultIndex) ?? waiting[0] ?? this.active;
    if (!fallbackOwner) return;
    const touched = new Set<TicketState>();
    for (let index = event.resultIndex; index < results.length; index += 1) {
      const result = results[index];
      const existingOwner = this.owners.get(index);
      const owner = existingOwner ?? fallbackOwner;
      this.owners.set(index, owner);
      if (owner.settled) continue;
      owner.segments.set(index, result[0].transcript.trim());
      if (result.isFinal) owner.finalSegments.add(index);
      touched.add(owner);
      // A final numeric result is one queued answer. Empty fragments stay with
      // the same question, while a batch of numeric finals advances the queue.
      if (!existingOwner && result.isFinal && parseSpokenNumber(result[0].transcript) !== null && waiting[waitingIndex] === owner) {
        waitingIndex += 1;
        fallbackOwner = waiting[waitingIndex] ?? this.active ?? owner;
      }
    }
    for (const owner of touched) {
      const transcript = this.transcript(owner);
      if (!owner.sealed) owner.update(`聞き取り中 · 最後の数字：${parseSpokenNumber(transcript) ?? '…'}（まだ確定前）`);
      if (owner.sealed && owner.finalSegments.size) this.settle(owner);
    }
  }

  private failOpenTickets(message: string) {
    this.active?.update(`${message} · テンキーで回答できます`);
    for (const state of [...this.all]) { state.error = message; if (state.sealed) this.settle(state); }
  }
}
