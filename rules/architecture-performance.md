# Architecture & Performance

## Design Principles

Design for clarity, durability, and low complexity.

## DOM Management

Manage the DOM efficiently:

- **Minimize reflows and repaints** - Batch DOM updates, use `DocumentFragment` for multiple insertions
- **Use event delegation** - Attach listeners to parent elements when possible
- **Clean up resources** - Remove listeners, clear timers, and disconnect observers when components are destroyed

## State Management

Avoid unnecessary state duplication. Keep a single source of truth.

## Development Approach

- Build features incrementally
- Refactor deliberately - don't optimize prematurely, but don't ignore technical debt

