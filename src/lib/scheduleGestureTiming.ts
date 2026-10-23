// One hold threshold for calendar schedule events, shared by the radial-menu
// reveal and touch drag activation so a hold never opens the menu on one side
// of the threshold while the drag controller still waits on the other.
// Just longer than a normal tap (~100-150ms) so quick taps stay taps.
export const SCHEDULE_LONG_PRESS_MS = 170;
