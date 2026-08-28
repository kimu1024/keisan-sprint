'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Theme = 'cute' | 'cool';
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

const genreOptions: { id: Genre; icon: string; title: string; note: string }[] = [
  { id: 'add-simple', icon: '＋', title: 'たし算', note: 'くり上がりなし' },
  { id: 'add-carry', icon: '＋', title: 'たし算', note: 'くり上がりあり' },
  { id: 'sub-simple', icon: '−', title: 'ひき算', note: 'くり下がりなし' },
  { id: 'sub-borrow', icon: '−', title: 'ひき算', note: 'くり下がりあり' },
  { id: 'multiply', icon: '×', title: '九九', note: '1〜9の段' },
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

export default function Home() {
  const [theme, setTheme] = useState<Theme>('cute');
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
  const [feedback, setFeedback] = useState<'idle' | 'wrong' | 'correct'>('idle');
  const sessionStartedAt = useRef(0);
  const questionStartedAt = useRef(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const problemBank = useMemo(
    () => buildProblemBank(selectedGenres, selectedTables),
    [selectedGenres, selectedTables],
  );
  const maxProblemCount = problemBank.length;
  const selectedCount = maxProblemCount ? Math.min(problemCount, maxProblemCount) : 0;

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('keisan-theme');
    if (savedTheme === 'cute' || savedTheme === 'cool') setTheme(savedTheme);
  }, []);

  useEffect(() => {
    if (maxProblemCount > 0) setProblemCount((value) => Math.min(Math.max(value, 1), maxProblemCount));
  }, [maxProblemCount]);

  useEffect(() => {
    if (phase !== 'quiz' && phase !== 'review') return;
    const timer = window.setInterval(() => setElapsed(performance.now() - sessionStartedAt.current), 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  const chooseTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    window.localStorage.setItem('keisan-theme', nextTheme);
  };

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
    setFeedback('idle');
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
    setFeedback('idle');
    sessionStartedAt.current = now;
    questionStartedAt.current = now;
    setPhase('review');
  };

  const resetToSetup = () => {
    setPhase('setup');
    setAnswer('');
    setFeedback('idle');
  };

  const moveForward = useCallback((delay: number, answeredAt: number) => {
    feedbackTimer.current = setTimeout(() => {
      if (phase === 'quiz') {
        if (currentIndex + 1 >= problems.length) {
          setTotalElapsed(answeredAt - sessionStartedAt.current);
          setPhase('result');
        } else {
          setCurrentIndex((value) => value + 1);
          questionStartedAt.current = performance.now();
          setAnswer('');
          setFeedback('idle');
        }
      } else if (phase === 'review') {
        if (reviewIndex + 1 >= reviewProblems.length) {
          setTotalElapsed(answeredAt - sessionStartedAt.current);
          setPhase('complete');
        } else {
          setReviewIndex((value) => value + 1);
          questionStartedAt.current = performance.now();
          setAnswer('');
          setFeedback('idle');
        }
      }
    }, delay);
  }, [currentIndex, phase, problems.length, reviewIndex, reviewProblems.length]);

  const submitAnswer = useCallback(() => {
    if (!currentProblem || answer === '' || feedback !== 'idle') return;
    const now = performance.now();
    const isCorrect = Number(answer) === currentProblem.answer;

    if (phase === 'quiz') {
      const record = {
        ...currentProblem,
        elapsed: now - questionStartedAt.current,
        mistakes: isCorrect ? 0 : 1,
      };
      setRecords((current) => [...current, record]);
    }

    if (isCorrect) {
      setFeedback('correct');
      moveForward(350, now);
    } else {
      if (phase === 'quiz') setMistakes((value) => value + 1);
      setFeedback('wrong');
      moveForward(1600, now);
    }
  }, [answer, currentProblem, feedback, moveForward, phase]);

  const inputDigit = useCallback((digit: string) => {
    if (feedback !== 'idle') return;
    setAnswer((value) => (value.length >= 3 ? value : `${value}${digit}`));
  }, [feedback]);

  const eraseDigit = useCallback(() => {
    if (feedback !== 'idle') return;
    setAnswer((value) => value.slice(0, -1));
  }, [feedback]);

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

  const shownAnswer = feedback === 'wrong' && currentProblem ? String(currentProblem.answer) : answer;
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
              <div className="stopwatch"><span>TIME</span><strong>{formatTime(elapsed)}</strong></div>
            </div>

            <div className={`problem-stage ${feedback}`} aria-live="polite">
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
                <strong className={shownAnswer ? '' : 'empty'}>{shownAnswer || '?'}</strong>
              </div>
              <p className="feedback-message">
                {feedback === 'wrong'
                  ? `せいかいは ${currentProblem.answer}。つぎの問題へ！`
                  : feedback === 'correct'
                    ? 'せいかい！'
                    : 'こたえを おしてね'}
              </p>
            </div>

            <div className="keypad" aria-label="数字入力">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                <button key={digit} onClick={() => inputDigit(String(digit))} disabled={feedback !== 'idle'}>{digit}</button>
              ))}
              <button className="key-action" onClick={eraseDigit} disabled={feedback !== 'idle'} aria-label="一文字消す">⌫</button>
              <button onClick={() => inputDigit('0')} disabled={feedback !== 'idle'}>0</button>
              <button className="key-submit" onClick={submitAnswer} disabled={feedback !== 'idle'} aria-label="答えを決定">決定</button>
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
      <div className="theme-switch" aria-label="テーマを選ぶ">
        <button className={theme === 'cute' ? 'active' : ''} onClick={() => chooseTheme('cute')} aria-pressed={theme === 'cute'}>かわいい</button>
        <button className={theme === 'cool' ? 'active' : ''} onClick={() => chooseTheme('cool')} aria-pressed={theme === 'cool'}>クール</button>
      </div>
    </header>
  );
}
