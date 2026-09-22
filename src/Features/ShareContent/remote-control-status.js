export const RC_STATUS_KEY = "status";

/** Copy displayed over the shared stream for both people in the session. */
export function remoteControlStatusCopy(code, isSharer) {
  const action = {
    checking: ["Checking remote control", "Waiting for the shared window to be ready."],
    agent_offline: ["Remote control paused", isSharer
      ? "Open RemoteAgent on this Mac to resume control."
      : "Waiting for the sharer to open RemoteAgent."],
    agent_update_required: ["Remote control paused", isSharer
      ? "Update and restart RemoteAgent to resume control."
      : "The sharer needs to update RemoteAgent."],
    surface_unmatched: ["Remote control paused", isSharer
      ? "The shared window could not be identified. Resize or select it again to resume control."
      : "Ask the sharer to resize or select the shared window again."],
    window_unavailable: ["Remote control paused", isSharer
      ? "Restore the shared window to resume control."
      : "Waiting for the sharer to restore the shared window."],
    window_not_frontmost: ["Remote control paused", isSharer
      ? "Bring the shared window to the front to resume control."
      : "Waiting for the sharer to bring the shared window to the front."],
    window_obscured: ["Remote control paused", isSharer
      ? "The shared window cannot receive input at the current point. Uncover it to resume."
      : "The shared window cannot receive input at the current point. Waiting for the sharer to uncover it."],
    window_focus_unavailable: ["Keyboard control paused", isSharer
      ? "Allow Accessibility access for RemoteAgent to use the keyboard."
      : "Waiting for the sharer to allow RemoteAgent Accessibility access."],
  };
  const [title, detail] = action[code] || action.checking;
  return { title, detail };
}
