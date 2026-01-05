# Core Principles

## Vanilla-First Approach

Use plain HTML, CSS, and JavaScript by default.

### External Libraries

Introduce external libraries only when they clearly add value. When considering a library, always explain:

- **Why it's needed** - What specific problem does it solve?
- **The trade-offs** - What are the costs (bundle size, complexity, dependencies)?
- **Security and maintenance impact** - How does it affect our security posture and long-term maintenance?

### Browser APIs

Prefer native browser APIs over abstractions. Modern browsers provide powerful APIs that often eliminate the need for external libraries.

