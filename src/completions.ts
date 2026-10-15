import type { Completions } from "incur";

type Candidate = Completions.Candidate;

export const supportedShells = ["bash", "zsh", "fish", "nushell", "powershell", "elvish"] as const;

// incur's built-in global flags, as listed in its help output; incur does not export them.
const builtinFlags: Candidate[] = [
  { value: "--filter-output", description: "Filter output by key paths" },
  { value: "--format", description: "Output format" },
  { value: "--full-output", description: "Show full output envelope" },
  { value: "--help", description: "Show help" },
  { value: "--llms", description: "Print LLM-readable manifest" },
  { value: "--llms-full", description: "Print full LLM-readable manifest" },
  { value: "--mcp", description: "Start as MCP stdio server" },
  { value: "--schema", description: "Show JSON Schema for command" },
  { value: "--token-count", description: "Print token count of output" },
  { value: "--token-limit", description: "Limit output to n tokens" },
  { value: "--token-offset", description: "Skip first n tokens of output" },
  { value: "--version", description: "Show version" },
];

/**
 * Output of `tempo wallet completions [shell]` where incur's builtin falls short: it cannot
 * hook a two-word command name and has no PowerShell or Elvish output. Each hook registers
 * for the `tempo` launcher and only answers after `tempo wallet`; bash, zsh and Elvish hand
 * other `tempo` invocations to the completer registered before them. Bash and zsh call back
 * into incur's `COMPLETE=<shell>` handler; PowerShell and Elvish offer a static list of
 * top-level commands and global flags. Returns undefined for shells left to incur (fish,
 * nushell).
 */
export function completionScript(shell: string | undefined, candidates: () => Candidate[]) {
  if (shell === undefined) return `Supported shells: ${supportedShells.join(", ")}`;
  if (shell === "bash") return bash;
  if (shell === "zsh") return zsh;
  if (shell === "powershell") return powershell([...candidates(), ...builtinFlags]);
  if (shell === "elvish") return elvish([...candidates(), ...builtinFlags]);
  return undefined;
}

const bash = `_tempo_wallet_spec=$(complete -p tempo 2>/dev/null)
if [[ $_tempo_wallet_spec == *" -F "* ]]; then
    _tempo_wallet_spec=\${_tempo_wallet_spec#* -F }
    [[ \${_tempo_wallet_spec%% *} == _tempo_wallet ]] || _tempo_wallet_previous=\${_tempo_wallet_spec%% *}
fi
unset _tempo_wallet_spec
_tempo_wallet() {
    if [[ \${COMP_WORDS[1]} != wallet || $COMP_CWORD -lt 2 ]]; then
        [[ -z $_tempo_wallet_previous ]] || "$_tempo_wallet_previous" "$@"
        return
    fi
    local words=("\${COMP_WORDS[@]:1}")
    local IFS=$'\\013'
    # Drop the no-space marker incur appends to groups; bash 3.2 cannot strip it after splitting.
    COMPREPLY=($(COMPLETE=bash _COMPLETE_INDEX=$((COMP_CWORD - 1)) tempo wallet -- "\${words[@]}" 2>/dev/null | tr -d '\\001'))
    IFS=$' \\t\\n'
}
complete -o default -o bashdefault -F _tempo_wallet tempo`;

const zsh = `#compdef tempo
[[ \${_comps[tempo]:-_tempo_wallet} == _tempo_wallet ]] || _tempo_wallet_previous=\${_comps[tempo]}
_tempo_wallet() {
    if [[ \${words[2]} != wallet ]] || (( CURRENT < 3 )); then
        [[ -n $_tempo_wallet_previous ]] || return 1
        $_tempo_wallet_previous "$@"
        return
    fi
    local -a candidates
    candidates=("\${(@f)$(COMPLETE=zsh _COMPLETE_INDEX=$((CURRENT - 2)) tempo wallet -- "\${(@)words[2,-1]}" 2>/dev/null)}")
    [[ -n $candidates ]] && _describe 'values' candidates
}
compdef _tempo_wallet tempo`;

function powershell(candidates: Candidate[]) {
  const entries = candidates
    .map(({ value, description }) => `        ${quote(value)} = ${quote(description || value)}`)
    .join("\n");
  return `# Replaces any other native completer for tempo: PowerShell cannot read or chain one.
Register-ArgumentCompleter -Native -CommandName tempo -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    if ($commandAst.CommandElements.Count -lt 2 -or "$($commandAst.CommandElements[1])" -ne 'wallet') { return }
    $candidates = [ordered]@{
${entries}
    }
    foreach ($candidate in $candidates.GetEnumerator()) {
        if ($candidate.Key -like "$wordToComplete*") {
            [System.Management.Automation.CompletionResult]::new($candidate.Key, $candidate.Key, 'ParameterValue', $candidate.Value)
        }
    }
}`;
}

function elvish(candidates: Candidate[]) {
  const entries = candidates
    .map(
      ({ value, description }) =>
        `        edit:complex-candidate ${quote(value)} &display=${quote(description ? `${value}  ${description}` : value)}`,
    )
    .join("\n");
  return `var tempo-wallet-previous = $nil
if (has-key $edit:completion:arg-completer tempo) {
    set tempo-wallet-previous = $edit:completion:arg-completer[tempo]
}
set edit:completion:arg-completer[tempo] = {|@words|
    if (and (> (count $words) 2) (==s $words[1] wallet)) {
${entries}
    } elif (not-eq $tempo-wallet-previous $nil) {
        $tempo-wallet-previous $@words
    }
}`;
}

// PowerShell and Elvish both escape a single quote inside single quotes by doubling it.
function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
