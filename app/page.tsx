'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Theme = 'coral' | 'apricot' | 'lemon' | 'mint' | 'aqua' | 'sky' | 'lavender' | 'rose';
type Genre = 'add-simple' | 'add-carry' | 'sub-simple' | 'sub-borrow' | 'multiply';
type Phase = 'setup' | 'quiz' | 'result' | 'review' | 'complete';
type ReviewKind = 'mistakes' | 'slow';

type Problem = {
  id: string;
  left: number;
  right: number;
  operator: '＋' | '−' | '×';
  answer: number;
};

type RecordItem = Problem & { elapsed: number; mistakes: number };
type LastResult = {
  sequence: number;
  problem: Problem;
  givenAnswer: number;
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

function stripRecord({ elapsed: _elapsed, mistakes: _mistakes, ...problem }: RecordItem): Problem {
  return problem;
}

function formatTime(ms: number) {
  const totalTenths = Math.floor(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}秒`;
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
      const padding = { top: 20, right: 18, bottom: 34, left: 48 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const maximum = Math.max(...records.map((record) => record.elapsed), 1000);
      const ceiling = Math.ceil(maximum / 1000) * 1000;
      const x = (index: number) => padding.left + (records.length === 1 ? chartWidth / 2 : (index / (records.length - 1)) * chartWidth);
      const y = (value: number) => padding.top + chartHeight - (value / ceiling) * chartHeight;

      context.clearRect(0, 0, width, height);
      context.font = '700 10px system-ui, sans-serif';
      context.textAlign = 'right';
      context.textBaseline = 'middle';
      for (let line = 0; line <= 4; line += 1) {
        const value = (ceiling / 4) * line;
        const lineY = y(value);
        context.strokeStyle = `${ink}14`;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(padding.left, lineY);
        context.lineTo(width - padding.right, lineY);
        context.stroke();
        context.fillStyle = muted;
        context.fillText(`${(value / 1000).toFixed(value < 1000 ? 1 : 0)}s`, padding.left - 9, lineY);
      }

      const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
      gradient.addColorStop(0, `${accent}55`);
      gradient.addColorStop(1, `${accent}06`);
      context.beginPath();
      records.forEach((record, index) => {
        if (index === 0) context.moveTo(x(index), y(record.elapsed));
        else context.lineTo(x(index), y(record.elapsed));
      });
      context.lineTo(x(records.length - 1), padding.top + chartHeight);
      context.lineTo(x(0), padding.top + chartHeight);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      context.beginPath();
      records.forEach((record, index) => {
        if (index === 0) context.moveTo(x(index), y(record.elapsed));
        else context.lineTo(x(index), y(record.elapsed));
      });
      context.strokeStyle = accent;
      context.lineWidth = 3;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.stroke();

      const slowest = Math.max(...records.map((record) => record.elapsed));
      records.forEach((record, index) => {
        context.beginPath();
        context.arc(x(index), y(record.elapsed), record.elapsed === slowest ? 5 : 3, 0, Math.PI * 2);
        context.fillStyle = record.elapsed === slowest ? '#ff4775' : accent;
        context.fill();
        context.strokeStyle = '#ffffff';
        context.lineWidth = 2;
        context.stroke();
      });

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

  return <canvas ref={canvasRef} className="performance-chart" aria-label="問題ごとの回答時間グラフ" />;
}

export default function Home() {
  const [theme, setTheme] = useState<Theme>('coral');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [phase, setPhase] = useState<Phase>('setup');
  const [selectedGenres, setSelectedGenres] = useState<Genre[]>(['add-simple', 'add-carry']);
  const [selectedTables, setSelectedTables] = useState<number[]>([2]);
  const [problemCount, setProblemCount] = useState(50);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewProblems, setReviewProblems] = useState<Problem[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewKind, setReviewKind] = useState<ReviewKind>('mistakes');
  const [answer, setAnswer] = useState('');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const sessionStartedAt = useRef(0);
  const questionStartedAt = useRef(0);
  const resultSequence = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

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
    const timer = window.setInterval(() => setElapsed(performance.now() - sessionStartedAt.current), 100);
    return () => window.clearInterval(timer);
  }, [phase]);

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
  const progressCurrent = phase === 'review' ? reviewIndex + 1 : currentIndex + 1;
  const progressTotal = phase === 'review' ? reviewProblems.length : problems.length;

  const beginQuiz = () => {
    if (!selectedCount) return;
    const now = performance.now();
    setProblems(shuffle(problemBank).slice(0, selectedCount));
    setRecords([]);
    setCurrentIndex(0);
    setMistakes(0);
    setAnswer('');
    setElapsed(0);
    setLastResult(null);
    sessionStartedAt.current = now;
    questionStartedAt.current = now;
    setPhase('quiz');
  };

  const incorrectRecords = useMemo(() => records.filter((item) => item.mistakes > 0), [records]);

  const startReview = (kind: ReviewKind) => {
    const selected = kind === 'mistakes'
      ? incorrectRecords.map(stripRecord)
      : [...records]
        .sort((a, b) => b.elapsed - a.elapsed)
        .slice(0, Math.min(10, records.length))
        .map(stripRecord);
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
        questionStartedAt.current = performance.now();
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
  }, [currentIndex, phase, problems.length, reviewIndex, reviewProblems.length]);

  const submitAnswer = useCallback(() => {
    if (!currentProblem || answer === '') return;
    const now = performance.now();
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
      };
      setRecords((current) => [...current, record]);
    }

    if (!isCorrect && phase === 'quiz') setMistakes((value) => value + 1);
    moveForward(now);
  }, [answer, currentProblem, moveForward, phase, playAnswerSound]);

  const inputDigit = useCallback((digit: string) => {
    setAnswer((value) => (value.length >= 3 ? value : `${value}${digit}`));
  }, []);

  const eraseDigit = useCallback(() => {
    setAnswer((value) => value.slice(0, -1));
  }, []);

  useEffect(() => {
    if (phase !== 'quiz' && phase !== 'review') return;
    const onKeyDown = (event: KeyboardEvent) => {
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
                  <small>複数えらべます</small>
                </div>
                <div className="table-buttons">
                  {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
                    <button
                      key={value}
                      className={selectedTables.includes(value) ? 'active' : ''}
                      onClick={() => toggleTable(value)}
                      aria-pressed={selectedTables.includes(value)}
                    >
                      {value}<small>の段</small>
                    </button>
                  ))}
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

        {(phase === 'quiz' || phase === 'review') && currentProblem && (
          <div className="quiz-content">
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
                <div className="stopwatch"><span>TIME</span><strong>{formatTime(elapsed)}</strong></div>
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
                        <del>{lastResult.givenAnswer}</del>
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

            <div key={`${phase}-${currentProblem.id}`} className="problem-stage">
              {phase === 'review' && (
                <p className="review-kicker">
                  {reviewKind === 'mistakes' ? 'まちがえた問題を、もういちど！' : 'ゆっくりだった問題を、もういちど！'}
                </p>
              )}
              <div className="equation">
                <span>{currentProblem.left}</span>
                <i>{currentProblem.operator}</i>
                <span>{currentProblem.right}</span>
                <i>＝</i>
                <strong className={answer ? '' : 'empty'}>{answer || '?'}</strong>
              </div>
              <p className="feedback-message">こたえを おしてね</p>
            </div>

            <div className="keypad" aria-label="数字入力">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                <button key={digit} onClick={() => inputDigit(String(digit))}>{digit}</button>
              ))}
              <button className="key-action" onClick={eraseDigit} aria-label="一文字消す">⌫</button>
              <button onClick={() => inputDigit('0')}>0</button>
              <button className="key-submit" onClick={submitAnswer} aria-label="答えを決定">決定</button>
            </div>
          </div>
        )}

        {phase === 'result' && (
          <div className="result-content">
            <span className="result-symbol">★</span>
            <p className="result-kicker">SPRINT COMPLETE</p>
            <h2>ぜんもん おわったよ！</h2>
            <p className="result-copy">
              {mistakes > 0
                ? `まちがえた${mistakes}問を復習して、しっかり覚えよう。`
                : 'ぜんもん正解！ 時間のかかった問題をもう一度やって、もっと速くなろう。'}
            </p>
            <div className="result-stats">
              <div><span>タイム</span><strong>{formatTime(totalElapsed)}</strong></div>
              <div><span>1問へいきん</span><strong>{(averageTime / 1000).toFixed(1)}<small>秒</small></strong></div>
              <div><span>まちがい</span><strong>{mistakes}<small>問</small></strong></div>
            </div>
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
                  <span>1問ごとのタイム</span>
                  <small><i /> 赤い点は一番時間がかかった問題</small>
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
                        {record.mistakes ? '要復習' : '正解'}
                      </span>
                      <strong className="rank-time">{formatSeconds(record.elapsed)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <div className="result-actions">
              {incorrectRecords.length > 0 && (
                <button className="primary-button result-button" onClick={() => startReview('mistakes')}>
                  <span>まちがえた{incorrectRecords.length}問を復習</span><b>→</b>
                </button>
              )}
              <button className={incorrectRecords.length ? 'secondary-button' : 'primary-button result-button'} onClick={() => startReview('slow')}>
                <span>おそかった{Math.min(10, records.length)}問を復習</span><b>→</b>
              </button>
            </div>
            <button className="text-button" onClick={resetToSetup}>れんしゅう選択にもどる</button>
          </div>
        )}

        {phase === 'complete' && (
          <div className="result-content complete-content">
            <span className="result-symbol">✓</span>
            <p className="result-kicker">REVIEW COMPLETE</p>
            <h2>{reviewKind === 'mistakes' ? 'まちがい復習 おわり！' : 'スピード復習 おわり！'}</h2>
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
