# App startup remount / loading flicker

Status: closed / merged
Completed: 2026-08-12

The stale root task was completed by the startup-auth fixes merged through:

- PR #121 `fix: root-managedログイン時のPlanner二重読込を防止`
  - merge `46db07aac0173f00b126331770e200809b012e9c`
- PR #122 `fix: 起動中のSplash再マウントを防止`
  - merge `bea39c1fd1a52e5ec401423a770d7888b4b2e931`

Current main retains the root-managed authentication handoff and single startup surface behavior. The original long implementation memo remains available in Git history and must not be used as an active task.
