# Chat Drawer Fix Plan

Based on user interview (iOS Safari/PWA user) and full code audit of chatDrawer.js, api.js, aiService.js, routes/ai.js, and chat CSS.

---

## Priority 1: AI Getting Stuck / Unreliable

### 1A. Fix duplicate loading indicators
**Files**: `public/js/components/chatDrawer.js`
**Problem**: `onToolStart` creates a NEW tool indicator element each time it fires. In multi-tool agentic chains, multiple indicators stack up — one stays stuck on the previous position while a new one appears below. User sees duplicated progress bars.
**Fix**:
- Before creating a new tool indicator in `onToolStart`, find and remove any existing `.chat-tool-indicator` within the current streaming message element
- This ensures only one indicator is ever visible per message

### 1B. Add immediate "thinking" state on send
**Files**: `public/js/components/chatDrawer.js`, `public/css/style.css`
**Problem**: When user sends a message, the welcome screen is removed immediately but there's no loading indicator until the first SSE token arrives. If the network is slow, user sees an empty void.
**Fix**:
- After appending the user's message bubble, immediately append a "thinking" indicator (animated typing dots) as a placeholder
- Remove/replace it when the first `onTextDelta` or `onToolStart` or `onError` fires
- CSS: Add `.chat-thinking-dots` with a subtle bounce animation

### 1C. Ensure `onDone` always fires and cleans up state
**Files**: `public/js/api.js`, `public/js/components/chatDrawer.js`
**Problem**: If the SSE stream closes unexpectedly (network drop, server error), `onDone` may not fire, leaving `isSending=true` permanently. The `ensureDone()` mechanism in api.js exists but may not cover all edge cases. If `isSending` is stuck true, user can never send another message.
**Fix**:
- Audit all exit paths in `aiCommandStream` to ensure `ensureDone()` is called on every path (abort, timeout, error, close)
- In `chatDrawer.js`, add a safety net: if `isSending` is true when the user tries to send, force-reset the sending state (clear isSending, abort any stale stream, re-enable input)
- On `onError`, always run the same cleanup that `onDone` runs

### 1D. Add "Stop generating" button
**Files**: `public/js/components/chatDrawer.js`, `public/css/style.css`
**Problem**: Once AI starts processing, user can't stop it. They have to wait up to 90 seconds for the watchdog or close the entire drawer.
**Fix**:
- When `isSending` becomes true, replace the send button with a "Stop" button (square icon, red tint)
- Clicking it calls `currentStream.abort()`, marks the current streaming message as "[Stopped]", cleans up all sending state
- When `isSending` becomes false, restore the send button

### 1E. Improve watchdog timer and recovery
**Files**: `public/js/components/chatDrawer.js`
**Problem**: The 90-second watchdog shows an error toast but the user reported needing to restart the server to recover. The watchdog cleanup may not be resetting all state properly.
**Fix**:
- Reduce watchdog from 90s to 60s
- When watchdog fires: append an inline error message to the chat with a "Retry" button (not just a toast)
- Ensure watchdog cleanup resets ALL state: `isSending`, `currentStream`, remove any lingering `.chat-msg-streaming` classes, remove cursor elements, re-enable input
- The retry button resends the last user message

### 1F. Improve agentic loop reliability for multi-step
**Files**: `services/ai/aiService.js`, `routes/ai.js`
**Problem**: Multi-step requests inconsistently complete. The agentic loop can silently exit when tool execution fails or when the stream drops between rounds.
**Fix**:
- Add a per-round timeout (30s) so a stuck tool doesn't hang the entire agentic loop
- Emit a `progress` SSE event with round number so the client can show "Working on step X..."
- In `chatDrawer.js`, handle `onProgress` to update the tool indicator with step info
- Ensure tool execution errors always feed back to the model (verify the `is_error: true` tool_result path works)

---

## Priority 2: Messages Disappearing

### 2A. Fix message DOM rebuilding on view switches
**Files**: `public/js/components/chatDrawer.js`
**Problem**: Messages disappear randomly, then reappear after close/reopen/send. Root cause: when switching between history view and live chat, `restoreMessages()` rebuilds the DOM from the in-memory `conversationHistory` array. If the array is out of sync with what was on screen (streaming messages not yet persisted, or persistence failed silently), messages vanish.
**Fix**:
- Add `data-message-id` attributes to each message element for deduplication
- Before appending a message, check if one with that ID already exists in the DOM
- When returning from history view to the same conversation, don't clear/rebuild the DOM — just show the existing elements
- When switching to a different conversation, always fetch fresh from the DB

### 2B. Fix conversation persistence reliability
**Files**: `public/js/components/chatDrawer.js`
**Problem**: `addConversationMessage()` fires async and failures are silently ignored. If persistence fails, the in-memory array has the message but the DB doesn't. On next load, the message is gone.
**Fix**:
- Add error handling: on failure, retry once after 2s
- If retry also fails, add a subtle "unsaved" indicator on the message (small warning icon)
- For streaming assistant messages, only persist the complete message on `onDone`, not partial content

---

## Priority 3: Scroll & Layout (iOS Safari/PWA)

### 3A. Fix iOS rubber-banding in messages container
**Files**: `public/css/style.css`
**Problem**: The messages container causes elastic bounce scrolling on iOS that feels broken.
**Fix**:
- Add `overscroll-behavior: contain` to `.chat-messages` to prevent bounce propagation
- Ensure `-webkit-overflow-scrolling: touch` is set for momentum scrolling
- Add `overscroll-behavior: none` to `.chat-drawer-panel` to prevent the drawer itself from bouncing

### 3B. Fix messages getting cut off
**Files**: `public/css/style.css`
**Problem**: Long messages extend beyond the visible area without proper wrapping.
**Fix**:
- Ensure message bubbles have `overflow-wrap: break-word` and `word-break: break-word`
- Code blocks inside messages need `overflow-x: auto` for horizontal scrolling
- Add sufficient `padding-bottom` to messages container so last message isn't hidden behind input area
- Check that flexbox layout properly allocates remaining space to messages container

---

## Priority 4: File Upload Progress

### 4A. Add upload progress for chat file attachments
**Files**: `public/js/components/chatDrawer.js`, `public/css/style.css`
**Problem**: When attaching a file, `extractFileText()` runs async with no progress feedback. For large PDFs or images, this can take several seconds.
**Fix**:
- Show a progress bar or spinner on the attachment chip during `extractFileText()`
- Update chip text: "Extracting text..." → filename (ready)
- If extraction fails, show error state on chip with option to send without extraction
- CSS: Add `.chat-attachment-loading` state with a subtle animated bar

---

## Priority 5: Polish & Animations

### 5A. Message bubble entrance animations
**Files**: `public/css/style.css`
**Problem**: Messages just pop into existence with no transition. Tool/confirmation cards also appear abruptly.
**Fix**:
- Add subtle fade-in + slide-up animation for new messages (user and assistant)
- Tool indicator cards and confirmation cards get a similar but slightly different entrance (fade + scale from 0.95)
- Keep all animations fast (150-200ms) to feel snappy not sluggish
- Use `transform` and `opacity` only (GPU-accelerated, safe on iOS)
- Apply via `.chat-msg-enter` class, use `animationend` to clean up

### 5B. Throttle streaming text re-renders
**Files**: `public/js/components/chatDrawer.js`
**Problem**: Every `onTextDelta` re-renders the ENTIRE accumulated markdown text. This is O(n²) and causes visible lag on long responses, making the streaming feel janky.
**Fix**:
- Batch text deltas with a 50ms throttle before calling `renderMarkdown()`
- Use `requestAnimationFrame` to ensure renders align with display refresh
- Only the final render on `onDone` needs to be immediate
- This also improves the "streaming text feel" — fewer full re-renders means less flicker

### 5C. Button and interaction micro-animations
**Files**: `public/css/style.css`
**Problem**: Send button, confirm/cancel buttons, and attachment chips have flat interactions with no tactile feedback.
**Fix**:
- Send button: subtle scale-down on `:active` (0.92), smooth background transition on hover
- Stop button: pulse animation while active (subtle opacity oscillation)
- Confirm/Cancel/Skip buttons on tool cards: scale + shadow lift on hover, press-down on active
- Attachment chip: smooth slide-in on attach, slide-out on remove
- All transitions use `cubic-bezier(0.4, 0, 0.2, 1)` for a natural feel
- Keep all durations under 200ms — kitchen staff tapping quickly shouldn't feel delayed

---

## Implementation Order

```
Phase A — Quick wins + visual polish (CSS):
  1B  Thinking dots on send
  1A  Fix duplicate tool indicators
  1D  Stop generating button
  3A  iOS scroll rubber-banding fix
  3B  Messages getting cut off
  5A  Message bubble entrance animations
  5C  Button & interaction micro-animations

Phase B — Reliability + streaming polish (JS):
  1C  onDone cleanup / isSending recovery
  1E  Watchdog improvement
  1F  Agentic loop reliability + progress events
  5B  Streaming text render throttle (smoother feel)

Phase C — Message persistence:
  2A  Message deduplication + DOM rebuild fix
  2B  Persistence retry + error handling

Phase D — File upload:
  4A  File upload progress indicator
```

---

## Files Modified

| File | Items | Summary |
|------|-------|---------|
| `public/js/components/chatDrawer.js` | 1A-1F, 2A, 2B, 4A, 5B | Primary file — loading states, stop button, watchdog, message dedup, upload progress, render throttle |
| `public/js/api.js` | 1C, 1F | onDone cleanup paths, progress event handler |
| `services/ai/aiService.js` | 1F | Per-round timeout, progress event emission |
| `routes/ai.js` | 1F | Pass progress events through SSE |
| `public/css/style.css` | 1B, 1D, 3A, 3B, 4A, 5A, 5C | Thinking dots, stop button, scroll fixes, message overflow, upload progress, message animations, button micro-animations |

---

## Testing

- After each phase: `npm run lint` + `npm test`
- Manual testing on iOS Safari/PWA for scroll, animations, and keyboard behavior
- Test multi-step AI requests (e.g., "create a menu with 3 dishes") to verify agentic loop reliability
- Test network disconnection during AI streaming to verify recovery
- Test file attachment with large PDFs to verify progress indicator
