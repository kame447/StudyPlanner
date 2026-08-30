import splashLogo from '../assets/studyplanner-logo.png';

export function SplashScreen({ fixedLight = false }: { fixedLight?: boolean }) {
  return (
    <main
      className={
        fixedLight
          ? 'loading-screen splash-screen splash-screen--startup-light'
          : 'loading-screen splash-screen'
      }
      aria-label="アプリ起動中"
    >
      <div className="splash-screen__inner">
        <img
          src={splashLogo}
          alt="Study Planner"
          className="splash-screen__logo"
        />
        <p className="splash-screen__message">アプリを準備しています...</p>
      </div>
    </main>
  );
}
