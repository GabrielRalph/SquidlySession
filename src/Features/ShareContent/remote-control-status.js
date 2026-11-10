export const RC_STATUS_KEY = "status";

/** Copy displayed over the shared stream for both people in the session. */
export function remoteControlStatusCopy(code, isSharer) {
  const action = {
    surface_selection_required: ["Confirm the shared window", isSharer
      ? "Choose the same window or screen you selected for sharing. Only this selection will receive remote input."
      : "Waiting for the sharer to confirm which window or screen you can control."],
    checking: ["Checking remote control", "Waiting for the shared window to be ready."],
    preparing_window: ["Bringing shared window to front", isSharer
      ? "Control will continue automatically. You can keep using the meeting controls."
      : "Waiting for the shared window to come forward. Control will continue automatically."],
    paused_by_sharer: ["Remote control paused", isSharer
      ? "Select Resume control when you are ready to continue."
      : "The sharer paused control. Waiting for them to resume."],
    window_in_use: ["Waiting for remote control", isSharer
      ? "Another control connection is still active on this Mac. Control will continue automatically when it ends."
      : "Waiting for the sharer’s Mac to finish another control connection. Control will continue automatically."],
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
      ? "The shared window could not be identified. Stop sharing and select it again."
      : "Waiting for the sharer to select the shared window again."],
    window_unavailable: ["Remote control paused", isSharer
      ? "Select Resume control to restore the shared window. If it was closed, share it again."
      : "Waiting for the sharer to restore the shared window."],
    window_minimized: ["Remote control paused", isSharer
      ? "You minimized the shared window. Select Resume control to restore it."
      : "The sharer minimized the shared window. Waiting for them to resume control."],
    window_not_visible: ["Remote control paused", isSharer
      ? "The shared window is not visible on this desktop. Return to its desktop or show it, then select Resume control."
      : "Waiting for the sharer to return to the shared window and resume control."],
    source_changed: ["Remote control turned off", isSharer
      ? "The shared content changed. The other participant can start remote control again for this content."
      : "The shared content changed. Select Remote control to start again for this content."],
    window_not_frontmost: ["Remote control paused", isSharer
      ? "The shared window could not be brought to the front. Close any system dialogs, then select Resume control."
      : "Waiting for the sharer to bring the shared window back."],
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
