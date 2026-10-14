// Makes a piped run look like a person at a terminal: incur treats stdout as a terminal, and
// prompts treat stdin as one, so the piped input stands in for the person's answer.
Object.defineProperty(process.stdout, "isTTY", { value: true });
Object.defineProperty(process.stdin, "isTTY", { value: true });
