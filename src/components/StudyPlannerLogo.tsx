import logoImage from "../assets/laplans-wordmark.jpeg";

export function StudyPlannerLogo() {
  return (
    <div className="brand-lockup" aria-label="Laplans">
      <img src={logoImage} alt="Laplans" className="brand-logo-image" />
    </div>
  );
}
