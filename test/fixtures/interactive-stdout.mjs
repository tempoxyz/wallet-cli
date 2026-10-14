// incur treats a run as an agent unless stdout is a terminal, so this makes a piped run interactive.
Object.defineProperty(process.stdout, "isTTY", { value: true });
