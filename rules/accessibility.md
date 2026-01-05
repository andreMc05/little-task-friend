# Accessibility (508 / WCAG-aligned)

## Semantic HTML

Use semantic HTML first. Choose the right element for the job (`<button>`, `<nav>`, `<main>`, etc.).

## Keyboard Navigation

Keyboard navigation must work end-to-end. All interactive elements must be:
- Focusable via keyboard
- Operable via keyboard
- Clearly indicated when focused

## Dialogs

Dialogs must:

- Have explicit **Cancel** and **Save** actions
- Support **ESC** to close
- Return focus correctly to the element that opened them

## ARIA

Use ARIA only when necessary, and use it correctly. Semantic HTML should be preferred over ARIA attributes.

## Motion

Respect `prefers-reduced-motion`. Provide alternatives for animations and transitions.

## Focus States

Maintain visible focus states using CSS tokens. Focus indicators must be clearly visible and meet contrast requirements.

