# Security

## Input Handling

Treat all user input as untrusted.

## XSS Prevention

Prevent XSS by default:

- **Use `textContent` for rendering** - Never use `innerHTML` with user input
- **Escape HTML and attributes when needed** - If HTML is required, use proper escaping functions
- **Validate and sanitize URLs**:
  - Allow only `http://` and `https://` protocols
  - Block `javascript:` and malformed URLs

## External Links

External links must open safely using:
```html
target="_blank" rel="noopener noreferrer"
```

## Attack Surface

Keep the attack surface small. Only include what's necessary.

