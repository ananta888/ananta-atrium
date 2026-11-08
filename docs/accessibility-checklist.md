# Accessibility checklist

Completed for the blockout (M4 scope). Evidence is the automated suite unless
marked manual.

## Motion and colour

- [x] Reduced-motion setting stops beacon bobbing, avatar breathing and gait swing.
- [x] Colour-blind-safe palette for status rings, beacons, minimap and agent list.
- [x] Status is never colour alone: agent list shows an icon and a text label;
      the HUD inspection panel names the status.
- [x] No flashing content, no autoplay audio (Web Audio starts on a gesture).

## Text and layout

- [x] UI scale from 0.8× to 1.6× via settings; applies without reload.
- [x] Minimum text size 12 px at 1080p (13 px body, 12 px small).
- [x] Works at 720p and 4K; the settings card scrolls instead of clipping.
- [x] One spacing/colour/type scale in `src/app/ui.css`.

## Keyboard

- [x] Main menu, connect, settings, agent list, replay and filters are reachable
      with Tab and operable with Enter/Space.
- [x] Visible focus ring (`:focus-visible`, 3 px).
- [x] Keyboard-only playthrough of the core loop: choose demo (`Enter`), walk
      (`WASD`/arrows), open panels (`L`, `R`), release mouse (`Esc`).
- [x] Key bindings are configurable and persisted.

## Semantics

- [x] Form controls have labels or `aria-label`.
- [x] The agent panel is a labelled region; buttons have accessible names.
- [x] Touch controls are marked decorative (`aria-hidden`) because keyboard and
      pointer paths exist.

## Manual checks still recommended

- [ ] Screen-reader pass with NVDA/VoiceOver (canvas content is inherently
      visual; the DOM panels are the accessible surface).
- [ ] Contrast audit of the final art palette.
- [ ] Test on a real iOS Safari device (the automated run emulates touch).
