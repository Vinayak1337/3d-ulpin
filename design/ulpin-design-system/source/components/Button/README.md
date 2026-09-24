# Button

Buttons trigger one action, named with a verb that says exactly what happens.

- **Primary** (`ul-btn--primary`): the one main action of a panel or dialog, for example **Record reviewed details** or **Assign code** (assigns a proposed 3D ULPIN). One per view.
- **Secondary** (default): other actions. **Soft** (`ul-btn--soft`): repeated positive actions inside lists. **Ghost** (`ul-btn--ghost`): tertiary actions in toolbars.
- **Danger** (`ul-btn--danger`): destructive or irreversible actions such as **Retire code**; always followed by a confirmation dialog.
- Studio height is `control-height` (40px); Portal buttons add `ul-btn--lg` (`touch-height`, 44px).
- Labels are 1 to 3 words, sentence case, never wrapped. Disabled buttons explain why in a tooltip or helper line.
- The consumer provides the label, an optional leading Phosphor icon, and `disabled` when the action is blocked.
