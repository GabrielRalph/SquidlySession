export const RC_STATUS_KEY = "status";

/** Copy displayed over the shared stream for both people in the session. */
export function remoteControlStatusCopy(code, isSharer) {
  const action = {
    checking: ["Checking remote control", "Waiting for the shared window to be ready."],
    preparing_window: ["Preparing remote control", "Bringing the shared window to the front…"],
    paused_by_sharer: ["Remote control paused", isSharer
      ? "Select Resume control when you are ready to continue."
      : "The sharer paused control. Waiting for them to resume."],
    window_in_use: ["Remote control paused", isSharer
      ? "Another session is controlling a window. Stop that control, then select Resume control."
      : "Waiting for the sharer to finish control in another session."],
    window_binding_unavailable: ["Remote control paused", isSharer
      ? "This window could not be prepared for control. Select the shared window again."
      : "Waiting for the sharer to select the shared window again."],
    agent_offline: ["Remote control paused", isSharer
      ? "Cannot connect to RemoteAgent. If it is already open, check your browser connection and try again."
      : "Waiting for the sharer to connect to RemoteAgent."],
    agent_update_required: ["Remote control paused", isSharer
      ? "Update and restart RemoteAgent to resume control."
      : "The sharer needs to update RemoteAgent."],
    surface_unmatched: ["Remote control paused", isSharer
      ? "The shared window could not be identified. Resize or select it again to resume control."
      : "Ask the sharer to resize or select the shared window again."],
    window_unavailable: ["Remote control paused", isSharer
      ? "Select Resume control to restore the shared window. If it was closed, share it again."
      : "Waiting for the sharer to restore the shared window."],
    window_not_frontmost: ["Remote control paused", isSharer
      ? "You switched away from the shared window. Select Resume control to bring it back."
      : "The sharer switched windows. Waiting for them to resume control."],
    window_obscured: ["Remote control paused", isSharer
      ? "Select Resume control to bring the shared window to the front."
      : "Waiting for the sharer to resume control of the shared window."],
    window_focus_unavailable: ["Remote control paused", isSharer
      ? "Allow Accessibility access for RemoteAgent, then select Resume control."
      : "Waiting for the sharer to allow RemoteAgent Accessibility access."],
  };
  const [title, detail] = action[code] || action.checking;
  return { title, detail };
}
