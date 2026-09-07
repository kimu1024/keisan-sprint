export type VoiceResult = { transcript: string; value: number | null; error?: string };
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { results: ArrayLike<SpeechResult> };
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

// Each question owns a separate SpeechRecognition instance. Starting the next
// instance is queued until the browser releases the previous microphone, while
// result delivery remains asynchronous and attached to the original ticket.
export class VoiceCapture {
  private tail: Promise<void> = Promise.resolve();
  private tickets = new Set<VoiceTicket>();

  begin(update: (status: string) => void): VoiceTicket {
    let recognition: Recognition | undefined;
    let transcript = '';
    let error: string | undefined;
    let listening = false;
    let ended = false;
    let sealed = false;
    let settled = false;
    let released = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let release!: () => void;
    let resolve!: (result: VoiceResult) => void;
    const result = new Promise<VoiceResult>((done) => { resolve = done; });
    const previous = this.tail;
    this.tail = new Promise<void>((done) => {
      release = () => { if (!released) { released = true; done(); } };
    });

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const value = parseSpokenNumber(transcript);
      resolve({ transcript, value, error: value === null ? error : undefined });
      this.tickets.delete(ticket);
    };

    const skipQueued = () => {
      error = 'マイク切替中に次へ進みました';
      void previous.then(() => { release(); settle(); });
    };

    const ticket: VoiceTicket = {
      finish: () => {
        if (sealed) return result;
        sealed = true;
        if (!listening) {
          if (ended) settle();
          else {
            try { recognition?.abort(); } catch { /* Not started or already stopped. */ }
            skipQueued();
          }
          return result;
        }
        try { recognition?.stop(); } catch { ended = true; release(); settle(); }
        if (settled) return result;
        timeout = setTimeout(() => {
          error = transcript ? error : '認識がタイムアウトしました';
          ended = true;
          try { recognition?.abort(); } catch { /* Already stopped. */ }
          release(); settle();
        }, 8000);
        return result;
      },
      cancel: () => {
        if (settled) return;
        sealed = true;
        error = '音声入力を取り消しました';
        if (recognition) {
          try { recognition.abort(); } catch { release(); }
        } else void previous.then(release);
        settle();
      },
    };
    this.tickets.add(ticket);
    update('マイク切替中 · 次の問題を考えて待ってね');

    void previous.then(() => {
      if (sealed) { release(); settle(); return; }
      const Constructor = recognitionConstructor();
      if (!Constructor) { error = '音声認識に対応していません'; ended = true; release(); update(error); return; }
      try {
        recognition = new Constructor();
        recognition.lang = 'ja-JP'; recognition.continuous = true; recognition.interimResults = true;
        recognition.onstart = () => {
          if (sealed) { try { recognition?.abort(); } catch { release(); } return; }
          listening = true;
          update('聞き取り中 · この問題の答えを言って「次へ」');
        };
        recognition.onresult = (event) => {
          if (settled || ended) return;
          transcript = Array.from(event.results).map((item) => item[0].transcript.trim()).filter(Boolean).join(' / ');
          if (!sealed) update(`聞き取り中 · 最後の数字：${parseSpokenNumber(transcript) ?? '…'}（まだ確定前）`);
        };
        recognition.onerror = (event) => {
          if (ended) return;
          error = event.error === 'not-allowed' ? 'マイクを許可してください' : `聞き取れませんでした（${event.error}）`;
          if (!sealed) update(`${error} · テンキーで回答できます`);
        };
        recognition.onend = () => {
          listening = false; ended = true; release();
          if (sealed) settle();
          else update(transcript ? `認識：${transcript} · 次へ進めます` : `${error ?? '音声がありません'} · マイクを再開できます`);
        };
        recognition.start();
      } catch {
        error = 'マイクを開始できませんでした'; ended = true; release(); update(`${error} · テンキーで回答できます`);
      }
    });
    return ticket;
  }

  cancelAll() { for (const ticket of [...this.tickets]) ticket.cancel(); }
}
