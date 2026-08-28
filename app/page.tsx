'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Theme = 'cute' | 'cool';
type Genre = 'add-simple' | 'add-carry' | 'sub-simple' | 'sub-borrow' | 'multiply';
type Phase = 'setup' | 'quiz' | 'result' | 'review' | 'complete';

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

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function createProblem(genre: Genre, table: number, index: number): Problem {
  let left = 0;
  let right = 0;
  let operator: Problem['operator'] = '＋';
  let answer = 0;

  if (genre === 'add-simple') {
    left = randomInt(1, 8);
    right = randomInt(1, 9 - left);
    answer = left + right;
  } else if (genre === 'add-carry') {
    left = randomInt(2, 9);
    right = randomInt(10 - left, 9);
    answer = left + right;
  } else if (genre === 'sub-simple') {
    left = randomInt(2, 9);
    right = randomInt(1, left - 1);
    operator = '−';
    answer = left - right;
  } else if (genre === 'sub-borrow') {
    answer = randomInt(1, 9);
    right = randomInt(10 - answer, 9);
    left = answer + right;
    operator = '−';
  } else {
    left = table;
    right = randomInt(1, 9);
    operator = '×';
    answer = left * right;
  }

  return { id: `${Date.now()}-${index}-${Math.random()}`, left, right, operator, answer };
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
  const [genre, setGenre] = useState<Genre>('add-simple');
  const [table, setTable] = useState(2);
  const [problemCount, setProblemCount] = useState(50);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewProblems, setReviewProblems] = useState<Problem[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [currentMistakes, setCurrentMistakes] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [feedback, setFeedback] = useState<'idle' | 'wrong' | 'correct'>('idle');
  const sessionStartedAt = useRef(0);
  const questionStartedAt = useRef(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('keisan-theme');
    if (savedTheme === 'cute' || savedTheme === 'cool') setTheme(savedTheme);
  }, []);

  const chooseTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    window.localStorage.setItem('keisan-theme', nextTheme);
  };

  useEffect(() => {
    if (phase !== 'quiz' && phase !== 'review') return;
    const timer = window.setInterval(() => {
      setElapsed(performance.now() - sessionStartedAt.current);
    }, 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  const currentProblem = phase === 'review' ? reviewProblems[reviewIndex] : problems[currentIndex];
  const progressCurrent = phase === 'review' ? reviewIndex + 1 : currentIndex + 1;
  const progressTotal = phase === 'review' ? reviewProblems.length : problems.length;

  const beginQuiz = () => {
    const nextProblems = Array.from({ length: problemCount }, (_, index) =>
      createProblem(genre, table, index),
    );
    const now = performance.now();
    setProblems(nextProblems);
    setRecords([]);
    setCurrentIndex(0);
    setMistakes(0);
    setCurrentMistakes(0);
    setAnswer('');
    setElapsed(0);
    setFeedback('idle');
    sessionStartedAt.current = now;
    questionStartedAt.current = now;
    setPhase('quiz');
  };

  const startReview = () => {
    const slowest = [...records]
      .sort((a, b) => b.elapsed - a.elapsed)
      .slice(0, Math.min(10, records.length))
      .map(({ elapsed: _elapsed, mistakes: _mistakes, ...problem }) => problem);
    const now = performance.now();
    setReviewProblems(slowest);
    setReviewIndex(0);
    setCurrentMistakes(0);
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

  const submitAnswer = useCallback(() => {
    if (!currentProblem || answer === '' || feedback === 'correct') return;
    const numericAnswer = Number(answer);
    if (numericAnswer !== currentProblem.answer) {
      setMistakes((value) => value + 1);
      setCurrentMistakes((value) => value + 1);
      setFeedback('wrong');
      setAnswer('');
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setFeedback('idle'), 550);
      return;
    }

    setFeedback('correct');
    const now = performance.now();
    const questionElapsed = now - questionStartedAt.current;

    if (phase === 'quiz') {
      const nextRecords = [
        ...records,
        { ...currentProblem, elapsed: questionElapsed, mistakes: currentMistakes },
      ];
      setRecords(nextRecords);
      feedbackTimer.current = setTimeout(() => {
        if (currentIndex + 1 >= problems.length) {
          setTotalElapsed(now - sessionStartedAt.current);
          setPhase('result');
        } else {
          setCurrentIndex((value) => value + 1);
          questionStartedAt.current = performance.now();
          setAnswer('');
          setCurrentMistakes(0);
          setFeedback('idle');
        }
      }, 220);
    } else if (phase === 'review') {
      feedbackTimer.current = setTimeout(() => {
        if (reviewIndex + 1 >= reviewProblems.length) {
          setTotalElapsed(performance.now() - sessionStartedAt.current);
          setPhase('complete');
        } else {
          setReviewIndex((value) => value + 1);
          questionStartedAt.current = performance.now();
          setAnswer('');
          setCurrentMistakes(0);
          setFeedback('idle');
        }
      }, 220);
    }
  }, [answer, currentIndex, currentMistakes, currentProblem, feedback, phase, problems.length, records, reviewIndex, reviewProblems.length]);

  const inputDigit = useCallback((digit: string) => {
    if (feedback === 'correct') return;
    setFeedback('idle');
    setAnswer((value) => (value.length >= 3 ? value : `${value}${digit}`));
  }, [feedback]);

  const eraseDigit = useCallback(() => {
    setFeedback('idle');
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
                <p>きょうは、どれにちょうせんする？</p>
                <h2>れんしゅうを えらぼう</h2>
              </div>
            </div>

            <div className="genre-grid">
              {genreOptions.map((option) => (
                <button
                  key={option.id}
                  className={`genre-card ${genre === option.id ? 'selected' : ''}`}
                  onClick={() => setGenre(option.id)}
                  aria-pressed={genre === option.id}
                >
                  <span className="genre-icon">{option.icon}</span>
                  <strong>{option.title}</strong>
                  <span>{option.note}</span>
                  <i aria-hidden="true">✓</i>
                </button>
              ))}
            </div>

            {genre === 'multiply' && (
              <div className="table-picker">
                <span className="setting-label">何の段にする？</span>
                <div className="table-buttons">
                  {Array.from({ length: 9 }, (_, index) => index + 1).map((value) => (
                    <button key={value} className={table === value ? 'active' : ''} onClick={() => setTable(value)}>
                      {value}<small>の段</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <footer className="setup-footer">
              <div className="count-setting">
                <span className="setting-label">もんだいすう</span>
                <div className="stepper">
                  <button onClick={() => setProblemCount((value) => Math.max(10, value - 10))} aria-label="10問減らす">−</button>
                  <strong>{problemCount}<small>もん</small></strong>
                  <button onClick={() => setProblemCount((value) => Math.min(100, value + 10))} aria-label="10問増やす">＋</button>
                </div>
              </div>
              <button className="primary-button" onClick={beginQuiz}>
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
              {phase === 'review' && <p className="review-kicker">ゆっくりだった問題を、もういちど！</p>}
              <div className="equation">
                <span>{currentProblem.left}</span>
                <i>{currentProblem.operator}</i>
                <span>{currentProblem.right}</span>
                <i>＝</i>
                <strong className={answer ? '' : 'empty'}>{answer || '?'}</strong>
              </div>
              <p className="feedback-message">
                {feedback === 'wrong' ? 'おしい！ もういちど' : feedback === 'correct' ? 'せいかい！' : 'こたえを おしてね'}
              </p>
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
            <h2>ぜんもん クリア！</h2>
            <p className="result-copy">よくがんばったね。つぎは時間のかかった問題をもう一度やって、もっと速くなろう。</p>
            <div className="result-stats">
              <div><span>タイム</span><strong>{formatTime(totalElapsed)}</strong></div>
              <div><span>1問へいきん</span><strong>{(averageTime / 1000).toFixed(1)}<small>秒</small></strong></div>
              <div><span>まちがい</span><strong>{mistakes}<small>回</small></strong></div>
            </div>
            <button className="primary-button result-button" onClick={startReview}>
              <span>おそかった10問を復習</span><b>→</b>
            </button>
          </div>
        )}

        {phase === 'complete' && (
          <div className="result-content complete-content">
            <span className="result-symbol">✓</span>
            <p className="result-kicker">REVIEW COMPLETE</p>
            <h2>ふくしゅうも かんぺき！</h2>
            <p className="result-copy">くり返すほど、計算はどんどん速くなるよ。今日のチャレンジ、おつかれさま！</p>
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

function AppHeader({
  theme,
  chooseTheme,
  compact,
}: {
  theme: Theme;
  chooseTheme: (theme: Theme) => void;
  compact: boolean;
}) {
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
