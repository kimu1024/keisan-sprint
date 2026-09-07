'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VoiceCapture, recognitionConstructor, type VoiceTicket } from './voice';

type Theme = 'coral' | 'apricot' | 'lemon' | 'mint' | 'aqua' | 'sky' | 'lavender' | 'rose';
type Genre = 'add-simple' | 'add-carry' | 'sub-simple' | 'sub-borrow' | 'multiply';
type Phase = 'setup' | 'countdown' | 'quiz' | 'result' | 'review' | 'complete';
type ReviewKind = 'mistakes' | 'slow' | 'combined';

type Problem = {
  id: string;
  left: number;
  right: number;
  operator: '＋' | '−' | '×';
  answer: number;
};

type RecordItem = Problem & { elapsed: number; mistakes: number; givenAnswer?: number | null; transcript?: string; status?: 'pending' | 'done' | 'unrecognized' };
type LastResult = {
  sequence: number;
  problem: Problem;
  givenAnswer: number | null;
  isCorrect: boolean;
};

const genreOptions: { id: Genre; icon: string; title: string; note: string }[] = [
  { id: 'add-simple', icon: '＋', title: 'たし算', note: 'くり上がりなし' },
  { id: 'add-carry', icon: '＋', title: 'たし算', note: 'くり上がりあり' },
  { id: 'sub-simple', icon: '−', title: 'ひき算', note: 'くり下がりなし' },
  { id: 'sub-borrow', icon: '−', title: 'ひき算', note: 'くり下がりあり' },
  { id: 'multiply', icon: '×', title: '九九', note: '1〜9の段' },
];

const paletteOptions: { id: Theme; label: string; swatch: string }[] = [
  { id: 'coral', label: 'コーラルレッド', swatch: '#ef7d86' },
  { id: 'apricot', label: 'アプリコット', swatch: '#eea562' },
  { id: 'lemon', label: 'レモンイエロー', swatch: '#dfbd55' },
  { id: 'mint', label: 'ミントグリーン', swatch: '#62bb91' },
  { id: 'aqua', label: 'アクア', swatch: '#55b9b6' },
  { id: 'sky', label: 'スカイブルー', swatch: '#659fd3' },
  { id: 'lavender', label: 'ラベンダー', swatch: '#9887d3' },
  { id: 'rose', label: 'ローズピンク', swatch: '#db83ad' },
];

const multiplicationTables = Array.from({ length: 9 }, (_, index) => index + 1);

function makeProblem(id: string, left: number, right: number, operator: Problem['operator'], answer: number): Problem {
  return { id, left, right, operator, answer };
}

function buildProblemBank(genres: Genre[], tables: number[]) {
  const bank: Problem[] = [];

  if (genres.includes('add-simple')) {
    for (let left = 1; left <= 9; left += 1) {
      for (let right = 1; right <= 9; right += 1) {
        if (left + right <= 9) bank.push(makeProblem(`add-simple-${left}-${right}`, left, right, '＋', left + right));
      }
    }
  }

  if (genres.includes('add-carry')) {
    for (let left = 1; left <= 9; left += 1) {
      for (let right = 1; right <= 9; right += 1) {
        if (left + right >= 10) bank.push(makeProblem(`add-carry-${left}-${right}`, left, right, '＋', left + right));
      }
    }
  }

  if (genres.includes('sub-simple')) {
    for (let left = 2; left <= 9; left += 1) {
      for (let right = 1; right < left; right += 1) {
        bank.push(makeProblem(`sub-simple-${left}-${right}`, left, right, '−', left - right));
      }
    }
  }

  if (genres.includes('sub-borrow')) {
    for (let result = 1; result <= 9; result += 1) {
      for (let right = 1; right <= 9; right += 1) {
        const left = result + right;
        if (left >= 10) bank.push(makeProblem(`sub-borrow-${left}-${right}`, left, right, '−', result));
      }
    }
  }

  if (genres.includes('multiply')) {
    for (const table of tables) {
      for (let right = 1; right <= 9; right += 1) {
        bank.push(makeProblem(`multiply-${table}-${right}`, table, right, '×', table * right));
      }
    }
  }

  return bank;
}

function shuffle<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function stripRecord(record: RecordItem): Problem {
  return makeProblem(record.id, record.left, record.right, record.operator, record.answer);
}

function formatTime(ms: number) {
  const totalHundredths = Math.floor(ms / 10);
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(2)}秒`;
}

function PerformanceChart({ records, theme }: { records: RecordItem[]; theme: Theme }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !records.length) return;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.scale(ratio, ratio);

      const styles = getComputedStyle(canvas);
      const accent = styles.getPropertyValue('--accent').trim() || '#659fd3';
      const ink = styles.getPropertyValue('--ink').trim() || '#183153';
      const muted = styles.getPropertyValue('--muted').trim() || '#738097';
      const padding = { top: 28, right: 52, bottom: 34, left: 48 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const maximum = Math.max(...records.map((record) => record.elapsed), 1000);
      const ceiling = Math.ceil(maximum / 1000) * 1000;
      let cumulativeTotal = 0;
      const cumulative = records.map((record) => {
        cumulativeTotal += record.elapsed;
        return cumulativeTotal;
      });
      const cumulativeCeiling = Math.max(Math.ceil(cumulativeTotal / 1000) * 1000, 1000);
      const x = (index: number) => padding.left + (records.length === 1 ? chartWidth / 2 : (index / (records.length - 1)) * chartWidth);
      const paceY = (value: number) => padding.top + chartHeight - (value / ceiling) * chartHeight;
      const cumulativeY = (value: number) => padding.top + chartHeight - (value / cumulativeCeiling) * chartHeight;

      context.clearRect(0, 0, width, height);
      context.font = '700 10px system-ui, sans-serif';
      context.textBaseline = 'middle';
      for (let line = 0; line <= 4; line += 1) {
        const value = (ceiling / 4) * line;
        const lineY = paceY(value);
        context.strokeStyle = `${ink}14`;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(padding.left, lineY);
        context.lineTo(width - padding.right, lineY);
        context.stroke();
        context.fillStyle = muted;
        context.textAlign = 'right';
        context.fillText(`${(value / 1000).toFixed(value < 1000 ? 1 : 0)}s`, padding.left - 9, lineY);
        const cumulativeValue = (cumulativeCeiling / 4) * line;
        context.fillStyle = ink;
        context.textAlign = 'left';
        context.fillText(`${(cumulativeValue / 1000).toFixed(cumulativeValue < 1000 ? 1 : 0)}s`, width - padding.right + 9, lineY);
      }

      context.font = '900 8px system-ui, sans-serif';
      context.textBaseline = 'top';
      context.fillStyle = accent;
      context.textAlign = 'left';
      context.fillText('1問', 5, 6);
      context.fillStyle = ink;
      context.textAlign = 'right';
      context.fillText('累積', width - 5, 6);

      const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
      gradient.addColorStop(0, `${accent}55`);
      gradient.addColorStop(1, `${accent}06`);
      context.beginPath();
      records.forEach((record, index) => {
        if (index === 0) context.moveTo(x(index), paceY(record.elapsed));
        else context.lineTo(x(index), paceY(record.elapsed));
      });
      context.lineTo(x(records.length - 1), padding.top + chartHeight);
      context.lineTo(x(0), padding.top + chartHeight);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      context.beginPath();
      records.forEach((record, index) => {
        if (index === 0) context.moveTo(x(index), paceY(record.elapsed));
        else context.lineTo(x(index), paceY(record.elapsed));
      });
      context.strokeStyle = accent;
      context.lineWidth = 3;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.stroke();

      const slowest = Math.max(...records.map((record) => record.elapsed));
      records.forEach((record, index) => {
        context.beginPath();
        context.arc(x(index), paceY(record.elapsed), record.elapsed === slowest ? 5 : 3, 0, Math.PI * 2);
        context.fillStyle = record.elapsed === slowest ? '#ff4775' : accent;
        context.fill();
        context.strokeStyle = '#ffffff';
        context.lineWidth = 2;
        context.stroke();
      });

      context.beginPath();
      cumulative.forEach((value, index) => {
        if (index === 0) context.moveTo(x(index), cumulativeY(value));
        else context.lineTo(x(index), cumulativeY(value));
      });
      context.strokeStyle = ink;
      context.lineWidth = 2.5;
      context.setLineDash([7, 5]);
      context.stroke();
      context.setLineDash([]);

      context.fillStyle = muted;
      context.textAlign = 'center';
      context.textBaseline = 'top';
      const tickCount = Math.min(5, records.length);
      for (let tick = 0; tick < tickCount; tick += 1) {
        const index = tickCount === 1 ? 0 : Math.round((tick / (tickCount - 1)) * (records.length - 1));
        context.fillText(`${index + 1}問`, x(index), height - 22);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [records, theme]);

  return <canvas ref={canvasRef} className="performance-chart" aria-label="問題ごとの回答時間と累積時間のグラフ" />;
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>('coral');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [phase, setPhase] = useState<Phase>('setup');
  const [countdown, setCountdown] = useState(3);
  const [selectedGenres, setSelectedGenres] = useState<Genre[]>(['add-simple', 'add-carry']);
  const [selectedTables, setSelectedTables] = useState<number[]>(multiplicationTables);
  const [problemCount, setProblemCount] = useState(50);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewProblems, setReviewProblems] = useState<Problem[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewKind, setReviewKind] = useState<ReviewKind>('mistakes');
  const [answer, setAnswer] = useState('');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const mistakes = records.filter((record) => record.mistakes > 0).length;
  const pendingCount = records.filter((record) => record.status === 'pending').length;
  const unrecognizedCount = records.filter((record) => record.status === 'unrecognized').length;
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceRetry, setVoiceRetry] = useState(0);
  const [voiceReady, setVoiceReady] = useState(false);
  const voiceCapture = useRef<VoiceCapture | null>(null);
  const voiceTicket = useRef<VoiceTicket | null>(null);
  const runId = useRef(0);
  const submittedQuestion = useRef('');
  const [elapsed, setElapsed] = useState(0);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const sessionStartedAt = useRef(0);
  const questionStartedAt = useRef(0);
  const voiceWaitStartedAt = useRef<number | null>(null);
  const resultSequence = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setVoiceSupported(Boolean(recognitionConstructor()));
    voiceCapture.current = new VoiceCapture();
    return () => { runId.current += 1; voiceCapture.current?.cancelAll(); };
  }, []);

  const problemBank = useMemo(
    () => buildProblemBank(selectedGenres, selectedTables),
    [selectedGenres, selectedTables],
  );
  const maxProblemCount = problemBank.length;
  const selectedCount = maxProblemCount ? Math.min(problemCount, maxProblemCount) : 0;

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('keisan-palette');
    if (paletteOptions.some((option) => option.id === savedTheme)) {
      setTheme(savedTheme as Theme);
      return;
    }
    const oldTheme = window.localStorage.getItem('keisan-theme');
    if (oldTheme === 'cool') setTheme('sky');
  }, []);

  useEffect(() => {
    setSoundEnabled(window.localStorage.getItem('keisan-sound') !== 'off');
  }, []);

  useEffect(() => {
    if (maxProblemCount > 0) setProblemCount((value) => Math.min(Math.max(value, 1), maxProblemCount));
  }, [maxProblemCount]);

  useEffect(() => {
    if (phase !== 'quiz' && phase !== 'review') return;
    const timer = window.setInterval(() => setElapsed((voiceWaitStartedAt.current ?? performance.now()) - sessionStartedAt.current), 50);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    const timer = window.setTimeout(() => {
      if (countdown > 1) {
        setCountdown((value) => value - 1);
        return;
      }
      const now = performance.now();
      sessionStartedAt.current = now;
      questionStartedAt.current = now;
      if (voiceEnabled) {
        voiceWaitStartedAt.current = now;
        setVoiceReady(false);
      }
      setElapsed(0);
      setPhase('quiz');
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, phase, voiceEnabled]);

  const chooseTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    window.localStorage.setItem('keisan-palette', nextTheme);
  };

  const toggleSound = () => {
    setSoundEnabled((current) => {
      const next = !current;
      window.localStorage.setItem('keisan-sound', next ? 'on' : 'off');
      return next;
    });
  };

  const playAnswerSound = useCallback((isCorrect: boolean) => {
    if (!soundEnabled) return;
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = audioContextRef.current ?? new AudioContextClass();
    audioContextRef.current = audioContext;
    if (audioContext.state === 'suspended') void audioContext.resume();

    const start = audioContext.currentTime;
    const notes = isCorrect
      ? [{ frequency: 660, at: 0 }, { frequency: 880, at: 0.075 }]
      : [{ frequency: 260, at: 0 }, { frequency: 190, at: 0.09 }];
    notes.forEach(({ frequency, at }) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = isCorrect ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, start + at);
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(isCorrect ? 0.12 : 0.09, start + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.12);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start + at);
      oscillator.stop(start + at + 0.13);
    });
  }, [soundEnabled]);

  const toggleGenre = (genre: Genre) => {
    setSelectedGenres((current) =>
      current.includes(genre) ? current.filter((item) => item !== genre) : [...current, genre],
    );
  };

  const toggleTable = (table: number) => {
    setSelectedTables((current) =>
      current.includes(table) ? current.filter((item) => item !== table) : [...current, table].sort((a, b) => a - b),
    );
  };

  const currentProblem = phase === 'review' ? reviewProblems[reviewIndex] : problems[currentIndex];
  const nextProblem = phase === 'review' ? reviewProblems[reviewIndex + 1] : problems[currentIndex + 1];
  const progressCurrent = phase === 'review' ? reviewIndex + 1 : currentIndex + 1;
  const progressTotal = phase === 'review' ? reviewProblems.length : problems.length;

  const resumeVoiceClock = useCallback((ready: boolean) => {
    const waitStartedAt = voiceWaitStartedAt.current;
    if (waitStartedAt !== null) {
      const waited = performance.now() - waitStartedAt;
      sessionStartedAt.current += waited;
      questionStartedAt.current += waited;
      voiceWaitStartedAt.current = null;
    }
    setVoiceReady(ready);
  }, []);

  useEffect(() => {
    if (!voiceEnabled || phase !== 'quiz' || !currentProblem) return;
    let visible = true;
    const ticket = voiceCapture.current?.begin(
      (status) => { if (visible) setVoiceStatus(status); },
      {
        onListening: () => { if (visible) resumeVoiceClock(true); },
        onUnavailable: () => { if (visible) resumeVoiceClock(false); },
      },
    );
    voiceTicket.current = ticket ?? null;
    return () => { visible = false; void ticket?.finish(); };
  }, [voiceEnabled, phase, currentProblem, voiceRetry, resumeVoiceClock]);

  const toggleVoice = async () => {
    if (voiceEnabled) {
      voiceTicket.current?.cancel(); voiceTicket.current = null;
      resumeVoiceClock(false);
      setVoiceEnabled(false); return;
    }
    try {
      setVoiceStatus('マイクの許可を確認中…');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setVoiceEnabled(true);
      setVoiceStatus('音声入力 ON · 答えを言ってから次へ');
    } catch { setVoiceStatus('マイクを許可できませんでした。テンキーで続けられます。'); }
  };

  const beginQuiz = () => {
    if (!selectedCount) return;
    runId.current += 1;
    voiceCapture.current?.cancelAll();
    voiceWaitStartedAt.current = null;
    setVoiceReady(false);
    submittedQuestion.current = '';
    setProblems(shuffle(problemBank).slice(0, selectedCount));
    setRecords([]);
    setCurrentIndex(0);
    setAnswer('');
    setElapsed(0);
    setLastResult(null);
    setCountdown(3);
    setPhase('countdown');
  };

  const incorrectRecords = useMemo(() => records.filter((item) => item.mistakes > 0 || item.status === 'unrecognized'), [records]);

  const startReview = (kind: ReviewKind) => {
    if (pendingCount) return;
    submittedQuestion.current = '';
    setVoiceEnabled(false);
    const slowRecords = [...records]
      .sort((a, b) => b.elapsed - a.elapsed)
      .slice(0, Math.min(10, records.length));
    const source = kind === 'mistakes'
      ? incorrectRecords
      : kind === 'slow'
        ? slowRecords
        : [...new Map([...incorrectRecords, ...slowRecords].map((record) => [record.id, record])).values()];
    const selected = source.map(stripRecord);
    if (!selected.length) return;

    const now = performance.now();
    setReviewKind(kind);
    setReviewProblems(selected);
    setReviewIndex(0);
    setAnswer('');
    setElapsed(0);
    setLastResult(null);
    sessionStartedAt.current = now;
    questionStartedAt.current = now;
    setPhase('review');
  };

  const resetToSetup = () => {
    runId.current += 1;
    voiceCapture.current?.cancelAll();
    voiceWaitStartedAt.current = null;
    setVoiceReady(false);
    setPhase('setup');
    setAnswer('');
    setLastResult(null);
  };

  const moveForward = useCallback((answeredAt: number) => {
    if (phase === 'quiz') {
      if (currentIndex + 1 >= problems.length) {
        setTotalElapsed(answeredAt - sessionStartedAt.current);
        setPhase('result');
      } else {
        setCurrentIndex((value) => value + 1);
        questionStartedAt.current = answeredAt;
        if (voiceEnabled) {
          voiceWaitStartedAt.current = answeredAt;
          setVoiceReady(false);
        }
        setAnswer('');
      }
    } else if (phase === 'review') {
      if (reviewIndex + 1 >= reviewProblems.length) {
        setTotalElapsed(answeredAt - sessionStartedAt.current);
        setPhase('complete');
      } else {
        setReviewIndex((value) => value + 1);
        questionStartedAt.current = performance.now();
        setAnswer('');
      }
    }
  }, [currentIndex, phase, problems.length, reviewIndex, reviewProblems.length, voiceEnabled]);

  const submitAnswer = useCallback(() => {
    if (!currentProblem || (phase !== 'quiz' && phase !== 'review')) return;
    if (answer === '' && !(voiceEnabled && phase === 'quiz' && voiceReady)) return;
    const questionKey = `${runId.current}-${phase}-${currentProblem.id}`;
    if (submittedQuestion.current === questionKey) return;
    submittedQuestion.current = questionKey;
    if (answer !== '' && voiceEnabled && phase === 'quiz') resumeVoiceClock(false);
    const now = performance.now();
    if (answer === '' && voiceEnabled && phase === 'quiz') {
      const problem = currentProblem;
      const thisRun = runId.current;
      const ticket = voiceTicket.current;
      const duration = now - questionStartedAt.current;
      const sequence = ++resultSequence.current;
      voiceTicket.current = null;
      setRecords((current) => [...current, { ...problem, elapsed: duration, mistakes: 0, status: 'pending' }]);
      const recognition = ticket?.finish() ?? Promise.resolve({ transcript: '', value: null, error: '音声がありません' });
      moveForward(now);
      void recognition.then((result) => {
        if (runId.current !== thisRun) return;
        const givenAnswer = result.value;
        setLastResult((current) => current && current.sequence > sequence ? current : {
          sequence, problem, givenAnswer, isCorrect: givenAnswer !== null && givenAnswer === problem.answer,
        });
        setRecords((current) => current.map((record) => record.id === problem.id ? {
          ...record, givenAnswer: result.value, transcript: result.transcript || result.error || '音声がありません',
          status: result.value === null ? 'unrecognized' : 'done',
          mistakes: result.value !== null && result.value !== problem.answer ? 1 : 0,
        } : record));
      });
      return;
    }
    voiceTicket.current?.cancel();
    voiceTicket.current = null;
    const givenAnswer = Number(answer);
    const isCorrect = givenAnswer === currentProblem.answer;
    playAnswerSound(isCorrect);
    resultSequence.current += 1;
    setLastResult({
      sequence: resultSequence.current,
      problem: currentProblem,
      givenAnswer,
      isCorrect,
    });

    if (phase === 'quiz') {
      const record = {
        ...currentProblem,
        elapsed: now - questionStartedAt.current,
        mistakes: isCorrect ? 0 : 1,
        givenAnswer,
        status: 'done' as const,
      };
      setRecords((current) => [...current, record]);
    }

    moveForward(now);
  }, [answer, currentProblem, moveForward, phase, playAnswerSound, resumeVoiceClock, voiceEnabled, voiceReady]);

  const inputDigit = useCallback((digit: string) => {
    setAnswer((value) => (value.length >= 3 ? value : `${value}${digit}`));
  }, []);

  const eraseDigit = useCallback(() => {
    setAnswer((value) => value.slice(0, -1));
  }, []);

  useEffect(() => {
    if (phase !== 'quiz' && phase !== 'review') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (event.repeat && event.key === 'Enter') return;
      if (/^[0-9]$/.test(event.key) || ['Backspace', 'Delete', 'Enter'].includes(event.key)) event.preventDefault();
      if (/^[0-9]$/.test(event.key)) inputDigit(event.key);
      if (event.key === 'Backspace' || event.key === 'Delete') eraseDigit();
      if (event.key === 'Enter') submitAnswer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [eraseDigit, inputDigit, phase, submitAnswer]);

  const averageTime = useMemo(() => {
    if (!records.length) return 0;
    return records.reduce((sum, item) => sum + item.elapsed, 0) / records.length;
  }, [records]);

  const analysis = useMemo(() => {
    const elapsedTimes = records.map((record) => record.elapsed).sort((a, b) => a - b);
    const middle = Math.floor(elapsedTimes.length / 2);
    const median = elapsedTimes.length % 2
      ? elapsedTimes[middle]
      : ((elapsedTimes[middle - 1] ?? 0) + (elapsedTimes[middle] ?? 0)) / 2;
    return {
      fastest: elapsedTimes[0] ?? 0,
      median,
      slowest: elapsedTimes.at(-1) ?? 0,
      slowestRecords: [...records].sort((a, b) => b.elapsed - a.elapsed).slice(0, 10),
    };
  }, [records]);

  const multiplicationNeedsTable = selectedGenres.includes('multiply') && selectedTables.length === 0;

  return (
    <main className="app-shell" data-theme={theme}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className={`app-card phase-${phase}`}>
        <AppHeader theme={theme} chooseTheme={chooseTheme} compact={phase !== 'setup'} />

        {phase === 'setup' && (
          <div className="setup-content">
            <div className="voice-setting">
              <button className="voice-mode-button" onClick={toggleVoice} disabled={!voiceSupported} aria-pressed={voiceEnabled}>
                {voiceEnabled ? '● 音声入力 ON' : '○ 音声入力を使う'}
              </button>
              <small>{voiceSupported ? '声で答えて「次へ」。テンキーも使えます。' : 'このブラウザでは音声入力に対応していません。'}</small>
              <small>音声はブラウザの認識サービスへ送信される場合があります。</small>
              {voiceStatus && <small role="status">{voiceStatus}</small>}
            </div>
            <div className="intro">
              <span className="step-badge">01</span>
              <div>
                <p>いくつでも えらべるよ</p>
                <h2>れんしゅうを えらぼう</h2>
              </div>
            </div>

            <div className="genre-grid">
              {genreOptions.map((option) => {
                const isSelected = selectedGenres.includes(option.id);
                return (
                  <button
                    key={option.id}
                    className={`genre-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleGenre(option.id)}
                    aria-pressed={isSelected}
                  >
                    <span className="genre-icon">{option.icon}</span>
                    <strong>{option.title}</strong>
                    <span>{option.note}</span>
                    <i aria-hidden="true">✓</i>
                  </button>
                );
              })}
            </div>

            {selectedGenres.includes('multiply') && (
              <div className="table-picker">
                <div className="setting-heading">
                  <span className="setting-label">何の段にする？</span>
                  <div className="table-bulk-actions">
                    <button onClick={() => setSelectedTables(multiplicationTables)}>すべてチェック</button>
                    <button onClick={() => setSelectedTables([])}>すべて外す</button>
                  </div>
                </div>
                <div className="table-buttons">
                  {multiplicationTables.map((value) => {
                    const isSelected = selectedTables.includes(value);
                    return (
                    <button
                      key={value}
                      className={isSelected ? 'active' : ''}
                      onClick={() => toggleTable(value)}
                      aria-pressed={isSelected}
                    >
                      <span className="table-check" aria-hidden="true">{isSelected ? '✓' : ''}</span>
                      <strong>{value}</strong><small>の段</small>
                    </button>
                    );
                  })}
                </div>
                {multiplicationNeedsTable && <p className="selection-warning">九九の段を1つ以上えらんでね</p>}
              </div>
            )}

            <footer className="setup-footer">
              <div className="count-setting">
                <div className="count-meta">
                  <span className="setting-label">もんだいすう</span>
                  <span>最大 {maxProblemCount} 問・重複なし</span>
                </div>
                <div className="stepper">
                  <button onClick={() => setProblemCount((value) => Math.max(1, value - 10))} disabled={!maxProblemCount} aria-label="10問減らす">−</button>
                  <strong>{selectedCount}<small>もん</small></strong>
                  <button onClick={() => setProblemCount((value) => Math.min(maxProblemCount, value + 10))} disabled={!maxProblemCount || selectedCount >= maxProblemCount} aria-label="10問増やす">＋</button>
                </div>
                {maxProblemCount > 1 && (
                  <input
                    className="count-slider"
                    type="range"
                    min="1"
                    max={maxProblemCount}
                    step="1"
                    value={selectedCount}
                    onChange={(event) => setProblemCount(Number(event.target.value))}
                    aria-label="問題数"
                  />
                )}
              </div>
              <button className="primary-button" onClick={beginQuiz} disabled={!selectedCount || multiplicationNeedsTable}>
                <span>スタート</span><b>→</b>
              </button>
            </footer>
          </div>
        )}

        {phase === 'countdown' && (
          <div className="countdown-content" aria-live="assertive" aria-label={`スタートまで${countdown}秒`}>
            <p>GET READY</p>
            <div key={countdown} className="countdown-number">
              <span>{countdown}</span>
              <i aria-hidden="true" />
            </div>
            <h2>もうすぐ スタート！</h2>
            <small>しせいをととのえて、テンキーに指をおこう</small>
          </div>
        )}

        {(phase === 'quiz' || phase === 'review') && currentProblem && (
          <div className="quiz-content">
            {voiceEnabled && phase === 'quiz' && (
              <div className={`voice-strip ${voiceReady ? '' : 'voice-preparing'}`}>
                <div><strong>{voiceReady ? '● こたえてOK' : '◷ マイク準備中 · タイム停止'}</strong><span role="status">{voiceStatus}</span><small>{voiceReady ? '答えを言ってから「次へ」' : '問題を見ながら待ってね · テンキーは使えます'}</small></div>
                <button onClick={() => {
                  if (voiceWaitStartedAt.current === null) voiceWaitStartedAt.current = performance.now();
                  setVoiceReady(false);
                  voiceTicket.current?.cancel();
                  setVoiceRetry((value) => value + 1);
                }}>マイク再開</button>
                <button onClick={toggleVoice}>OFF</button>
              </div>
            )}
            {pendingCount > 0 && <RecognitionPending count={pendingCount} />}
            <div className="quiz-status">
              <div className="progress-block">
                <div className="progress-label">
                  <span>{phase === 'review' ? 'REVIEW' : 'SPRINT'}</span>
                  <strong>{progressCurrent}<small> / {progressTotal}</small></strong>
                </div>
                <div className="progress-track"><i style={{ width: `${(progressCurrent / progressTotal) * 100}%` }} /></div>
              </div>
              <div className="quiz-tools">
                <button
                  className={`sound-toggle ${soundEnabled ? 'is-on' : ''}`}
                  onClick={toggleSound}
                  aria-label={soundEnabled ? '効果音をオフにする' : '効果音をオンにする'}
                  aria-pressed={soundEnabled}
                  title={soundEnabled ? '効果音 ON' : '効果音 OFF'}
                >
                  <span aria-hidden="true">{soundEnabled ? '♪' : '×'}</span>
                </button>
                <div className={`stopwatch ${voiceEnabled && !voiceReady ? 'is-paused' : ''}`}><span>{voiceEnabled && !voiceReady ? 'MIC WAIT' : 'TIME'}</span><strong>{formatTime(elapsed)}</strong></div>
              </div>
            </div>

            <div className="answer-stream" aria-live="polite" aria-atomic="true">
              {lastResult ? (
                <div
                  key={lastResult.sequence}
                  className={`answer-result ${lastResult.isCorrect ? 'is-correct' : 'is-wrong'}`}
                >
                  <div className="answer-status">
                    <span>{lastResult.isCorrect ? 'NICE' : 'CHECK'}</span>
                    <strong>{lastResult.isCorrect ? '✓' : '!'}</strong>
                  </div>
                  <div className="answer-equation">
                    <div className="answer-formula">
                      <span>{lastResult.problem.left} {lastResult.problem.operator} {lastResult.problem.right} ＝</span>
                      <strong>{lastResult.problem.answer}</strong>
                    </div>
                    {!lastResult.isCorrect && (
                      <div className="answer-input">
                        <span>入力</span>
                        <del>{lastResult.givenAnswer ?? '未認識'}</del>
                      </div>
                    )}
                  </div>
                  <div className="answer-verdict">{lastResult.isCorrect ? '正解' : '正しい答え'}</div>
                </div>
              ) : (
                <div className="answer-placeholder">
                  <span>LAST ANSWER</span>
                  <i />
                  <small>回答結果がここに流れます</small>
                </div>
              )}
            </div>

            {voiceEnabled && phase === 'quiz' && !voiceReady ? (
              <div className="problem-stage mic-wait-stage" role="status" aria-live="polite" aria-busy="true">
                <div className="mic-wait-pulse" aria-hidden="true"><i /><i /><i /></div>
                <strong>マイクを じゅんびちゅう</strong>
                <small>つながったら もんだいが でるよ</small>
              </div>
            ) : (
            <div key={`${phase}-${currentProblem.id}`} className="problem-stage">
              {nextProblem && (
                <div className="next-problem" aria-label={`次の問題は${nextProblem.left}${nextProblem.operator}${nextProblem.right}`}>
                  <span>NEXT</span>
                  <strong>{nextProblem.left} {nextProblem.operator} {nextProblem.right}</strong>
                  <i aria-hidden="true">›</i>
                </div>
              )}
              {phase === 'review' && (
                <p className="review-kicker">
                  {reviewKind === 'mistakes'
                    ? 'まちがえた問題を、もういちど！'
                    : reviewKind === 'slow'
                      ? 'ゆっくりだった問題を、もういちど！'
                      : '気になる問題を、まとめてチャレンジ！'}
                </p>
              )}
              <div className="equation">
                <span>{currentProblem.left}</span>
                <i>{currentProblem.operator}</i>
                <span>{currentProblem.right}</span>
                <i>＝</i>
                <strong className={answer ? '' : 'empty'}>{answer || '?'}</strong>
              </div>
              <p className="feedback-message">{voiceEnabled && phase === 'quiz' ? voiceReady ? '言い終わったら「次へ」· 数字を押すとテンキー優先' : 'マイク準備中 · タイムは止まっています' : 'こたえを おしてね'}</p>
            </div>
            )}

            <div className="keypad" aria-label="数字入力">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                <button key={digit} onClick={() => inputDigit(String(digit))}>{digit}</button>
              ))}
              <button className="key-zero" onClick={() => inputDigit('0')}>0</button>
              <button className="key-action" onClick={eraseDigit} aria-label="一文字消す">⌫</button>
              <button className="key-submit" onClick={submitAnswer} aria-label="答えを決定" disabled={voiceEnabled && phase === 'quiz' && answer === '' && !voiceReady}>
                <span>{voiceEnabled && phase === 'quiz' && answer === '' ? voiceReady ? '次へ' : 'マイク待ち' : 'こたえる'}</span><b aria-hidden="true">{voiceEnabled && phase === 'quiz' && answer === '' && !voiceReady ? '◷' : '↵'}</b>
              </button>
            </div>
          </div>
        )}

        {phase === 'result' && (
          <div className="result-content">
            {pendingCount > 0 && <RecognitionPending count={pendingCount} finished />}
            <span className="result-symbol">★</span>
            <p className="result-kicker">SPRINT COMPLETE</p>
            <h2>ぜんもん おわったよ！</h2>
            <p className="result-copy">
              {pendingCount > 0 ? `あと${pendingCount}問を判定中です。タイムは計測済みです。` : unrecognizedCount > 0 ? `まちがい${mistakes}問・聞き取り未確認${unrecognizedCount}問。下の一覧で確認しよう。` : mistakes > 0
                ? `まちがえた${mistakes}問を復習して、しっかり覚えよう。`
                : 'ぜんもん正解！ 時間のかかった問題をもう一度やって、もっと速くなろう。'}
            </p>
            <div className="result-stats">
              <div><span>タイム</span><strong>{formatTime(totalElapsed)}</strong></div>
              <div><span>1問へいきん</span><strong>{(averageTime / 1000).toFixed(2)}<small>秒</small></strong></div>
              <div><span>まちがい</span><strong>{mistakes}<small>問</small></strong></div>
            </div>
            {records.some((record) => record.transcript !== undefined || record.status === 'pending') && (
              <section className="answer-audit">
                <h3>回答一覧 <small>認識した言葉もチェック</small></h3>
                <div className="audit-scroll"><table>
                  <thead><tr><th>問</th><th>問題・正答</th><th>回答／音声認識</th><th>結果</th></tr></thead>
                  <tbody>{records.map((record, index) => (
                    <tr key={record.id} className={record.mistakes || record.status === 'unrecognized' ? 'audit-wrong' : ''}>
                      <td>{index + 1}</td><td>{record.left} {record.operator} {record.right} = <strong>{record.answer}</strong></td>
                      <td>{record.status === 'pending' ? '認識中…' : <><strong>{record.givenAnswer ?? '—'}</strong>{record.transcript !== undefined && <small>認識：「{record.transcript}」</small>}</>}</td>
                      <td>{record.status === 'pending' ? '判定待ち' : record.status === 'unrecognized' ? '未確認' : record.mistakes ? '不正解' : '正解'}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </section>
            )}
            <section className="analysis-section">
              <div className="analysis-heading">
                <div>
                  <p>PACE ANALYSIS</p>
                  <h3>スピードを見てみよう</h3>
                </div>
                <span className="analysis-chip">全 {records.length} 問</span>
              </div>
              <div className="chart-card">
                <div className="chart-title">
                  <span>タイム推移</span>
                  <div className="chart-legend" aria-label="グラフの凡例">
                    <small><i className="legend-pace" />1問</small>
                    <small><i className="legend-total" />累積</small>
                    <small><i className="legend-slowest" />最長</small>
                  </div>
                </div>
                <PerformanceChart records={records} theme={theme} />
              </div>
              <div className="pace-summary">
                <div><span>FASTEST</span><strong>{formatSeconds(analysis.fastest)}</strong><small>最速</small></div>
                <div className="pace-focus"><span>MEDIAN</span><strong>{formatSeconds(analysis.median)}</strong><small>まんなか</small></div>
                <div><span>SLOWEST</span><strong>{formatSeconds(analysis.slowest)}</strong><small>最長</small></div>
              </div>
              <div className="slow-ranking">
                <div className="ranking-heading">
                  <div><span>SPEED QUEST</span><h3>じっくり考えた問題</h3></div>
                  <small>長かった順 TOP {analysis.slowestRecords.length}</small>
                </div>
                <div className="ranking-list">
                  {analysis.slowestRecords.map((record, index) => (
                    <div className="ranking-row" key={record.id}>
                      <span className={`rank-number rank-${index + 1}`}>{index + 1}</span>
                      <strong className="rank-problem">{record.left} {record.operator} {record.right}</strong>
                      <span className={`rank-result ${record.mistakes ? 'needs-review' : ''}`}>
                        {record.status === 'pending' ? '判定待ち' : record.status === 'unrecognized' ? '未確認' : record.mistakes ? '要復習' : '正解'}
                      </span>
                      <strong className="rank-time">{formatSeconds(record.elapsed)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <fieldset className="result-actions" disabled={pendingCount > 0}>
              {incorrectRecords.length > 0 && (
                <button className="primary-button result-button" onClick={() => startReview('mistakes')}>
                  <span>{unrecognizedCount ? 'まちがい・未確認' : 'まちがえた'}{incorrectRecords.length}問を復習</span><b>→</b>
                </button>
              )}
              <button className={incorrectRecords.length ? 'secondary-button' : 'primary-button result-button'} onClick={() => startReview('slow')}>
                <span>おそかった{Math.min(10, records.length)}問を復習</span><b>→</b>
              </button>
              {incorrectRecords.length > 0 && (
                <button className="secondary-button combined-review-button" onClick={() => startReview('combined')}>
                  <span>まとめて復習</span><b>↗</b>
                </button>
              )}
            </fieldset>
            <button className="text-button" onClick={resetToSetup}>れんしゅう選択にもどる</button>
          </div>
        )}

        {phase === 'complete' && (
          <div className="result-content complete-content">
            <span className="result-symbol">✓</span>
            <p className="result-kicker">REVIEW COMPLETE</p>
            <h2>{reviewKind === 'mistakes' ? 'まちがい復習 おわり！' : reviewKind === 'slow' ? 'スピード復習 おわり！' : 'まとめて復習 おわり！'}</h2>
            <p className="result-copy">くり返すほど、計算はどんどん得意になるよ。今日のチャレンジ、おつかれさま！</p>
            <div className="review-time"><span>ふくしゅうタイム</span><strong>{formatTime(totalElapsed)}</strong></div>
            <button className="primary-button result-button" onClick={resetToSetup}>
              <span>もういちど れんしゅう</span><b>↻</b>
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function RecognitionPending({ count, finished = false }: { count: number; finished?: boolean }) {
  return (
    <div className="recognition-pending" role="status" aria-live="polite">
      <i className="recognition-spinner" aria-hidden="true" />
      <div><strong>音声の認識待ち <b>{count}問</b></strong>
        <small>{finished ? '回答を確認中です。完了すると結果と復習ボタンが更新されます。' : '前の回答を確認中です。次の問題・テンキーはそのまま使えます。'}</small>
      </div>
    </div>
  );
}

function AppHeader({ theme, chooseTheme, compact }: { theme: Theme; chooseTheme: (theme: Theme) => void; compact: boolean }) {
  return (
    <header className={`topbar ${compact ? 'compact' : ''}`}>
      <div className="brand">
        <span className="brand-mark">∴</span>
        <div>
          <p className="eyebrow">CALCULATION PRACTICE</p>
          <h1>けいさんスプリント</h1>
        </div>
      </div>
      <div className="palette-picker" aria-label="カラーパターンを選ぶ">
        <span className="palette-label">COLOR</span>
        <div className="palette-swatches">
          {paletteOptions.map((option) => (
            <button
              key={option.id}
              className={theme === option.id ? 'active' : ''}
              style={{ backgroundColor: option.swatch }}
              onClick={() => chooseTheme(option.id)}
              aria-label={`${option.label}に変更`}
              aria-pressed={theme === option.id}
              title={option.label}
            />
          ))}
        </div>
      </div>
    </header>
  );
}
