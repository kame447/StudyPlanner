export function StudyPlannerLogo() {
  return (
    <div className="brand-lockup" aria-label="Study Planner">
      <div className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 96 96" role="img">
          <defs>
            <linearGradient id="studyPlannerBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#5eb6ab" />
              <stop offset="100%" stopColor="#176d66" />
            </linearGradient>
            <linearGradient id="studyPlannerAccent" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f6efe1" />
              <stop offset="100%" stopColor="#ffffff" />
            </linearGradient>
          </defs>

          <rect x="6" y="6" width="84" height="84" rx="24" fill="url(#studyPlannerBg)" />
          <path
            d="M26 27C26 23.7 28.7 21 32 21H47C52.2 21 56.7 24.2 59 29L63 37V68C63 70.2 61.2 72 59 72H31C28.2 72 26 69.8 26 67V27Z"
            fill="url(#studyPlannerAccent)"
            opacity="0.98"
          />
          <path
            d="M70 27C70 23.7 67.3 21 64 21H49C43.8 21 39.3 24.2 37 29L33 37V68C33 70.2 34.8 72 37 72H65C67.8 72 70 69.8 70 67V27Z"
            fill="#f6fbfb"
            opacity="0.94"
          />
          <path
            d="M48 27V70"
            stroke="#d4e9e5"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M36 35H44"
            stroke="#7fb6af"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M36 43H44"
            stroke="#7fb6af"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M52 35H62"
            stroke="#7fb6af"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M52 43H62"
            stroke="#7fb6af"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M36 54L41.5 59.5L60.5 40.5"
            stroke="#176d66"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="brand-copy">
        <strong className="brand-name">Study Planner</strong>
        <span className="brand-tagline">月・週・日で続ける学習計画</span>
      </div>
    </div>
  );
}
