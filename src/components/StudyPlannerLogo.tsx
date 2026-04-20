import logoImage from '../assets/studyplanner-logo.jpg';

export function StudyPlannerLogo() {
  return (
    <div className="brand-lockup" aria-label="Study Planner">
      <img
        src={logoImage}
        alt="Study Planner"
        className="brand-logo-image"
      />
    </div>
  );
}